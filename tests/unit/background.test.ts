import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Group } from '../../src/engine/types';
import { installFakeBrowser } from './fake-browser';
import { BLOCK, group, PERMANENT, REMINDER, wait } from './helpers';

function pausable(g: Group, cost: Group['pause']['cost'], patch: Partial<Group['pause']> = {}): Group {
  g.pause = {
    ...g.pause,
    allowed: true,
    scopes: ['page', 'site', 'group', 'all'],
    reason: 'none',
    cost,
    ...patch,
  };
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
    return pauses;
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

  it('a pause of everything follows the rules of the groups that are not on the page (regression)', async () => {
    const { pauseOptions, startPause } = await setup([
      pausable(group('Free', ['news.test'], [{ intervention: BLOCK }]), { type: 'none' }),
      pausable(
        group('Strict', ['games.test'], [{ intervention: BLOCK }]),
        { type: 'challenge', kind: 'random', length: 40 },
        { duration: { mode: 'upTo', minutes: 5 } },
      ),
    ]);
    const o = pauseOptions('https://news.test/');
    expect(o.costs).toEqual([]);
    expect(o.all?.costs).toEqual([{ type: 'challenge', kind: 'random', length: 40 }]);
    expect(o.all?.duration.minutes).toBe(5);
    // The page pause is free, a pause of everything is not.
    const all = await startPause({ url: 'https://news.test/', scope: 'all', minutes: 5 });
    expect(all.ticket?.step.type).toBe('text');
    expect(await startPause({ url: 'https://news.test/', scope: 'all', minutes: 10 })).toEqual({
      ticket: null,
      error: 'pause.error.duration',
    });
  });

  it('the reason typed before starting a break survives a restart of the background', async () => {
    const { store } = await import('../../src/background/store');
    await store.ready();
    const g = pausable(
      group('A', ['news.test'], [{ intervention: BLOCK }]),
      { type: 'confirm' },
      {
        reason: 'required',
      },
    );
    await store.writeConfig({ ...store.config, groups: [g] }, 'test');
    const { startPause } = await import('../../src/background/pauses');
    const { ticket } = await startPause({
      url: 'https://news.test/',
      scope: 'site',
      minutes: 5,
      reason: '  a video for my course  ',
    });
    expect(ticket?.step.type).toBe('confirm');
    // The browser stops the background while the cost is being paid.
    vi.resetModules();
    const again = await import('../../src/background/store');
    await import('../../src/background/pauses');
    const { answerTicket } = await import('../../src/background/tickets');
    expect(await answerTicket(ticket!.id, '')).toMatchObject({ status: 'done' });
    expect(again.store.state.pauses.map((p) => p.reason)).toEqual(['a video for my course']);
  });

  it('does not offer "all" when a group elsewhere does not allow it', async () => {
    const { pauseOptions } = await setup([
      pausable(group('Free', ['news.test'], [{ intervention: BLOCK }]), { type: 'none' }),
      pausable(
        group('Strict', ['games.test'], [{ intervention: BLOCK }]),
        { type: 'none' },
        {
          scopes: ['page', 'site'],
        },
      ),
    ]);
    expect(pauseOptions('https://news.test/').scopes).toEqual(['page', 'site', 'group']);
  });
});

describe('extending a break', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  async function setup(patch: Partial<Group['pause']> = {}) {
    const { store } = await import('../../src/background/store');
    const pauses = await import('../../src/background/pauses');
    await store.ready();
    const g = pausable(
      group('G', ['video.test'], [{ intervention: BLOCK }]),
      { type: 'none' },
      {
        duration: { mode: 'upTo', minutes: 15 },
        limit: { count: 1, period: { kind: 'day' } },
        ...patch,
      },
    );
    store.config = { ...store.config, groups: [g] };
    const { compileConfig } = await import('../../src/engine/compile');
    store.cc = compileConfig(store.config);
    return { store, ...pauses };
  }

  const url = 'https://video.test/watch?v=1';

  it('a running break is extended, not taken again, so the limit of breaks is untouched (regression)', async () => {
    const { store, pauseOptions, startPause } = await setup();
    await startPause({ url, scope: 'site', minutes: 5 });
    const [grant] = store.state.grants;
    const until = grant.until!;
    const o = pauseOptions(url);
    // The last break of the day is running: extending it is still possible.
    expect(o.available).toBe(true);
    expect(o.extend).toEqual({ grantId: grant.id, scope: 'site', minutes: 5 });
    expect(o.scopes).toEqual(['site']);
    expect(o.duration.minutes).toBe(10);
    expect(o.remainingCount).toBeNull();

    expect(await startPause({ url, scope: 'site', minutes: 4, extend: grant.id })).toEqual({ ticket: null });
    expect(store.state.grants).toHaveLength(1);
    expect(store.state.grants[0].until).toBe(until + 4 * 60_000);
    expect(store.state.grants[0].minutes).toBe(9);
    expect(store.state.pauses).toHaveLength(1);
    expect(store.state.pauses[0]).toMatchObject({ minutes: 9, site: 'video.test' });
  });

  it('a break is extended at most to the longest a break can last', async () => {
    const { pauseOptions, startPause, store } = await setup();
    await startPause({ url, scope: 'site', minutes: 10 });
    const id = store.state.grants[0].id;
    expect(await startPause({ url, scope: 'site', minutes: 6, extend: id })).toEqual({
      ticket: null,
      error: 'pause.error.duration',
    });
    await startPause({ url, scope: 'site', minutes: 5, extend: id });
    const o = pauseOptions(url);
    expect(o.available).toBe(false);
    expect(o.reason).toBe('pause.unavailable.longest');
    expect(o.extend?.minutes).toBe(15);
  });

  it('extending costs what a break costs, without asking the reason again', async () => {
    const { pauseOptions, startPause, store } = await setup({
      cost: { type: 'confirm' },
      reason: 'required',
    });
    const first = await startPause({ url, scope: 'site', minutes: 5, reason: 'a call' });
    const { answerTicket } = await import('../../src/background/tickets');
    expect(await answerTicket(first.ticket!.id, '')).toMatchObject({ status: 'done' });
    expect(store.state.grants).toHaveLength(1);
    expect(pauseOptions(url).reasonMode).toBe('none');
    const more = await startPause({ url, scope: 'site', minutes: 5, extend: store.state.grants[0].id });
    expect(more.ticket?.step.type).toBe('confirm');
  });

  it('a break that has ended cannot be extended', async () => {
    const { startPause, cancelPause, store } = await setup();
    await startPause({ url, scope: 'site', minutes: 5 });
    const id = store.state.grants[0].id;
    await cancelPause(id);
    expect(await startPause({ url, scope: 'site', minutes: 5, extend: id })).toEqual({
      ticket: null,
      error: 'pause.error.ended',
    });
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
      'g:old': { last: now - gap - 60_000, visitStart: 0, visitSeconds: 10, run: 10 },
      'g:new': { last: now - 1000, visitStart: now - 5000, visitSeconds: 4, run: 4 },
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
    return { endLeftVisits, ids };
  }

  it('closing the last tab of the site ends the access', async () => {
    tabs.push({ id: 1, url: 'https://wait.test/a' }, { id: 2, url: 'https://elsewhere.test/' });
    const { endLeftVisits, ids } = await setup('site');
    await endLeftVisits();
    expect(ids()).toEqual(['pass']);
    tabs.splice(0, 1);
    await endLeftVisits(1);
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
    await endLeftVisits(1);
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

  it('an access for a number of minutes is not a visit and stays', async () => {
    const { endLeftVisits, ids } = await setup('site', 'minutes');
    await endLeftVisits();
    expect(ids()).toEqual(['pass']);
  });
});
