import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileConfig } from '../../src/engine/compile';
import { delayIntervention } from '../../src/engine/defaults';
import type { Config, FocusSession, Group } from '../../src/engine/types';
import { type FakeBrowser, installFakeBrowser } from './fake-browser';
import { BLOCK, group, PERMANENT, REMINDER } from './helpers';

const T0 = new Date(2026, 9, 5, 10).getTime();
const PAGE = 'chrome-extension://test/intervention.html';
const office = { mode: 'during' as const, windows: [{ days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 }] };

let fake: FakeBrowser;

async function setup(groups: Group[], patch: (c: Config) => void = () => {}) {
  const { store } = await import('../../src/background/store');
  const reconcile = await import('../../src/background/reconcile');
  const enforce = await import('../../src/background/enforce');
  await store.ready();
  store.config = { ...store.config, groups };
  patch(store.config);
  store.cc = compileConfig(store.config);
  return { store, reconcile, enforce };
}

function session(patch: Partial<FocusSession>): FocusSession {
  return {
    id: 's',
    kind: 'groups',
    groups: [],
    allow: [],
    startAt: T0 - 60_000,
    endAt: T0 + 3_600_000,
    createdAt: T0,
    locked: false,
    noPauses: false,
    ...patch,
  };
}

describe('reconciliation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ now: T0 });
    fake = installFakeBrowser({
      tabs: [
        { id: 1, url: 'https://a.test/page', active: true, incognito: false },
        { id: 2, url: 'https://free.test/', active: false, incognito: false },
      ],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('installs the filters, content scripts, menus, the next alarm and the badges; restricts open tabs', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ schedule: office, intervention: BLOCK }]),
      group('B', ['b.test'], [{ intervention: { type: 'track' } }]),
    ]);
    await t.reconcile.reconcile('test', { config: true });
    expect(fake.rules.size).toBeGreaterThan(0);
    expect(fake.scripts[0].matches).toEqual([
      '*://*.a.test/*',
      '*://*.b.test/*',
      '*://a.test/*',
      '*://b.test/*',
    ]);
    expect(fake.menus.map((m) => m.id)).toContain('site|A');
    expect(fake.alarms.get('whb-next')?.when).toBe(new Date(2026, 9, 5, 17).getTime() + 200);
    expect(fake.alarms.has('whb-next')).toBe(true);
    expect(fake.tabs[0].url).toBe(`${PAGE}#https://a.test/page`);
    expect(fake.tabs[1].url).toBe('https://free.test/');
    expect(fake.broadcasts).toContainEqual({ whb: 1, changed: ['state', 'config'] });
  });

  it('calls made before a run starts are merged into it', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: { type: 'track' } }])]);
    const { counters } = await import('../../src/background/diagnostics-state');
    await Promise.all([t.reconcile.reconcile('1'), t.reconcile.reconcile('2'), t.reconcile.reconcile('3')]);
    expect(counters.reconciles).toBe(1);
    await t.reconcile.reconcile('4');
    expect(counters.reconciles).toBe(2);
  });

  it('a tab where the person is typing gets its grace period first', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    fake.contentReply.fn = (_tab, m) => (m.cmd === 'prepare' ? { grace: 30 } : undefined);
    await t.reconcile.reconcile('test');
    expect(fake.tabs[0].url).toBe('https://a.test/page');
    expect(fake.messages).toContainEqual({ tabId: 1, message: { whb: 1, cmd: 'prepare', graceSeconds: 45 } });
    // At the end of the grace period the tab is restricted.
    await t.enforce.finishGrace(1);
    expect(fake.tabs[0].url).toBe(`${PAGE}#https://a.test/page`);
  });

  it('a rule for the tabs in the background leaves the active tab alone', async () => {
    const g = group('A', ['a.test', 'free.test'], [{ intervention: BLOCK }]);
    g.options.tabs = 'inactive';
    const t = await setup([g]);
    await t.reconcile.reconcile('test');
    expect(fake.tabs.map((x) => x.url)).toEqual(['https://a.test/page', `${PAGE}#https://free.test/`]);
  });

  it('pages restricted no more are reopened on request', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    await t.reconcile.reconcile('test');
    t.store.config.groups[0].enabled = false;
    t.store.cc = compileConfig(t.store.config);
    expect((await t.enforce.restorableTabs()).map((x) => x.id)).toEqual([1]);
    expect(await t.enforce.reopenBlockedTabs()).toBe(1);
    expect(fake.tabs[0].url).toBe('https://a.test/page');
  });
});

describe('maintenance', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ now: T0 });
    fake = installFakeBrowser();
  });
  afterEach(() => vi.useRealTimers());

  it('the time chosen at the question ends, with no cool-down after it (not even of earlier versions)', async () => {
    const t = await setup([
      group('Q', ['q.test'], [{ intervention: { type: 'ask', maxMinutes: 5, minReasonLength: 1 } }]),
    ]);
    const old = {
      id: 'g',
      kind: 'pass' as const,
      groups: ['Q'],
      scope: 'site' as const,
      site: 'q.test',
      createdAt: T0 - 600_000,
      until: T0 - 1000,
      severity: 4,
      cooldownMinutes: 10,
    };
    t.store.state.grants.push(old);
    await t.reconcile.maintenance();
    expect(t.store.state.grants).toEqual([]);
    expect(t.store.state.cooldowns).toEqual({});
  });

  it('timed state expires; ended sessions and ready changes are notified once', async () => {
    const t = await setup([], (c) => {
      c.settings.notifications.enabled = true;
    });
    const st = t.store.state;
    st.cooldowns.old = { until: T0 - 1, group: 'A', kind: 'session' };
    st.cooldowns.live = { until: T0 + 1, group: 'A', kind: 'session' };
    st.forfeits.old = T0 - 1;
    st.sessions.push(
      session({ id: 'done', endAt: T0 - 1000, stopped: 3 }),
      session({ id: 'gone', endAt: T0 - 120_000, notified: true }),
    );
    st.pending.push(
      { id: 'ready', createdAt: 0, readyAt: T0 - 1, expiresAt: T0 + 1000, units: [] },
      { id: 'expired', createdAt: 0, readyAt: 0, expiresAt: T0 - 1, units: [] },
    );
    await t.reconcile.maintenance();
    await t.reconcile.maintenance();
    expect(Object.keys(st.cooldowns)).toEqual(['live']);
    expect(st.forfeits).toEqual({});
    expect(st.sessions.map((s) => s.id)).toEqual(['done']);
    expect(st.pending.map((p) => p.id)).toEqual(['ready']);
    expect(fake.notifications.map((n) => n.id)).toEqual(['session-done', 'pending-ready']);
    expect(st.lastAlive).toBe(T0);
    // A session ended over a minute ago and already notified is forgotten.
    vi.setSystemTime(T0 + 120_000);
    await t.reconcile.maintenance();
    expect(st.sessions).toEqual([]);
  });
});

describe('browser settings pages', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ now: T0 });
    fake = installFakeBrowser();
  });
  afterEach(() => vi.useRealTimers());

  it('are recognised with their sub-pages, in every browser', async () => {
    const { isProtectedInternal } = await import('../../src/background/enforce');
    for (const url of [
      'about:addons',
      'chrome://extensions/?id=x',
      'chrome://extensions/shortcuts',
      'chrome://flags',
      'chrome://settings/reset',
      'chrome://settings/resetProfileSettings?origin=userclick',
      'edge://settings/triggeredResetProfileSettings',
      'ABOUT:CONFIG',
    ])
      expect(isProtectedInternal(url), url).toBe(true);
    // The settings that cannot turn the extension off stay open (passwords, privacy, search…).
    for (const url of [
      'about:blank',
      'about:preferences',
      'chrome://newtab',
      'chrome://extensionsx',
      'chrome://settings',
      'chrome://settings/passwords',
      'chrome://settings/clearBrowserData',
      'edge://settings/privacy',
      'https://chrome.test/settings',
    ])
      expect(isProtectedInternal(url), url).toBe(false);
  });

  it('are blocked while a firm rule restricts or a session cannot be interrupted, unless a break says otherwise', async () => {
    const firm = group('Firm', ['a.test'], [{ intervention: BLOCK }], { protection: PERMANENT });
    const soft = group('Soft', ['b.test'], [{ intervention: BLOCK }], { protection: REMINDER });
    const t = await setup([soft]);
    t.store.config.settings.protection.internalPages = 'auto';
    const blocked = () => t.enforce.internalPagesBlocked();
    expect(blocked()).toBe(false);
    t.store.state.sessions.push(session({ locked: true }));
    expect(blocked()).toBe(true);
    t.store.state.sessions = [];
    t.store.config.groups.push(firm);
    t.store.cc = compileConfig(t.store.config);
    expect(blocked()).toBe(true);
    // A rule that restricts nothing now does not count.
    firm.policies = [
      { ...firm.policies[0], intervention: delayIntervention(5), schedule: { mode: 'during', windows: [] } },
    ];
    t.store.cc = compileConfig(t.store.config);
    expect(blocked()).toBe(false);
    t.store.config.settings.protection.internalPages = 'always';
    expect(blocked()).toBe(true);
    t.store.config.settings.protection.internalPagesFollowPause = true;
    t.store.state.grants.push({
      id: 'p',
      kind: 'pause',
      groups: '*',
      scope: 'all',
      createdAt: T0,
      until: T0 + 60_000,
      severity: 99,
    });
    expect(blocked()).toBe(false);
    t.store.config.settings.protection.internalPages = 'never';
    t.store.state.grants = [];
    expect(blocked()).toBe(false);
  });

  it('say why they are blocked and when they open again', async () => {
    const firm = group('Firm', ['a.test'], [{ intervention: BLOCK }], { protection: PERMANENT });
    const t = await setup([]);
    t.store.config.settings.protection.internalPages = 'auto';
    t.store.state.sessions.push(session({ locked: true }));
    expect(t.enforce.internalGuard()).toEqual({ always: false, groups: [], session: true });
    expect(t.enforce.internalGuardUntil()).toBe(T0 + 3_600_000);
    // A rule that always applies keeps them blocked once the session is over.
    t.store.config.groups.push(firm);
    t.store.cc = compileConfig(t.store.config);
    expect(t.enforce.internalGuard()?.groups.map((g) => g.name)).toEqual(['Firm']);
    expect(t.enforce.internalGuardUntil()).toBeNull();
    // Locked is firm until its date, then asks only for a reminder.
    firm.protection = { kind: 'locked', until: T0 + 7_200_000 };
    t.store.cc = compileConfig(t.store.config);
    expect(t.enforce.internalGuardUntil()).toBe(T0 + 7_200_000);
    t.store.config.settings.protection.internalPages = 'always';
    expect(t.enforce.internalGuard()).toEqual({ always: true, groups: [], session: false });
    expect(t.enforce.internalGuardUntil()).toBeNull();
  });
});

describe('navigation listeners', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ now: T0 });
    fake = installFakeBrowser({
      tabs: [{ id: 1, url: 'https://free.test/', active: true, incognito: false }],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('a committed navigation to a restricted page shows the intervention; closing it counts an impulse resisted', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    const committed: string[] = [];
    t.enforce.registerNavigationListeners((_tab, url) => committed.push(url));
    t.enforce.registerTabListeners(
      () => {},
      () => {},
    );
    fake.events.onCommitted.fire({ tabId: 1, frameId: 0, url: 'https://a.test/x' });
    // Frames and tabs that are not tabs are ignored.
    fake.events.onCommitted.fire({ tabId: 1, frameId: 3, url: 'https://a.test/frame' });
    await vi.waitFor(() => expect(fake.tabs[0].url).toBe(`${PAGE}#https://a.test/x`));
    expect(committed).toEqual(['https://a.test/x']);
    fake.events.onCommitted.fire({ tabId: 1, frameId: 0, url: `${PAGE}#https://a.test/x` });
    await vi.waitFor(() =>
      expect(t.enforce.interventionTabs.get(1)).toMatchObject({ groupId: 'A', proceeded: false }),
    );
    fake.events.onRemoved.fire(1);
    await vi.waitFor(() => expect(t.store.usage.counterSum('left:A', ['2026-10-05'])).toBe(1));
  });

  it('a page replaced by a change of the rules is remembered, one replaced as time goes by is not', async () => {
    const t = await setup([group('A', ['free.test'], [{ intervention: BLOCK }])]);
    await t.enforce.enforceTab(
      { ...fake.tabs[0], id: 1, url: 'https://free.test/' } as chrome.tabs.Tab,
      'state',
    );
    expect(t.enforce.replacedTabs.has(1)).toBe(false);
    await t.enforce.enforceTab(
      { ...fake.tabs[0], id: 1, url: 'https://free.test/' } as chrome.tabs.Tab,
      'config',
    );
    expect(t.enforce.replacedTabs.get(1)).toBe('https://free.test/');
  });

  it('without access to the sites, a request stopped by a filter is turned into the intervention page', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    const { dnrStatus } = await import('../../src/background/dnr-sync');
    dnrStatus.hostAccess = false;
    t.enforce.registerNavigationListeners(() => {});
    fake.events.onErrorOccurred.fire({
      tabId: 1,
      frameId: 0,
      url: 'https://a.test/',
      error: 'net::ERR_ABORTED',
    });
    fake.events.onErrorOccurred.fire({
      tabId: 1,
      frameId: 0,
      url: 'https://a.test/',
      error: 'net::ERR_BLOCKED_BY_CLIENT',
    });
    await vi.waitFor(() => expect(fake.tabs[0].url).toBe(`${PAGE}#https://a.test/`));
  });
});
