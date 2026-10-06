import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Group } from '../../src/engine/types';
import { installFakeBrowser } from './fake-browser';
import { BLOCK, group } from './helpers';

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

describe('pauses covering several groups (BRK-03, BRK-05)', () => {
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

describe('rule installation (REL-01)', () => {
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

describe('first run protection level (PRO-02)', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });
  afterEach(() => {
    vi.doUnmock('../../src/background/reconcile');
  });

  async function strictWithoutRules() {
    // Only the decision is under test: browser side effects (filters, alarms) are skipped.
    vi.doMock('../../src/background/reconcile', () => ({ reconcile: async () => {} }));
    const { store } = await import('../../src/background/store');
    const protection = await import('../../src/background/protection');
    const sessions = await import('../../src/background/sessions');
    await store.ready();
    store.config = {
      ...store.config,
      groups: [],
      settings: {
        ...store.config.settings,
        protection: { ...store.config.settings.protection, level: 'strict' },
      },
    };
    const soft = () => {
      const next = structuredClone(store.config);
      next.settings.protection.level = 'soft';
      return protection.proposeConfig(next, 'test');
    };
    return { store, sessions, soft };
  }

  it('a gentler level is applied at once while nothing is protected', async () => {
    const { store, soft } = await strictWithoutRules();
    const r = await soft();
    expect(r.applied).toHaveLength(1);
    expect(store.config.settings.protection.level).toBe('soft');
  });

  it('a running focus session keeps the level protected, so its early end cannot be bypassed (regression)', async () => {
    const { store, sessions, soft } = await strictWithoutRules();
    const { id } = await sessions.startSession({
      kind: 'allowlist',
      allow: [],
      minutes: 60,
      locked: false,
      noPauses: false,
    } as never);
    const r = await soft();
    expect(r.applied).toHaveLength(0);
    expect(store.config.settings.protection.level).toBe('strict');
    expect((await sessions.endSession(id)).refused).toBe('session.error.strict');
  });
});
