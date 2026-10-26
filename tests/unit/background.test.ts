import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Group } from '../../src/engine/types';
import type { TicketView } from '../../src/shared/models';
import { installFakeBrowser } from './fake-browser';
import { BLOCK, group, PERMANENT, REMINDER, wait } from './helpers';

function pausable(g: Group, cost: Group['pause']['cost'], patch: Partial<Group['pause']> = {}): Group {
  g.pause = { ...g.pause, allowed: true, cost, ...patch };
  return g;
}

describe('pauses covering several groups', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  async function setup(groups: Group[]) {
    const { store } = await import('../../src/background/store');
    const pauses = await import('../../src/background/pauses');
    await store.ready();
    store.config = { ...store.config, groups };
    const { compileConfig } = await import('../../src/engine/compile');
    store.cc = compileConfig(store.config);
    return { store, ...pauses };
  }

  it('pays the cost of every group on the page, not only the first one', async () => {
    const { pauseOptions } = await setup([
      pausable(group('A', ['video.test'], [{ intervention: BLOCK }]), { type: 'confirm' }),
      pausable(group('B', ['video.test/watch'], [{ intervention: BLOCK }]), { type: 'delay', seconds: 60 }),
    ]);
    const o = pauseOptions('https://video.test/watch?v=1');
    expect(o.groups.map((g) => g.id)).toEqual(['A', 'B']);
    expect(o.costs).toEqual([{ type: 'delay', seconds: 60 }]);
  });

  it('a break covers the rules of the page whole, up to the shortest longest break', async () => {
    const { pauseOptions, startPause, store } = await setup([
      pausable(group('A', ['news.test', 'paper.test'], [{ intervention: BLOCK }]), { type: 'none' }),
      pausable(group('B', ['news.test'], [{ intervention: BLOCK }]), { type: 'none' }, { maxMinutes: 5 }),
      pausable(group('C', ['games.test'], [{ intervention: BLOCK }]), { type: 'none' }),
    ]);
    const o = pauseOptions('https://news.test/a');
    expect(o.groups.map((g) => g.id)).toEqual(['A', 'B']);
    expect(o.maxMinutes).toBe(5);
    expect(await startPause({ url: 'https://news.test/a', minutes: 10 })).toEqual({
      ticket: null,
      error: 'pause.error.duration',
    });
    // Shorter than the longest is fine: it can also be ended sooner.
    expect(await startPause({ url: 'https://news.test/a', minutes: 3 })).toEqual({ ticket: null });
    expect(store.state.grants).toMatchObject([{ kind: 'pause', groups: ['A', 'B'], scope: 'group' }]);
    expect(store.state.pauses).toMatchObject([{ groups: ['A', 'B'], scope: 'group', minutes: 3 }]);
    const { ctx } = await import('../../src/background/engine');
    const { decide } = await import('../../src/engine/decide');
    expect(decide(ctx(), 'https://paper.test/').groups[0].pause).toBeDefined();
    expect(decide(ctx(), 'https://games.test/').groups[0].pause).toBeUndefined();
  });

  it('a break asks for no reason', async () => {
    const { startPause } = await setup([
      pausable(group('A', ['news.test'], [{ intervention: BLOCK }]), { type: 'confirm' }),
    ]);
    const { ticket } = await startPause({ url: 'https://news.test/', minutes: 5 });
    expect(ticket?.stepCount).toBe(1);
    expect(ticket?.step.type).toBe('confirm');
  });
});

describe('a running break', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  async function setup() {
    const { store } = await import('../../src/background/store');
    const pauses = await import('../../src/background/pauses');
    await store.ready();
    const g = pausable(
      group('G', ['video.test'], [{ intervention: BLOCK }]),
      { type: 'none' },
      { maxMinutes: 15, limit: { count: 2, period: { kind: 'day' } } },
    );
    store.config = { ...store.config, groups: [g] };
    const { compileConfig } = await import('../../src/engine/compile');
    store.cc = compileConfig(store.config);
    return { store, ...pauses };
  }

  const url = 'https://video.test/watch?v=1';

  it('is not taken again, so it uses up no other break (regression)', async () => {
    const { store, pauseOptions, startPause } = await setup();
    await startPause({ url, minutes: 15 });
    expect(pauseOptions(url)).toMatchObject({ available: false, reason: 'pause.unavailable.onBreak' });
    expect(await startPause({ url, minutes: 15 })).toEqual({
      ticket: null,
      error: 'pause.unavailable.onBreak',
    });
    expect(store.state.grants).toHaveLength(1);
    expect(store.state.pauses).toHaveLength(1);
  });

  it('ended sooner, it counts only the minutes used and the next one can be taken', async () => {
    const { startPause, cancelPause, pauseOptions, store } = await setup();
    await startPause({ url, minutes: 15 });
    await cancelPause(store.state.grants[0].id);
    expect(store.state.pauses[0]).toMatchObject({ minutes: 15, used: 0 });
    expect(pauseOptions(url)).toMatchObject({ available: true, remainingCount: 1 });
  });
});

describe('breaks asked together', () => {
  const T0 = new Date(2026, 9, 5, 10).getTime();
  const url = 'https://video.test/';

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    installFakeBrowser();
  });
  afterEach(() => vi.useRealTimers());

  async function setup(limit: Group['pause']['limit']) {
    const { store } = await import('../../src/background/store');
    const pauses = await import('../../src/background/pauses');
    const tickets = await import('../../src/background/tickets');
    await store.ready();
    const g = pausable(
      group('G', ['video.test'], [{ intervention: BLOCK }]),
      { type: 'delay', seconds: 30 },
      { maxMinutes: 15, limit },
    );
    store.config = { ...store.config, groups: [g] };
    const { compileConfig } = await import('../../src/engine/compile');
    store.cc = compileConfig(store.config);
    // Asked one after the other, before any of them starts: each one is available when asked.
    const asked: TicketView[] = [];
    for (let i = 0; i < 3; i++) asked.push((await pauses.startPause({ url, minutes: 15 })).ticket!);
    const answer = (i: number, at: number) => {
      vi.setSystemTime(at);
      return tickets.answerTicket(asked[i].id, '');
    };
    return { store, answer };
  }

  it('start only while the breaks of the period last, checked again as each one starts', async () => {
    const { store, answer } = await setup({ count: 1, period: { kind: 'day' } });
    expect(await answer(0, T0 + 31_000)).toMatchObject({ status: 'done' });
    const refused = { status: 'error', error: 'pause.unavailable.noneLeft' };
    expect(await answer(1, T0 + 31_000 + 16 * 60_000)).toEqual(refused);
    expect(await answer(2, T0 + 31_000 + 32 * 60_000)).toEqual(refused);
    expect(store.state.pauses).toHaveLength(1);
    expect(store.state.grants.filter((g) => g.kind === 'pause')).toHaveLength(1);
  });

  it('start only while the minutes of the period last, and for no longer than they leave', async () => {
    const { store, answer } = await setup({ minutes: 20, period: { kind: 'day' } });
    expect(await answer(0, T0 + 31_000)).toMatchObject({ status: 'done' });
    // 5 minutes are left: not a break of 15.
    expect(await answer(1, T0 + 31_000 + 16 * 60_000)).toEqual({
      status: 'error',
      error: 'pause.error.duration',
    });
    store.state.pauses[0].minutes = 20;
    expect(await answer(2, T0 + 31_000 + 32 * 60_000)).toEqual({
      status: 'error',
      error: 'pause.unavailable.noMinutesLeft',
    });
    expect(store.state.pauses).toHaveLength(1);
  });

  it('do not start once their rule no longer allows breaks', async () => {
    const { store, answer } = await setup({ period: { kind: 'day' } });
    store.config.groups[0].pause.allowed = false;
    expect(await answer(0, T0 + 31_000)).toEqual({ status: 'error', error: 'pause.unavailable.notAllowed' });
    store.config.groups = [];
    expect(await answer(1, T0 + 31_000)).toEqual({ status: 'error', error: 'pause.unavailable.notAllowed' });
    expect(store.state.pauses).toEqual([]);
  });

  it('without a cost, the second one asked together is refused, not started', async () => {
    const { store } = await import('../../src/background/store');
    const pauses = await import('../../src/background/pauses');
    await store.ready();
    const g = pausable(
      group('G', ['video.test'], [{ intervention: BLOCK }]),
      { type: 'none' },
      {
        maxMinutes: 15,
        limit: { count: 1, period: { kind: 'day' } },
      },
    );
    store.config = { ...store.config, groups: [g] };
    const { compileConfig } = await import('../../src/engine/compile');
    store.cc = compileConfig(store.config);
    const both = await Promise.all([
      pauses.startPause({ groupId: 'G', minutes: 15 }),
      pauses.startPause({ groupId: 'G', minutes: 15 }),
    ]);
    expect(both).toContainEqual({ ticket: null });
    expect(both).toContainEqual({ ticket: null, error: 'pause.unavailable.noneLeft' });
    expect(store.state.pauses).toHaveLength(1);
  });
});

describe('rule installation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('runs one update at a time, so concurrent syncs never add duplicate rule ids (regression)', async () => {
    installFakeBrowser();
    const rules = new Map<number, unknown>();
    let active = 0;
    let overlap = false;
    (globalThis as any).chrome.declarativeNetRequest = {
      getDynamicRules: async () => [...rules.entries()].map(([id, r]) => ({ ...(r as object), id })),
      updateDynamicRules: async (o: { removeRuleIds?: number[]; addRules?: { id: number }[] }) => {
        active++;
        if (active > 1) overlap = true;
        await new Promise((r) => setTimeout(r, 5));
        for (const id of o.removeRuleIds ?? []) rules.delete(id);
        for (const r of o.addRules ?? []) {
          if (rules.has(r.id)) throw new Error(`Rule with id ${r.id} does not have a unique ID.`);
          rules.set(r.id, r);
        }
        active--;
      },
    };
    const { store } = await import('../../src/background/store');
    const { syncRules, dnrStatus } = await import('../../src/background/dnr-sync');
    const { compileConfig } = await import('../../src/engine/compile');
    await store.ready();
    store.config = {
      ...store.config,
      groups: [group('G', ['a.test', 'b.test/x'], [{ intervention: BLOCK }])],
    };
    store.cc = compileConfig(store.config);
    await Promise.all([syncRules(true), syncRules(true), syncRules(true)]);
    expect(overlap).toBe(false);
    expect(dnrStatus.lastError).toBeNull();
    expect(rules.size).toBeGreaterThan(0);
  });
});

describe('maintenance', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  it('forgets the activity of finished visits only', async () => {
    const { store } = await import('../../src/background/store');
    const { maintenance } = await import('../../src/background/reconcile');
    await store.ready();
    const now = Date.now();
    const gap = store.config.settings.tracking.visitGapMinutes * 60_000;
    store.state.activity = {
      'g:old': { last: now - gap - 60_000 },
      'g:new': { last: now - 1000 },
    };
    await maintenance();
    expect(Object.keys(store.state.activity)).toEqual(['g:new']);
  });
});

describe('protection per rule (#12)', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });
  afterEach(() => {
    vi.doUnmock('../../src/background/reconcile');
  });

  async function setup(groups: Group[]) {
    // Only the decision is under test: browser side effects (filters, alarms) are skipped.
    vi.doMock('../../src/background/reconcile', () => ({ reconcile: async () => {} }));
    const { store } = await import('../../src/background/store');
    const protection = await import('../../src/background/protection');
    const sessions = await import('../../src/background/sessions');
    const { compileConfig } = await import('../../src/engine/compile');
    await store.ready();
    store.config = { ...store.config, groups };
    store.cc = compileConfig(store.config);
    return { store, protection, sessions };
  }

  it('a loosening of one rule follows that rule only', async () => {
    const { store, protection } = await setup([
      group('Soft', ['soft.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
      group('Locked', ['locked.test'], [{ intervention: BLOCK }], { protection: PERMANENT }),
    ]);
    const next = structuredClone(store.config);
    next.groups[0].targets = [];
    const r = await protection.proposeConfig(next, 'test');
    expect(r.ticket?.step.type).toBe('confirm');
    next.groups = structuredClone(store.config.groups);
    next.groups[1].targets = [];
    expect((await protection.proposeConfig(next, 'test')).refused?.reason).toBe('permanent');
  });

  it('a setting follows every active rule; without any it applies at once', async () => {
    const t = await setup([
      group('Short', ['b.test'], [{ intervention: BLOCK }], { protection: wait(30) }),
      group('Long', ['s.test'], [{ intervention: BLOCK }], { protection: wait(86_400) }),
    ]);
    const next = structuredClone(t.store.config);
    next.settings.dayStart = 240;
    expect((await t.protection.proposeConfig(next, 'test')).pending).not.toBeNull();
    vi.resetModules();
    installFakeBrowser();
    const none = await setup([]);
    const empty = structuredClone(none.store.config);
    empty.settings.dayStart = 240;
    expect((await none.protection.proposeConfig(empty, 'test')).applied).toHaveLength(1);
  });

  it('ending a session early is a confirmation, whatever the protections of its rules', async () => {
    const { sessions } = await setup([
      group('Soft', ['soft.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
      group('Locked', ['locked.test'], [{ intervention: BLOCK }], { protection: PERMANENT }),
    ]);
    const start = (groups: string[], kind: 'groups' | 'allowlist' = 'groups', locked = false) =>
      sessions.startSession({
        kind,
        groups,
        allow: [],
        minutes: 60,
        locked,
        noPauses: false,
      } as never);
    for (const s of [await start(['Soft']), await start(['Soft', 'Locked']), await start([], 'allowlist')]) {
      const end = await sessions.endSession(s.id);
      expect(end.refused).toBeUndefined();
      expect(end.ticket?.step).toEqual({ type: 'confirm' });
      expect(end.ticket?.stepCount).toBe(1);
    }
    // Only a session that cannot be interrupted is refused.
    const locked = await start(['Soft'], 'groups', true);
    expect(await sessions.endSession(locked.id)).toEqual({ ticket: null, refused: 'session.error.locked' });
  });
});

describe('navigation errors of a blocked request', () => {
  it('recognises the errors of a blocking rule in Chrome and Firefox, not a navigation the user left', async () => {
    vi.resetModules();
    installFakeBrowser();
    const { BLOCKED_BY_RULE } = await import('../../src/background/enforce');
    for (const e of ['net::ERR_BLOCKED_BY_CLIENT', 'NS_ERROR_ABORT', 'Error code 2147500036'])
      expect(BLOCKED_BY_RULE.test(e), e).toBe(true);
    for (const e of [
      'net::ERR_ABORTED',
      'NS_BINDING_ABORTED',
      'Error code 2152398850',
      'net::ERR_NAME_NOT_RESOLVED',
    ])
      expect(BLOCKED_BY_RULE.test(e), e).toBe(false);
  });
});

describe('accesses for the visit end when no tab shows the site (#19)', () => {
  const tabs: Partial<chrome.tabs.Tab>[] = [];
  beforeEach(() => {
    vi.resetModules();
    tabs.length = 0;
    installFakeBrowser({ tabs });
    vi.doMock('../../src/background/reconcile', () => ({ reconcile: vi.fn(async () => {}) }));
  });
  afterEach(() => vi.doUnmock('../../src/background/reconcile'));

  async function setup(scope: 'page' | 'site' | 'group', mode: 'visit' | 'minutes' = 'visit') {
    const { store } = await import('../../src/background/store');
    const { endLeftVisits } = await import('../../src/background/intervention');
    const { compileConfig } = await import('../../src/engine/compile');
    await store.ready();
    store.config = {
      ...store.config,
      groups: [group('W', ['wait.test', 'other-wait.test'], [{ intervention: BLOCK }])],
    };
    store.cc = compileConfig(store.config);
    const t0 = Date.now();
    store.state.grants = [
      {
        id: 'pass',
        kind: 'pass',
        groups: ['W'],
        scope,
        url: scope === 'page' ? 'https://wait.test/a' : undefined,
        site: 'wait.test',
        createdAt: t0,
        severity: 7,
        ...(mode === 'visit' ? { visit: true } : { until: t0 + 600_000 }),
      },
    ];
    const ids = () => store.state.grants.map((g) => g.id);
    const pass = () => store.state.grants.find((g) => g.id === 'pass');
    return { endLeftVisits, ids, pass };
  }

  it('closing the last tab of the site ends the access', async () => {
    tabs.push({ id: 1, url: 'https://wait.test/a' }, { id: 2, url: 'https://elsewhere.test/' });
    const { endLeftVisits, ids } = await setup('site');
    await endLeftVisits();
    expect(ids()).toEqual(['pass']);
    tabs.splice(0, 1);
    await endLeftVisits({ closed: 1 });
    expect(ids()).toEqual([]);
  });

  it('another tab of the site, or the intervention page that gave it, keeps it', async () => {
    tabs.push({ id: 1, url: 'https://www.wait.test/b' });
    const { endLeftVisits, ids } = await setup('site');
    await endLeftVisits();
    expect(ids()).toEqual(['pass']);
    tabs[0] = { id: 1, url: 'chrome-extension://test/intervention.html#https://wait.test/a' };
    await endLeftVisits();
    expect(ids()).toEqual(['pass']);
  });

  it('a tab that is closing does not keep it, even when the browser still lists it', async () => {
    tabs.push({ id: 1, url: 'https://wait.test/a' });
    const { endLeftVisits, ids } = await setup('site');
    await endLeftVisits({ closed: 1 });
    expect(ids()).toEqual([]);
  });

  it('follows the scope: a page access needs that page, a rule access any site of the rule', async () => {
    tabs.push({ id: 1, url: 'https://wait.test/other' });
    let s = await setup('page');
    await s.endLeftVisits();
    expect(s.ids()).toEqual([]);
    vi.resetModules();
    tabs[0] = { id: 1, url: 'https://other-wait.test/' };
    s = await setup('group');
    await s.endLeftVisits();
    expect(s.ids()).toEqual(['pass']);
  });

  it('a tab that goes to sign in on another site and comes back keeps it', async () => {
    tabs.push({ id: 1, url: 'https://wait.test/' });
    const { endLeftVisits, ids, pass } = await setup('site');
    tabs[0] = { id: 1, url: 'https://accounts.google.test/signin' };
    await endLeftVisits({ navigated: 1 });
    expect(pass()).toMatchObject({ leftTab: 1 });
    const { leftAt } = pass()!;
    // The pages of the sign-in do not make it any longer.
    tabs[0] = { id: 1, url: 'https://accounts.google.test/challenge' };
    await endLeftVisits({ navigated: 1 });
    expect(pass()?.leftAt).toBe(leftAt);
    tabs[0] = { id: 1, url: 'https://wait.test/auth/callback' };
    await endLeftVisits({ navigated: 1 });
    expect(ids()).toEqual(['pass']);
    expect(pass()?.leftAt).toBeUndefined();
    expect(pass()?.leftTab).toBeUndefined();
  });

  it('a tab that stays away, or is closed while away, ends it', async () => {
    const { VISIT_RETURN_MS } = await import('../../src/engine/limits');
    tabs.push({ id: 1, url: 'https://elsewhere.test/' }, { id: 2, url: 'https://other.test/' });
    let s = await setup('site');
    await s.endLeftVisits({ navigated: 1 });
    // Another tab closing does not end it; the one that left does.
    tabs.splice(1, 1);
    await s.endLeftVisits({ closed: 2 });
    expect(s.ids()).toEqual(['pass']);
    await s.endLeftVisits({ closed: 1 });
    expect(s.ids()).toEqual([]);
    vi.resetModules();
    s = await setup('site');
    await s.endLeftVisits({ navigated: 1 });
    s.pass()!.leftAt! -= VISIT_RETURN_MS;
    await s.endLeftVisits({ navigated: 1 });
    expect(s.ids()).toEqual([]);
  });

  it('an access for a number of minutes is not a visit and stays', async () => {
    const { endLeftVisits, ids } = await setup('site', 'minutes');
    await endLeftVisits();
    expect(ids()).toEqual(['pass']);
  });
});
