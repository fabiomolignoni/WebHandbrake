import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileConfig } from '../../src/engine/compile';
import { delayIntervention } from '../../src/engine/defaults';
import type { Config, FocusSession, Group } from '../../src/engine/types';
import { type FakeBrowser, installFakeBrowser } from './fake-browser';
import { BLOCK, group, REMINDER } from './helpers';

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
    const delay = { ...delayIntervention(10), randomTo: 20, increase: 5 } as ReturnType<
      typeof delayIntervention
    >;
    const t = await setup([
      group('D', ['d.test'], [{ intervention: delay }]),
      group('Q', ['q.test'], [{ intervention: { type: 'ask', seconds: 3, choices: [5], maxMinutes: 9 } }]),
      group(
        'C',
        ['c.test'],
        [{ intervention: { type: 'challenge', kind: 'math', grant: { scope: 'page', mode: 'visit' } } }],
      ),
    ]);
    t.store.usage.count('proceeded:D', T0, t.store.cc.cal, 2);
    const d = await t.model('https://d.test/');
    expect(d.kind).toBe('delay');
    const wait = (await t.tickets.getTicket(d.ticket!.id))!.steps[0];
    expect(wait.type === 'wait' && wait.seconds).toBeGreaterThanOrEqual(10 + 2 * 5);
    expect(wait.type === 'wait' && wait.seconds).toBeLessThanOrEqual(20 + 2 * 5);
    const q = await t.model('https://q.test/');
    expect(q.ticket?.step).toMatchObject({ type: 'intention', choices: [5], maxMinutes: 9, seconds: 3 });
    const c = await t.model('https://c.test/');
    expect(c.ticket?.step.type).toBe('math');
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

  it('focus sessions, cool-downs and closing the tab', async () => {
    const t = await setup([
      group('S', ['s.test'], [{ intervention: { type: 'track' } }]),
      group('K', ['k.test'], [{ intervention: { type: 'track' } }]),
      group('C', ['close.test'], [{ intervention: { type: 'close' } }]),
    ]);
    t.store.state.sessions.push(session({ groups: ['S'], locked: true }));
    t.store.state.cooldowns['ask:K:k.test'] = { until: T0 + 60_000, group: 'K', site: 'k.test', kind: 'ask' };
    expect(await t.model('https://s.test/')).toMatchObject({ kind: 'session', locked: true });
    expect(await t.model('https://k.test/')).toMatchObject({ kind: 'cooldown', until: T0 + 60_000 });
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
    open.pause = {
      ...open.pause,
      allowed: true,
      scopes: ['page', 'site'],
      reason: 'none',
      cost: { type: 'confirm' },
    };
    const t = await setup([open]);
    expect((await t.model('https://a.test/')).pause).toMatchObject({
      available: true,
      scopes: ['page', 'site'],
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
    expect(await t.model('chrome://extensions')).toMatchObject({ kind: 'internal', canSaveLater: false });
    t.store.config.settings.protection.internalPages = 'never';
    expect((await t.model('chrome://extensions')).kind).toBe('allow');
    expect((await t.model('http://selftest.webhandbrake.invalid/')).kind).toBe('selftest');
    expect(t.store.meta.selftest?.ok).toBe(true);
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
      group(
        'Q',
        ['q.test'],
        [{ intervention: { type: 'ask', choices: [5], maxMinutes: 10, cooldownMinutes: 15 } }],
      ),
    ]);
    const m = await t.model('https://q.test/page');
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
        until: T0 + 7 * 60_000,
        intention: 'one answer',
        cooldownMinutes: 15,
      },
    ]);
    expect(t.store.intentions).toMatchObject([{ groupId: 'Q', text: 'one answer', minutes: 7 }]);
    expect(t.store.usage.counterSum('proceeded:Q', ['2026-10-05'])).toBe(1);
    expect((await t.model('https://q.test/page')).kind).toBe('allow');
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

  it('a break taken from the block page, or from the popup on its tab, is going in, not an impulse resisted', async () => {
    const blocks = group('A', ['a.test', 'b.test'], [{ intervention: BLOCK }]);
    blocks.pause = { ...blocks.pause, allowed: true, scopes: ['page', 'site'], cost: { type: 'confirm' } };
    const t = await setup([blocks]);
    const pauses = await import('../../src/background/pauses');
    const { todayStats } = await import('../../src/background/views');
    const takeBreak = async (url: string, sender?: chrome.runtime.MessageSender) => {
      const { ticket } = await pauses.startPause({ url, scope: 'page', minutes: 5, reason: 'x' }, sender);
      expect(await t.tickets.answerTicket(ticket!.id, '')).toMatchObject({ status: 'done' });
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
