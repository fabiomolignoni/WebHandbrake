import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileConfig } from '../../src/engine/compile';
import { MAX_STRETCH_MS } from '../../src/engine/limits';
import type { Group, Settings } from '../../src/engine/types';
import { type FakeBrowser, installFakeBrowser } from './fake-browser';
import { BLOCK, group } from './helpers';

const T0 = new Date(2026, 9, 5, 10).getTime();
const READER = `about:reader?url=${encodeURIComponent('https://news.test/a')}`;
const NEWS = [group('N', ['news.test'], [{ intervention: { type: 'track' } }])];

let fake: FakeBrowser;
const reconciled: string[] = [];

/** The background, started (again) on the storage of the fake browser. */
async function setup(groups: Group[] = NEWS, settings: (s: Settings) => void = () => {}) {
  vi.resetModules();
  vi.doMock('../../src/background/reconcile', () => ({
    reconcile: async (reason: string) => void reconciled.push(reason),
    broadcast: () => {},
  }));
  const { store } = await import('../../src/background/store');
  const accounting = await import('../../src/background/accounting');
  const tabtime = await import('../../src/background/tabtime');
  await store.ready();
  store.config = { ...store.config, groups };
  settings(store.config.settings);
  store.cc = compileConfig(store.config);
  tabtime.registerTabTimeListeners();
  const seconds = (key: string) => store.usage.days.get('2026-10-05')?.t[key] ?? [0, 0];
  /** The background counts up to `at`, as at its periodic alarm. */
  const count = (at: number) => {
    vi.setSystemTime(at);
    return tabtime.countTabTime();
  };
  return { store, accounting, tabtime, seconds, count };
}

/** The events of the tabs are handled in the background: until it has looked at them. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Shows a tab of window 1 at a moment, as the person switching to it. */
async function activate(tabId: number, at: number) {
  vi.setSystemTime(at);
  for (const tab of fake.tabs) tab.active = tab.id === tabId;
  fake.events.onActivated.fire({ tabId, windowId: 1 });
  await settle();
}

describe('the time of the reader view, counted by the background', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    reconciled.length = 0;
    fake = installFakeBrowser({
      tabs: [
        { id: 1, active: false, incognito: false, url: 'https://other.test/', windowId: 1 },
        { id: 2, active: false, incognito: false, url: READER, windowId: 1 },
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../src/background/reconcile');
  });

  it('a stretch on about:reader?url=https://news.test/a counts for the rule of news.test', async () => {
    const t = await setup();
    await activate(2, T0);
    await activate(1, T0 + 30_000);
    expect(t.seconds('g:N')).toEqual([30, 1]);
    expect(t.seconds('s:N:news.test')).toEqual([30, 1]);
    expect(t.seconds('h:news.test')).toEqual([30, 1]);
    expect(t.seconds('a:')).toEqual([30, 0]);
    // Nothing more once another tab is shown.
    await t.count(T0 + 90_000);
    expect(t.seconds('g:N')).toEqual([30, 1]);
  });

  it('goes on in stretches of a minute, which make one visit', async () => {
    const t = await setup();
    await activate(2, T0);
    await t.count(T0 + 60_000);
    expect(t.seconds('g:N')).toEqual([60, 1]);
    await t.count(T0 + 120_000);
    await t.count(T0 + 150_000);
    expect(t.seconds('g:N')).toEqual([150, 1]);
    // In the minute counters too, for the limits that start again every hour.
    expect(t.store.usage.minutes['g:N']).toBeDefined();
  });

  it('ends when the tab leaves the reader view or closes', async () => {
    const t = await setup();
    await activate(2, T0);
    vi.setSystemTime(T0 + 20_000);
    fake.tabs[1].url = 'https://news.test/a';
    fake.events.onUpdated.fire(2, { url: 'https://news.test/a' }, fake.tabs[1]);
    await settle();
    expect(t.seconds('g:N')).toEqual([20, 1]);
    // Back to the reader view, then closed.
    vi.setSystemTime(T0 + 30_000);
    fake.tabs[1].url = READER;
    fake.events.onUpdated.fire(2, { url: READER }, fake.tabs[1]);
    await settle();
    vi.setSystemTime(T0 + 40_000);
    fake.tabs.splice(1, 1);
    fake.events.onRemoved.fire(2, { windowId: 1, isWindowClosing: false });
    await settle();
    expect(t.seconds('g:N')).toEqual([30, 1]);
    await t.count(T0 + 100_000);
    expect(t.seconds('g:N')).toEqual([30, 1]);
  });

  it('not while another application is in front, the window is minimised or the person is away', async () => {
    const t = await setup();
    await activate(2, T0);
    /** Something changes at a moment, which the background hears of. */
    const change = async (at: number, fn: () => void) => {
      vi.setSystemTime(at);
      fn();
      await settle();
    };
    await change(T0 + 10_000, () => {
      fake.focus.windowId = -1;
      fake.events.onFocusChanged.fire(-1);
    });
    await t.count(T0 + 70_000);
    await change(T0 + 80_000, () => {
      fake.focus.windowId = 1;
      fake.events.onFocusChanged.fire(1);
    });
    await change(T0 + 90_000, () => {
      fake.windows.set(1, 'minimized');
      fake.events.onFocusChanged.fire(-1);
    });
    await t.count(T0 + 120_000);
    fake.windows.delete(1);
    await t.count(T0 + 130_000);
    await change(T0 + 140_000, () => {
      fake.idle.state = 'idle';
      fake.events.onIdle.fire('idle');
    });
    await t.count(T0 + 200_000);
    expect(t.seconds('g:N')[0]).toBe(10 + 10 + 10);
  });

  it('while the person is idle when idle time counts, but never with the screen locked', async () => {
    const t = await setup(NEWS, (s) => {
      s.tracking.idleEnabled = false;
    });
    fake.idle.state = 'idle';
    await activate(2, T0);
    await t.count(T0 + 60_000);
    expect(t.seconds('g:N')[0]).toBe(60);
    vi.setSystemTime(T0 + 70_000);
    fake.idle.state = 'locked';
    fake.events.onIdle.fire('locked');
    await settle();
    await t.count(T0 + 130_000);
    expect(t.seconds('g:N')[0]).toBe(70);
  });

  it('every open reader view with Count tabs that are open but not active', async () => {
    const t = await setup(NEWS, (s) => {
      s.tracking.countInactive = true;
    });
    fake.tabs.push({ id: 3, active: false, incognito: false, url: READER, windowId: 1 });
    await activate(1, T0);
    await t.count(T0 + 40_000);
    // One second per second, whatever the number of tabs.
    expect(t.seconds('g:N')).toEqual([40, 1]);
  });

  it('ticks of another tab on the same rule are not counted twice', async () => {
    const t = await setup(NEWS, (s) => {
      s.tracking.countInactive = true;
    });
    fake.tabs.push({ id: 3, active: true, incognito: false, url: 'https://news.test/b', windowId: 1 });
    const page = { tab: fake.tabs[2] } as chrome.runtime.MessageSender;
    await t.count(T0);
    // The page of tab 3 ticks for 5 s, then stops: the stretch adds the rest only.
    for (let s = 1; s <= 5; s++) {
      vi.setSystemTime(T0 + s * 1000);
      await t.accounting.onTick({ url: 'https://news.test/b', active: true, media: false }, page);
    }
    await t.count(T0 + 10_000);
    expect(t.seconds('g:N')).toEqual([10, 1]);
    // Ticking to the end, it leaves nothing to the stretch.
    for (let s = 11; s <= 20; s++) {
      vi.setSystemTime(T0 + s * 1000);
      await t.accounting.onTick({ url: 'https://news.test/b', active: true, media: false }, page);
    }
    await t.count(T0 + 20_000);
    expect(t.seconds('g:N')).toEqual([20, 1]);
  });

  it('a stretch with no news for long (the computer asleep) counts one second', async () => {
    const t = await setup();
    await activate(2, T0);
    await t.count(T0 + MAX_STRETCH_MS + 1);
    expect(t.seconds('g:N')[0]).toBe(1);
  });

  it('goes on after the background stopped: the stretch is kept in session storage', async () => {
    await setup();
    await activate(2, T0);
    expect(fake.session.get('tabTime')).toEqual([{ tabId: 2, url: READER, incognito: false, from: T0 }]);
    const t = await setup();
    await t.count(T0 + 45_000);
    expect(t.seconds('g:N')).toEqual([45, 1]);
    // Nothing left open once no reader view is in view.
    await activate(1, T0 + 50_000);
    expect(fake.session.has('tabTime')).toBe(false);
  });

  it('a page without rules counts only with Track time on all sites', async () => {
    let t = await setup([]);
    await activate(2, T0);
    await t.count(T0 + 30_000);
    expect(t.store.usage.days.get('2026-10-05')).toBeUndefined();
    t = await setup([], (s) => {
      s.tracking.allSites = true;
    });
    await t.count(T0 + 60_000);
    expect(t.seconds('h:news.test')).toEqual([30, 1]);
    expect(t.seconds('o:')).toEqual([30, 0]);
  });

  it('a limit that runs out applies at once, at the alarm set for it', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(T0);
    const t = await setup([
      group(
        'N',
        ['news.test'],
        [{ budget: { type: 'time', minutes: 1, period: { kind: 'day' } }, intervention: BLOCK }],
      ),
    ]);
    fake.tabs[1].active = true;
    await t.tabtime.countTabTime();
    expect(fake.alarms.get('whb-tab-time')).toEqual({ when: T0 + 60_000 + 200 });
    expect(reconciled).toEqual([]);
    // The timer, while the background runs, or the alarm.
    await vi.advanceTimersByTimeAsync(60_000 + 100);
    expect(t.seconds('g:N')[0]).toBeCloseTo(60.1);
    expect(reconciled).toEqual(['budget']);
    // The page is blocked now: nothing more to count, no alarm.
    expect(fake.alarms.has('whb-tab-time')).toBe(false);
  });

  it('Firefox for Android, without windows: the tab shown', async () => {
    delete (globalThis as { chrome?: { windows?: unknown } }).chrome!.windows;
    const t = await setup();
    await activate(2, T0);
    await t.count(T0 + 25_000);
    expect(t.seconds('g:N')[0]).toBe(25);
  });
});

describe('the time of the websites WebHandbrake has no access to, counted by the background', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    reconciled.length = 0;
    fake = installFakeBrowser({
      tabs: [
        { id: 1, active: false, incognito: false, url: 'https://other.test/', windowId: 1 },
        { id: 2, active: false, incognito: false, url: 'https://news.test/a', windowId: 1 },
      ],
    });
    // Chrome's "When you click the extension": no access to any website.
    fake.permissions.hostAccess = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../src/background/reconcile');
    vi.doUnmock('../../src/background/bridge');
  });

  /** The browser's permissions changed, as when the person gives the access back or takes it. */
  const permissionsChanged = async (at: number, hostAccess: boolean) => {
    vi.setSystemTime(at);
    fake.permissions.hostAccess = hostAccess;
    const { onPermissionsAdded, onPermissionsRemoved } = fake.events;
    (hostAccess ? onPermissionsAdded : onPermissionsRemoved).fire({ origins: ['<all_urls>'] });
    await settle();
  };

  it('the tab shown counts for the rules of its site, from the moment it opens a page there', async () => {
    const t = await setup();
    await activate(1, T0);
    // The tab shown opens a page of the rule.
    vi.setSystemTime(T0 + 5_000);
    fake.tabs[0].url = 'https://news.test/b';
    fake.events.onUpdated.fire(1, { url: 'https://news.test/b' }, fake.tabs[0]);
    await settle();
    await activate(2, T0 + 35_000);
    await activate(1, T0 + 50_000);
    expect(t.seconds('g:N')).toEqual([45, 1]);
    expect(t.seconds('h:news.test')).toEqual([45, 1]);
    // Another tab of the rule, not shown, does not count.
    await t.count(T0 + 110_000);
    vi.setSystemTime(T0 + 120_000);
    fake.events.onUpdated.fire(2, { url: 'https://news.test/c' }, fake.tabs[1]);
    await settle();
    await activate(1, T0 + 130_000);
    expect(t.seconds('g:N')[0]).toBe(45 + 80);
  });

  it('not on a site whose access was kept, where the page counts its own time', async () => {
    fake.permissions.sites = ['https://news.test/*'];
    const t = await setup();
    await activate(2, T0);
    await t.count(T0 + 30_000);
    expect(fake.session.has('tabTime')).toBe(false);
    expect(t.store.usage.days.get('2026-10-05')).toBeUndefined();
  });

  it('from the moment the access is taken back, until it is given back', async () => {
    fake.permissions.hostAccess = true;
    const t = await setup();
    await activate(2, T0);
    await t.count(T0 + 30_000);
    expect(t.store.usage.days.get('2026-10-05')).toBeUndefined();
    await permissionsChanged(T0 + 40_000, false);
    await t.count(T0 + 60_000);
    expect(t.seconds('g:N')[0]).toBe(20);
    await permissionsChanged(T0 + 70_000, true);
    await t.count(T0 + 130_000);
    expect(t.seconds('g:N')[0]).toBe(30);
    expect(fake.session.has('tabTime')).toBe(false);
  });

  it('a page that still ticks, loaded before the access was taken back, is not counted twice', async () => {
    const t = await setup();
    await activate(2, T0);
    const page = { tab: fake.tabs[1] } as chrome.runtime.MessageSender;
    for (let s = 1; s <= 20; s++) {
      vi.setSystemTime(T0 + s * 1000);
      await t.accounting.onTick({ url: 'https://news.test/a', active: true, media: false }, page);
    }
    await t.count(T0 + 30_000);
    expect(t.seconds('g:N')).toEqual([30, 1]);
    expect(t.seconds('a:')).toEqual([30, 0]);
  });

  it("Chrome: the tab shown in a private window in front, which that window's background tells", async () => {
    // Chrome's private windows have a background of their own, which only they can see.
    const shown = { id: 7, active: true, incognito: true, url: 'https://news.test/p', windowId: 2 };
    vi.doMock('../../src/background/bridge', async (original) => ({
      ...(await original<typeof import('../../src/background/bridge')>()),
      privateWindowsOpen: async () => true,
      callPrivate: async (fn: string, q?: chrome.tabs.QueryInfo) => {
        if (fn === 'windows.getLastFocused') return { id: 2, focused: true, state: 'normal' };
        if (fn === 'tabs.query') return q?.windowId === 2 ? [shown] : [];
        throw new Error(fn);
      },
    }));
    fake.focus.windowId = -1;
    const t = await setup();
    await t.count(T0);
    expect(fake.session.get('tabTime')).toEqual([{ tabId: 7, url: shown.url, incognito: true, from: T0 }]);
    await t.count(T0 + 30_000);
    // For the rule, without the site, as in every private window.
    expect(t.seconds('g:N')[0]).toBe(30);
    expect(t.seconds('p:')[0]).toBe(30);
    expect(t.seconds('h:news.test')[0]).toBe(0);
  });
});

describe('with Count tabs that are open but not active, the tabs not in view, counted by the background', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    reconciled.length = 0;
    fake = installFakeBrowser({
      tabs: [
        { id: 1, active: true, incognito: false, url: 'https://other.test/', windowId: 1 },
        { id: 2, active: false, incognito: false, url: 'https://news.test/a', windowId: 1 },
        { id: 3, active: false, incognito: false, url: 'https://news.test/b', windowId: 1 },
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../src/background/reconcile');
  });

  const countInactive = (s: Settings) => {
    s.tracking.countInactive = true;
  };

  it('every open tab of a rule, whose page no longer ticks once hidden, for all its time', async () => {
    fake.tabs.push({ id: 4, active: false, incognito: false, url: 'https://news.test/d', discarded: true });
    const t = await setup(NEWS, countInactive);
    await t.count(T0);
    // Only the tabs whose time counts: not the one without rules, nor one the browser unloaded.
    expect((fake.session.get('tabTime') as { tabId: number }[]).map((s) => s.tabId)).toEqual([2, 3]);
    // Hidden for 8 minutes, which Chrome would have counted as 8 seconds or so.
    for (let m = 1; m <= 8; m++) await t.count(T0 + m * 60_000);
    expect(t.seconds('g:N')).toEqual([480, 1]);
    expect(t.seconds('s:N:news.test')).toEqual([480, 1]);
    expect(t.seconds('h:news.test')).toEqual([480, 1]);
    expect(t.seconds('a:')).toEqual([480, 0]);
  });

  it('a page in view ticks as well: its seconds are not counted twice', async () => {
    const t = await setup(NEWS, countInactive);
    await activate(2, T0);
    const page = { tab: fake.tabs[1] } as chrome.runtime.MessageSender;
    for (let s = 1; s <= 45; s++) {
      vi.setSystemTime(T0 + s * 1000);
      await t.accounting.onTick({ url: 'https://news.test/a', active: true, media: false }, page);
    }
    await t.count(T0 + 60_000);
    expect(t.seconds('g:N')).toEqual([60, 1]);
    expect(t.seconds('h:news.test')).toEqual([60, 1]);
  });

  it('a tab that opens a page of a rule in the background counts from then on', async () => {
    const t = await setup(NEWS, countInactive);
    fake.tabs.splice(1, 2);
    await t.count(T0);
    expect(fake.session.has('tabTime')).toBe(false);
    vi.setSystemTime(T0 + 10_000);
    fake.tabs.push({ id: 4, active: false, incognito: false, url: 'https://news.test/c', windowId: 1 });
    fake.events.onUpdated.fire(4, { url: 'https://news.test/c' }, fake.tabs[1]);
    await settle();
    await t.count(T0 + 40_000);
    expect(t.seconds('g:N')[0]).toBe(30);
  });

  it('never with the screen locked', async () => {
    const t = await setup(NEWS, countInactive);
    await t.count(T0);
    vi.setSystemTime(T0 + 20_000);
    fake.idle.state = 'locked';
    fake.events.onIdle.fire('locked');
    await settle();
    await t.count(T0 + 80_000);
    expect(t.seconds('g:N')[0]).toBe(20);
  });
});
