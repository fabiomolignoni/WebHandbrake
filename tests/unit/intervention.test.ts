import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeUnit } from '../../src/engine/changes';
import { compileConfig } from '../../src/engine/compile';
import { delayIntervention } from '../../src/engine/defaults';
import { REDIRECT_PASS_MS } from '../../src/engine/limits';
import type { Config, FocusSession, Group, Intervention, PendingChange } from '../../src/engine/types';
import { type FakeBrowser, installFakeBrowser } from './fake-browser';
import { BLOCK, group, REMINDER, wait } from './helpers';

const T0 = new Date(2026, 9, 5, 10).getTime();
const PAGE = 'chrome-extension://test/intervention.html';

let fake: FakeBrowser;

async function setup(groups: Group[], patch: (c: Config) => void = () => {}) {
  vi.doMock('../../src/background/reconcile', () => ({ reconcile: async () => {}, broadcast: () => {} }));
  const { store } = await import('../../src/background/store');
  const intervention = await import('../../src/background/intervention');
  const tickets = await import('../../src/background/tickets');
  await store.ready();
  store.config = { ...store.config, groups };
  patch(store.config);
  store.cc = compileConfig(store.config);
  fake.tabs.push({ id: 1, url: `${PAGE}#https://a.test/`, incognito: false, active: true });
  const sender = { tab: { id: 1, incognito: false }, url: PAGE } as chrome.runtime.MessageSender;
  const model = (url: string) => intervention.interventionModel(url, sender);
  return { store, intervention, tickets, model, sender };
}

function session(patch: Partial<FocusSession>): FocusSession {
  return {
    id: 's',
    kind: 'groups',
    groups: [],
    allow: [],
    startAt: T0 - 1000,
    endAt: T0 + 3_600_000,
    createdAt: T0,
    locked: false,
    noPauses: false,
    ...patch,
  };
}

describe('the intervention page', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    fake = installFakeBrowser();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../src/background/reconcile');
  });

  it('a block names the rule, its note and message, and the other rules on the page', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ intervention: BLOCK }], { note: 'Focus', message: 'Later' }),
      group('B', ['a.test'], [{ intervention: delayIntervention(10) }]),
    ]);
    const m = await t.model('https://a.test/x');
    expect(m).toMatchObject({
      kind: 'block',
      host: 'a.test',
      group: { id: 'A', name: 'A', note: 'Focus', message: 'Later' },
      others: [{ id: 'B', name: 'B' }],
      canSaveLater: true,
      ticket: null,
    });
    // Counted once per tab, page and rule within a minute.
    await t.model('https://a.test/x');
    expect(t.store.usage.counterSum('shown:A', ['2026-10-05'])).toBe(1);
  });

  it('a page that is allowed now is let through, with a short recheck access for the browser filters', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: { type: 'track' } }])]);
    const m = await t.model('https://a.test/');
    expect(m.kind).toBe('allow');
    expect(t.store.state.grants).toMatchObject([{ kind: 'recheck', url: 'https://a.test/' }]);
  });

  it('waits, questions and challenges come with their ticket', async () => {
    const random = { ...delayIntervention(10), randomTo: 20 } as ReturnType<typeof delayIntervention>;
    const growing = { ...delayIntervention(10), increase: 5 } as ReturnType<typeof delayIntervention>;
    const t = await setup([
      group('D', ['d.test'], [{ intervention: random }]),
      group('G', ['g.test'], [{ intervention: growing }]),
      group('Q', ['q.test'], [{ intervention: { type: 'ask', maxMinutes: 9, minReasonLength: 12 } }]),
      group(
        'C',
        ['c.test'],
        [{ intervention: { type: 'challenge', kind: 'math', grant: { scope: 'page', mode: 'visit' } } }],
      ),
    ]);
    t.store.usage.count('proceeded:G', T0, t.store.cc.cal, 2);
    const d = await t.model('https://d.test/');
    expect(d.kind).toBe('delay');
    const wait = (await t.tickets.getTicket(d.ticket!.id))!.steps[0];
    expect(wait.type === 'wait' && wait.seconds).toBeGreaterThanOrEqual(10);
    expect(wait.type === 'wait' && wait.seconds).toBeLessThanOrEqual(20);
    // Longer by 5 s for each of the two times one went in today.
    const g = await t.model('https://g.test/');
    expect((await t.tickets.getTicket(g.ticket!.id))!.steps[0]).toEqual({ type: 'wait', seconds: 20 });
    // The durations offered come from the longest time; the wait is always 10 s.
    const q = await t.model('https://q.test/');
    expect(q.ticket?.step).toMatchObject({
      type: 'intention',
      choices: [5],
      maxMinutes: 9,
      seconds: 10,
      minLength: 12,
    });
    const c = await t.model('https://c.test/');
    expect(c.ticket?.step.type).toBe('math');
  });

  it('pages that ask for the same access share one request, with the same wait', async () => {
    const random = { ...delayIntervention(10), randomTo: 600 } as ReturnType<typeof delayIntervention>;
    const page = (seconds: number) =>
      ({ ...delayIntervention(seconds), grant: { scope: 'page', mode: 'visit' } }) as Intervention;
    const t = await setup([
      group('D', ['d.test'], [{ intervention: random }]),
      group('P', ['p.test'], [{ intervention: page(10) }]),
    ]);
    fake.tabs.push({ id: 2, url: `${PAGE}#https://d.test/b`, incognito: false, active: true });
    const other = { tab: { id: 2, incognito: false }, url: PAGE } as chrome.runtime.MessageSender;
    const first = await t.model('https://d.test/a');
    vi.setSystemTime(T0 + 5000);
    // Another page of the site, a moment later: the same request, waiting until the same time.
    const second = await t.intervention.interventionModel('https://d.test/b', other);
    expect(second.ticket).toEqual(first.ticket);
    expect(first.ticket?.step).toMatchObject({ type: 'wait' });
    // Opened again, the page does not draw another wait either.
    expect((await t.model('https://d.test/a')).ticket).toEqual(first.ticket);
    // A pass for one page: another page of the site asks for another access.
    const p1 = (await t.model('https://p.test/1')).ticket!;
    expect((await t.model('https://p.test/2')).ticket!.id).not.toBe(p1.id);
    expect((await t.model('https://p.test/1')).ticket!.id).toBe(p1.id);
    // A rule changed since asks as it is now.
    t.store.config.groups[1].policies[0].intervention = page(20);
    t.store.cc = compileConfig(t.store.config);
    expect((await t.model('https://p.test/1')).ticket).toMatchObject({ step: { seconds: 20 } });
    // The access given from one page lets the other one in, and the next request is a new one.
    vi.setSystemTime(T0 + 600_000);
    expect(await t.tickets.answerTicket(first.ticket!.id, '')).toMatchObject({ status: 'done' });
    expect(await t.tickets.answerTicket(second.ticket!.id, '')).toEqual({
      status: 'error',
      error: 'ticket.error.expired',
    });
    expect((await t.intervention.interventionModel('https://d.test/b', other)).kind).toBe('allow');
    t.store.state.grants = [];
    expect((await t.model('https://d.test/a')).ticket!.id).not.toBe(first.ticket!.id);
  });

  it('a wait asked before its rule changed gives no access: the page asks as the rule does now', async () => {
    const t = await setup([group('W', ['w.test'], [{ intervention: delayIntervention(10) }])]);
    const before = (await t.model('https://w.test/')).ticket!;
    // Made stricter at once, while the page shows the wait of 10 s.
    t.store.config.groups[0].policies[0].intervention = delayIntervention(600);
    t.store.cc = compileConfig(t.store.config);
    vi.setSystemTime(T0 + 11_000);
    expect(await t.tickets.answerTicket(before.id, '')).toEqual({
      status: 'error',
      error: 'ticket.error.changed',
    });
    expect(t.store.state.grants.filter((g) => g.kind === 'pass')).toEqual([]);
    const now = (await t.model('https://w.test/')).ticket!;
    expect(now.step).toMatchObject({ type: 'wait', seconds: 600 });
    vi.setSystemTime(T0 + 612_000);
    expect(await t.tickets.answerTicket(now.id, '')).toMatchObject({ status: 'done' });
    expect(t.store.state.grants.filter((g) => g.kind === 'pass')).toHaveLength(1);
  });

  it('a redirect fills in its placeholders; an address that is not a web page blocks', async () => {
    const t = await setup([
      group(
        'R',
        ['r.test'],
        [{ intervention: { type: 'redirect', url: 'https://focus.test/?from={url}&rule={group}' } }],
      ),
      group('X', ['x.test'], [{ intervention: { type: 'redirect', url: 'javascript:alert(1)' } }]),
    ]);
    const r = await t.model('https://r.test/a');
    expect(r).toMatchObject({
      kind: 'redirect',
      redirectUrl: 'https://focus.test/?from=https%3A%2F%2Fr.test%2Fa&rule=R',
    });
    expect((await t.model('https://x.test/')).kind).toBe('block');
  });

  it('focus sessions and closing the tab', async () => {
    const t = await setup([
      group('S', ['s.test'], [{ intervention: { type: 'track' } }]),
      group('K', ['k.test'], [{ intervention: { type: 'track' } }]),
      group('C', ['close.test'], [{ intervention: { type: 'close' } }]),
    ]);
    t.store.state.sessions.push(session({ groups: ['S'], locked: true }));
    expect(await t.model('https://s.test/')).toMatchObject({ kind: 'session', locked: true });
    expect((await t.model('https://k.test/')).kind).toBe('allow');
    expect((await t.model('https://close.test/')).kind).toBe('close');
    t.store.state.sessions = [session({ kind: 'allowlist', allow: [] })];
    expect(await t.model('https://anywhere.test/')).toMatchObject({
      kind: 'session',
      locked: false,
      group: null,
    });
  });

  it('a break is offered where it can open the page, and says so where another rule keeps it closed', async () => {
    const open = group('Open', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER });
    open.pause = { ...open.pause, allowed: true, cost: { type: 'confirm' } };
    const t = await setup([open]);
    expect((await t.model('https://a.test/')).pause).toMatchObject({
      available: true,
      groups: [{ id: 'Open', name: 'Open' }],
    });
    const closed = group('Closed', ['a.test'], [{ intervention: BLOCK }]);
    closed.pause = { ...closed.pause, allowed: false };
    t.store.config.groups.push(closed);
    t.store.cc = compileConfig(t.store.config);
    expect((await t.model('https://a.test/')).pause).toMatchObject({
      available: false,
      reason: 'pause.unavailable.otherRule',
    });
  });

  it('a question, a wait or a challenge offers no break', async () => {
    const asks = group('Asks', ['a.test'], [{ intervention: delayIntervention(10) }]);
    asks.pause = { ...asks.pause, allowed: true };
    const t = await setup([asks]);
    const m = await t.model('https://a.test/');
    expect(m.kind).toBe('delay');
    expect(m.pause).toBeNull();
  });

  it('browser settings pages are protected as the setting says; the self-test is recognised', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    t.store.config.settings.protection.internalPages = 'always';
    expect(await t.model('chrome://extensions')).toMatchObject({
      kind: 'internal',
      canSaveLater: false,
      internal: { always: true, rules: [], session: false },
      until: null,
    });
    // The page names the firmly protected rules that block it.
    t.store.config.settings.protection.internalPages = 'auto';
    t.store.config.groups[0].protection = { kind: 'password', hash: 'x' };
    t.store.cc = compileConfig(t.store.config);
    expect((await t.model('chrome://settings/reset')).internal).toEqual({
      always: false,
      rules: [expect.objectContaining({ name: 'A', protection: { kind: 'password', hash: 'x' } })],
      session: false,
    });
    expect((await t.model('chrome://settings/passwords')).kind).toBe('allow');
    t.store.config.settings.protection.internalPages = 'never';
    expect((await t.model('chrome://extensions')).kind).toBe('allow');
    expect((await t.model('http://selftest.webhandbrake.invalid/')).kind).toBe('selftest');
    expect(t.store.meta.selftest?.ok).toBe(true);
  });

  it('says when a change to the rules of the page waits to be confirmed, which keeps the page as it was', async () => {
    const DAY = 86_400_000;
    const ask: Intervention = { type: 'ask', maxMinutes: 9, minReasonLength: 12 };
    const t = await setup([
      group('Ask', ['a.test'], [{ intervention: ask }], { protection: wait(86_400) }),
      group('Elsewhere', ['b.test'], [{ intervention: BLOCK }], { protection: wait(86_400) }),
    ]);
    const protection = await import('../../src/background/protection');
    expect((await t.model('https://a.test/')).pending).toBeNull();
    // a.test leaves "Ask": a change that waits a day, then has to be confirmed.
    const next = structuredClone(t.store.config);
    next.groups[0].targets = [];
    expect((await protection.proposeConfig(next, 'test')).pending).not.toBeNull();
    expect(await t.model('https://a.test/')).toMatchObject({
      kind: 'ask',
      pending: { rules: ['Ask'], readyAt: T0 + DAY },
    });
    vi.setSystemTime(T0 + DAY + 1000);
    expect(await t.model('https://a.test/')).toMatchObject({
      kind: 'ask',
      pending: { rules: ['Ask'], readyAt: T0 + DAY },
    });
    // The other rules of the page count, from the first change that can be confirmed; the rules
    // of other pages, settings and changes overtaken since do not.
    t.store.config.groups.splice(1, 0, group('Also', ['a.test'], [{ intervention: BLOCK }]));
    t.store.cc = compileConfig(t.store.config);
    const change = (units: ChangeUnit[], readyAt: number): PendingChange => ({
      id: crypto.randomUUID(),
      createdAt: T0,
      readyAt,
      expiresAt: readyAt + 2 * DAY,
      units,
    });
    const off = (id: string, base: boolean): ChangeUnit => ({
      kind: 'group.field',
      groupId: id,
      name: id,
      field: 'enabled',
      value: !base,
      base,
    });
    const dayStart: ChangeUnit = { kind: 'setting', path: 'dayStart', value: 240, base: 0 };
    t.store.state.pending.push(
      change([off('Also', true)], T0 + 2 * DAY),
      change([off('Elsewhere', true), dayStart], T0),
      change([off('Also', false)], T0),
    );
    expect((await t.model('https://a.test/')).pending).toEqual({ rules: ['Ask', 'Also'], readyAt: T0 + DAY });
    expect((await t.model('https://b.test/')).pending).toEqual({ rules: ['Elsewhere'], readyAt: T0 });
    // A focus session blocks the page whatever its rules say.
    t.store.state.sessions.push(session({ groups: ['Ask'], endAt: T0 + 2 * DAY }));
    expect((await t.model('https://a.test/')).pending).toBeNull();
  });

  it('on the browser’s pages, a change to their rules or to the setting that blocks them is named', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: wait(86_400) })]);
    t.store.config.settings.protection.internalPages = 'auto';
    t.store.cc = compileConfig(t.store.config);
    expect((await t.model('chrome://extensions')).pending).toBeNull();
    t.store.state.pending.push({
      id: 'p',
      createdAt: T0,
      readyAt: T0 + 3_600_000,
      expiresAt: T0 + 7_200_000,
      emergency: true,
      units: [{ kind: 'setting', path: 'protection.internalPages', value: 'never', base: 'auto' }],
    });
    expect((await t.model('chrome://extensions')).pending).toEqual({ rules: [], readyAt: T0 + 3_600_000 });
    t.store.state.pending[0].units.push({
      kind: 'target.remove',
      owner: { kind: 'group', id: 'A' },
      ownerName: 'A',
      target: t.store.config.groups[0].targets[0],
    });
    expect((await t.model('chrome://extensions')).pending).toEqual({ rules: ['A'], readyAt: T0 + 3_600_000 });
  });

  it('settings of the page: the address hidden, custom CSS that cannot load anything', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])], (c) => {
      c.settings.interventions.hideUrl = true;
      c.settings.interventions.customCss = 'h1 { color: red } body { background: url(https://evil.test/x) }';
    });
    expect(await t.model('https://a.test/')).toMatchObject({
      hideUrl: true,
      customCss: 'h1 { color: red } body { background: none }',
    });
  });

  it('passing gives the access of the rule, records the reason, and counts it', async () => {
    const t = await setup([
      group('Q', ['q.test'], [{ intervention: { type: 'ask', maxMinutes: 10, minReasonLength: 10 } }]),
    ]);
    const m = await t.model('https://q.test/page');
    vi.setSystemTime(T0 + 10_000);
    // A reason shorter than the rule asks for is refused.
    expect(await t.tickets.answerTicket(m.ticket!.id, 'too short', 7)).toMatchObject({
      status: 'error',
      error: 'ticket.error.intentionShort',
    });
    expect(await t.tickets.answerTicket(m.ticket!.id, 'one answer', 7)).toMatchObject({
      status: 'done',
      result: { url: 'https://q.test/page' },
    });
    expect(t.store.state.grants).toMatchObject([
      {
        kind: 'pass',
        groups: ['Q'],
        scope: 'site',
        site: 'q.test',
        until: T0 + 10_000 + 7 * 60_000,
        intention: 'one answer',
      },
    ]);
    expect(t.store.intentions).toMatchObject([{ groupId: 'Q', text: 'one answer', minutes: 7 }]);
    expect(t.store.usage.counterSum('proceeded:Q', ['2026-10-05'])).toBe(1);
    expect((await t.model('https://q.test/page')).kind).toBe('allow');
  });

  it('a redirect of the server on the way in from the block page carries the access just given', async () => {
    const t = await setup([
      group('W', ['short.test', 'video.test'], [{ intervention: delayIntervention(10) }]),
    ]);
    t.intervention.registerRedirectListener();
    fake.tabs[0].url = `${PAGE}#https://short.test/abc`;
    const m = await t.model('https://short.test/abc');
    vi.setSystemTime(T0 + 10_000);
    expect(await t.tickets.answerTicket(m.ticket!.id, '')).toMatchObject({ status: 'done' });
    const passes = () => t.store.state.grants.filter((g) => g.kind === 'pass').map((g) => g.site);
    // A link to another site of the rule: the block page it leads to waits for it, and lets it through.
    fake.events.onBeforeRedirect.fire({
      tabId: 1,
      url: 'https://short.test/abc',
      redirectUrl: 'https://video.test/watch?v=1',
    });
    expect((await t.model('https://video.test/watch?v=1')).kind).toBe('allow');
    expect(passes()).toEqual(['short.test', 'video.test']);
    // Going in once, counted once.
    expect(t.store.usage.counterSum('proceeded:W', ['2026-10-05'])).toBe(1);
    // Only redirects to web pages, in a tab.
    fake.events.onBeforeRedirect.fire({
      tabId: -1,
      url: 'https://short.test/',
      redirectUrl: 'https://x.test/',
    });
    fake.events.onBeforeRedirect.fire({
      tabId: 1,
      url: 'https://short.test/',
      redirectUrl: 'chrome-extension://test/intervention.html#https://short.test/',
    });
    expect(passes()).toEqual(['short.test', 'video.test']);
  });

  it('a redirect carries nothing once a page was opened in the tab, or long after going in', async () => {
    const t = await setup([
      group('W', ['short.test', 'video.test', 'other.test'], [{ intervention: delayIntervention(10) }]),
    ]);
    const m = await t.model('https://short.test/abc');
    vi.setSystemTime(T0 + 10_000);
    expect(await t.tickets.answerTicket(m.ticket!.id, '')).toMatchObject({ status: 'done' });
    // The tab shows the site now: a redirect there is a page the person opened.
    fake.tabs[0].url = 'https://short.test/abc';
    t.intervention.followRedirect(1, 'https://short.test/abc', 'https://video.test/');
    expect((await t.model('https://video.test/')).kind).toBe('delay');
    // On a block page again, but long after the access was given.
    fake.tabs[0].url = `${PAGE}#https://short.test/abc`;
    vi.setSystemTime(T0 + 10_000 + REDIRECT_PASS_MS + 1);
    t.intervention.followRedirect(1, 'https://short.test/abc', 'https://other.test/');
    expect((await t.model('https://other.test/')).kind).toBe('delay');
    expect(t.store.state.grants.filter((g) => g.kind === 'pass')).toHaveLength(1);
  });

  it('leaving without going in is an impulse resisted, counted once', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    await t.model('https://a.test/');
    await t.intervention.interventionLeft(t.sender);
    await t.intervention.interventionLeft(t.sender);
    expect(t.store.usage.counterSum('left:A', ['2026-10-05'])).toBe(1);
    await t.intervention.closeSenderTab(t.sender);
    expect(fake.removed).toEqual([1]);
  });

  it('only a page that offered a way in, opened rather than put in place of an open page, is a choice', async () => {
    const hard = group('Hard', ['hard.test'], [{ intervention: BLOCK }]);
    hard.pause = { ...hard.pause, allowed: false };
    const t = await setup([hard, group('Asks', ['asks.test'], [{ intervention: delayIntervention(10) }])]);
    const { todayStats } = await import('../../src/background/views');
    const enforce = await import('../../src/background/enforce');
    // A block without a break leaves no choice.
    await t.model('https://hard.test/');
    expect(todayStats()).toMatchObject({ shown: 1, impulses: 0 });
    // A wait does: leaving it is a choice not to go in.
    await t.model('https://asks.test/');
    expect(todayStats()).toMatchObject({ shown: 2, impulses: 1 });
    // The same page put in place of one already open by a change of the rules is not.
    enforce.replacedTabs.set(1, 'https://asks.test/other');
    await t.model('https://asks.test/other');
    expect(todayStats()).toMatchObject({ shown: 3, impulses: 1 });
    expect(t.store.usage.counterSum('offered:Asks', ['2026-10-05'])).toBe(1);
  });

  it('a break taken from the block page, or from the popup on its tab, is going in, not an impulse resisted', async () => {
    const blocks = group('A', ['a.test', 'b.test'], [{ intervention: BLOCK }]);
    blocks.pause = { ...blocks.pause, allowed: true, cost: { type: 'confirm' } };
    const t = await setup([blocks]);
    const pauses = await import('../../src/background/pauses');
    const { todayStats } = await import('../../src/background/views');
    const takeBreak = async (url: string, sender?: chrome.runtime.MessageSender) => {
      const { ticket } = await pauses.startPause({ url, minutes: 5 }, sender);
      expect(await t.tickets.answerTicket(ticket!.id, '')).toMatchObject({ status: 'done' });
      // A break covers the whole rule: the next one is taken after this one ends.
      await pauses.cancelPause(undefined, true);
    };
    await t.model('https://a.test/');
    await takeBreak('https://a.test/', t.sender);
    expect(todayStats()).toMatchObject({ shown: 1, proceeded: 1, impulses: 0 });
    // Closing the page afterwards is not leaving without going in.
    await t.intervention.interventionLeft(t.sender);
    expect(t.store.usage.counterSum('left:A', ['2026-10-05'])).toBe(0);
    // The popup of a tab showing the block page of b.test.
    fake.tabs.push({ id: 2, url: `${PAGE}#https://b.test/`, incognito: false, active: false });
    await t.intervention.interventionModel('https://b.test/', {
      tab: { id: 2, incognito: false },
      url: PAGE,
    } as chrome.runtime.MessageSender);
    await takeBreak('https://b.test/');
    expect(todayStats()).toMatchObject({ shown: 2, proceeded: 2, impulses: 0 });
    // A break with no block page shown lets no page through.
    await takeBreak('https://b.test/other');
    expect(todayStats()).toMatchObject({ shown: 2, proceeded: 2, impulses: 0 });
    expect(t.store.usage.counterSum('pausedIn:A', ['2026-10-05'])).toBe(2);
  });

  it('reopens an allowed page in its own tab, only for the intervention page and real addresses', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    expect(await t.intervention.reopenInTab('file:///notes.txt', t.sender)).toEqual({ ok: true });
    expect(fake.tabs[0].url).toBe('file:///notes.txt');
    expect(await t.intervention.reopenInTab('https://a.test/', t.sender)).toEqual({ ok: false });
    expect(await t.intervention.reopenInTab('javascript:alert(1)', t.sender)).toEqual({ ok: false });
    const page = { tab: { id: 1 }, url: 'https://evil.test/' } as chrome.runtime.MessageSender;
    expect(await t.intervention.reopenInTab('file:///notes.txt', page)).toEqual({ ok: false });
  });
});

describe('a wait that pauses or starts again when you switch tabs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    fake = installFakeBrowser();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../src/background/reconcile');
  });

  /** The events of the tabs are handled in the background: until it has looked at them. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  async function waiting(onBlur: 'pause' | 'restart' | 'ignore', opts: { background?: boolean } = {}) {
    const t = await setup([
      group('W', ['w.test'], [{ intervention: { ...delayIntervention(30), onBlur } as Intervention }]),
    ]);
    t.tickets.registerWaitListeners();
    fake.tabs[0].windowId = 1;
    fake.tabs[0].active = !opts.background;
    fake.tabs.push({ id: 3, url: 'https://other.test/', incognito: false, active: false, windowId: 1 });
    const m = await t.model('https://w.test/');
    const id = m.ticket!.id;
    /** Shows a tab of the window, as the person switching to it. */
    const activate = async (tabId: number, at: number) => {
      vi.setSystemTime(at);
      for (const tab of fake.tabs) if (tab.windowId === 1) tab.active = tab.id === tabId;
      fake.events.onActivated.fire({ tabId, windowId: 1 });
      await settle();
    };
    const answer = (at: number) => {
      vi.setSystemTime(at);
      return t.tickets.answerTicket(id, '');
    };
    const notYet = (readyAt: number) => ({
      status: 'error',
      error: 'ticket.error.notYet',
      ticket: { step: { type: 'wait', readyAt } },
    });
    return { ...t, id, activate, answer, notYet };
  }

  it('pauses while another tab is shown: an answer before the end it moved to is refused', async () => {
    const t = await waiting('pause');
    // 10 s of the wait, then 30 s on another tab: 20 s are left when the page is shown again.
    await t.activate(3, T0 + 10_000);
    // Answered while away, it would end 20 s after the page is shown again.
    expect(await t.answer(T0 + 30_000)).toMatchObject(t.notYet(T0 + 50_000));
    await t.activate(1, T0 + 40_000);
    expect(await t.answer(T0 + 45_000)).toMatchObject(t.notYet(T0 + 60_000));
    expect(await t.answer(T0 + 60_000)).toMatchObject({ status: 'done' });
  });

  it('starts again once the page is shown again', async () => {
    const t = await waiting('restart');
    await t.activate(3, T0 + 25_000);
    await t.activate(1, T0 + 40_000);
    expect(await t.answer(T0 + 60_000)).toMatchObject(t.notYet(T0 + 70_000));
    expect(await t.answer(T0 + 70_000)).toMatchObject({ status: 'done' });
  });

  it('keeps going if the rule says so', async () => {
    const t = await waiting('ignore');
    await t.activate(3, T0 + 10_000);
    expect(await t.answer(T0 + 30_000)).toMatchObject({ status: 'done' });
  });

  it('pauses while the window is minimised, or while the page says it is hidden', async () => {
    const t = await waiting('pause');
    vi.setSystemTime(T0 + 10_000);
    fake.windows.set(1, 'minimized');
    fake.events.onFocusChanged.fire(-1);
    await settle();
    vi.setSystemTime(T0 + 20_000);
    fake.windows.delete(1);
    fake.events.onFocusChanged.fire(1);
    await settle();
    // Covered by another window: only the page can tell. Another tab's word does not count.
    vi.setSystemTime(T0 + 25_000);
    const elsewhere = { tab: { id: 3 } } as chrome.runtime.MessageSender;
    expect(await t.tickets.ticketShown(t.id, elsewhere.tab?.id, false)).toMatchObject({
      step: { readyAt: T0 + 40_000 },
    });
    expect(await t.tickets.ticketShown(t.id, 1, false)).toMatchObject({ step: { readyAt: T0 + 40_000 } });
    vi.setSystemTime(T0 + 35_000);
    expect(await t.tickets.ticketShown(t.id, 1, true)).toMatchObject({ step: { readyAt: T0 + 50_000 } });
    expect(await t.answer(T0 + 45_000)).toMatchObject(t.notYet(T0 + 50_000));
    // Saying it is in view does not make a tab in the background visible.
    await t.activate(3, T0 + 46_000);
    await t.tickets.ticketShown(t.id, 1, true);
    expect(await t.answer(T0 + 50_000)).toMatchObject(t.notYet(T0 + 54_000));
  });

  it('counts down in a tab opened in the background until the page is seen', async () => {
    const t = await waiting('pause', { background: true });
    // Another tab shown before the page was: its wait goes on, as it always did.
    await t.activate(3, T0 + 20_000);
    await t.activate(1, T0 + 25_000);
    // Seen, then left for 2 s.
    await t.activate(3, T0 + 28_000);
    await t.activate(1, T0 + 30_000);
    expect(await t.answer(T0 + 31_000)).toMatchObject(t.notYet(T0 + 32_000));
    expect(await t.answer(T0 + 32_000)).toMatchObject({ status: 'done' });
  });

  it('goes on while another page of the same wait is in view', async () => {
    const t = await waiting('pause');
    fake.tabs.push({ id: 4, url: `${PAGE}#https://w.test/b`, incognito: false, active: true, windowId: 2 });
    const other = await t.intervention.interventionModel('https://w.test/b', {
      tab: { id: 4, incognito: false },
      url: PAGE,
    } as chrome.runtime.MessageSender);
    expect(other.ticket?.id).toBe(t.id);
    await t.activate(3, T0 + 10_000);
    expect(await t.answer(T0 + 30_000)).toMatchObject({ status: 'done' });
  });

  it('closed and opened again, the same wait goes on from where it was', async () => {
    const t = await waiting('pause');
    vi.setSystemTime(T0 + 10_000);
    await t.intervention.closeSenderTab(t.sender);
    fake.events.onRemoved.fire(1);
    await settle();
    vi.setSystemTime(T0 + 300_000);
    fake.tabs.push({ id: 5, url: `${PAGE}#https://w.test/`, incognito: false, active: true, windowId: 1 });
    const again = await t.intervention.interventionModel('https://w.test/', {
      tab: { id: 5, incognito: false },
      url: PAGE,
    } as chrome.runtime.MessageSender);
    expect(again.ticket).toMatchObject({ id: t.id, step: { readyAt: T0 + 320_000 } });
    expect(await t.answer(T0 + 319_000)).toMatchObject(t.notYet(T0 + 320_000));
  });

  it('a tab that shows another page no longer shows the wait', async () => {
    const t = await waiting('pause');
    t.store.config.groups.push(group('B', ['b.test'], [{ intervention: BLOCK }]));
    t.store.cc = compileConfig(t.store.config);
    vi.setSystemTime(T0 + 10_000);
    fake.tabs[0].url = `${PAGE}#https://b.test/`;
    await t.model('https://b.test/');
    expect(await t.answer(T0 + 40_000)).toMatchObject(t.notYet(T0 + 60_000));
  });
});

describe('custom CSS', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  it('cannot load anything, even when escapes spell what it would load', async () => {
    const { sanitizeCss } = await import('../../src/background/intervention');
    const loads = [
      '@import "https://evil.test/x.css"; h1 { color: red }',
      'body { background: url( "https://evil.test/a.png" ) }',
      'body { background: \\75 rl(https://evil.test/a.png) }',
      'body { background: \\000075rl(https://evil.test/a.png) }',
      '@\\69mport "https://evil.test/x.css";',
      '@font-face { font-family: x; src: \\75rl(https://evil.test/f.woff) }',
      'body { background-image: image-set("https://evil.test/a.png" 1x) }',
      'body { background-image: -webkit-image-set("https://evil.test/a.png" 1x) }',
      'body { background-image: src("https://evil.test/a.png") }',
      'body { background-image: image("https://evil.test/a.png") }',
    ];
    for (const css of loads) expect(sanitizeCss(css), css).not.toContain('evil.test');
  });

  it('keeps everything else as written, escapes included', async () => {
    const { sanitizeCss } = await import('../../src/background/intervention');
    const css =
      'h1::before { content: "\\2192 " } .note { color: #333; background-image: linear-gradient(red, blue) }';
    expect(sanitizeCss(css)).toBe(css);
    expect(sanitizeCss('<style>p{}</style>')).toBe('p{}');
    expect(sanitizeCss('x'.repeat(30_000))).toHaveLength(20_000);
  });
});
