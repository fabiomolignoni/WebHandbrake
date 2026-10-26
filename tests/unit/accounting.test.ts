import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileConfig } from '../../src/engine/compile';
import { USAGE_FLUSH_MS } from '../../src/engine/limits';
import type { Group, Settings } from '../../src/engine/types';
import { type FakeBrowser, installFakeBrowser } from './fake-browser';
import { BLOCK, group } from './helpers';

const T0 = new Date(2026, 9, 5, 10).getTime();
const day = { kind: 'day' as const };

let fake: FakeBrowser;
const reconciled: string[] = [];

async function setup(groups: Group[], settings: (s: Settings) => void = () => {}) {
  vi.doMock('../../src/background/reconcile', () => ({
    reconcile: async (reason: string) => void reconciled.push(reason),
    broadcast: () => {},
  }));
  const { store } = await import('../../src/background/store');
  const accounting = await import('../../src/background/accounting');
  await store.ready();
  store.config = { ...store.config, groups };
  settings(store.config.settings);
  store.cc = compileConfig(store.config);
  const tab = (id = 1, patch: Partial<chrome.tabs.Tab> = {}) => {
    const t = { id, active: true, incognito: false, url: 'https://a.test/', ...patch };
    if (!fake.tabs.some((x) => x.id === id)) fake.tabs.push(t);
    return { tab: t } as chrome.runtime.MessageSender;
  };
  /** A tick from the content script of a tab at a moment. */
  const tick = (at: number, url = 'https://a.test/', sender = tab(), patch: Record<string, unknown> = {}) => {
    vi.setSystemTime(at);
    return accounting.onTick({ url, active: true, media: false, ...patch }, sender);
  };
  const seconds = (key: string) => store.usage.days.get('2026-10-05')?.t[key] ?? [0, 0];
  return { store, accounting, tick, tab, seconds };
}

describe('counting time', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    reconciled.length = 0;
    fake = installFakeBrowser();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../src/background/reconcile');
  });

  it('one second per second for a rule and its site, whatever the number of tabs', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: { type: 'track' } }])]);
    await t.tick(T0, 'https://a.test/', t.tab(1));
    await t.tick(T0, 'https://a.test/x', t.tab(2));
    await t.tick(T0 + 1000, 'https://a.test/', t.tab(1));
    await t.tick(T0 + 1000, 'https://a.test/x', t.tab(2));
    expect(t.seconds('g:A')).toEqual([2, 1]);
    expect(t.seconds('s:A:a.test')).toEqual([2, 1]);
    expect(t.seconds('h:a.test')).toEqual([2, 1]);
    expect(t.seconds('a:')).toEqual([2, 0]);
  });

  it('a gap (sleep, a locked screen) counts one second, not the whole gap', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: { type: 'track' } }])]);
    await t.tick(T0);
    await t.tick(T0 + 60_000);
    expect(t.seconds('g:A')[0]).toBe(2);
  });

  it('nothing is counted for an inactive page, a locked system, a site without rules or a rule that allows', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ intervention: { type: 'track' } }]),
      group('Free', ['free.test'], [{ intervention: { type: 'allow' } }]),
    ]);
    await t.tick(T0, 'https://a.test/', t.tab(), { active: false });
    t.accounting.setIdleState('locked');
    await t.tick(T0 + 1000);
    t.accounting.setIdleState('active');
    await t.tick(T0 + 2000, 'https://none.test/');
    await t.tick(T0 + 3000, 'https://free.test/');
    expect(t.store.usage.days.get('2026-10-05')).toBeUndefined();
  });

  it('every site when asked; private windows count for the rules but keep no site detail', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: { type: 'track' } }])], (s) => {
      s.tracking.allSites = true;
    });
    await t.tick(T0, 'https://elsewhere.test/');
    expect(t.seconds('h:elsewhere.test')).toEqual([1, 1]);
    // The time outside the rules has a total of its own.
    expect(t.seconds('o:')).toEqual([1, 0]);
    await t.tick(T0 + 1000, 'https://a.test/', t.tab(7, { incognito: true }));
    await t.tick(T0 + 2000, 'https://a.test/x', t.tab(8, { incognito: true }));
    expect(t.seconds('g:A')[0]).toBe(2);
    expect(t.seconds('h:a.test')).toEqual([0, 0]);
    // One total of the time in private windows instead, with the visits of their sites, so that
    // the sites add up: outside the rules too.
    expect(t.seconds('p:')).toEqual([2, 1]);
    await t.tick(T0 + 3000, 'https://elsewhere.test/', t.tab(7, { incognito: true }));
    expect(t.seconds('p:')).toEqual([3, 2]);
    expect(t.seconds('a:')).toEqual([2, 0]);
    expect(t.seconds('o:')).toEqual([2, 0]);
    // Its sites stay unknown: no key names them.
    expect(Object.keys(t.store.usage.days.get('2026-10-05')!.t).sort()).toEqual([
      'a:',
      'g:A',
      'h:elsewhere.test',
      'o:',
      'p:',
      's:A:a.test',
    ]);
    // The hours by site add up to the hours of the totals, also without a name.
    const rec = t.store.usage.days.get('2026-10-05')!;
    expect(rec.h).toEqual({ '10': 2 });
    expect(rec.hk).toEqual({ 'o:': { '10': 2 }, 'h:elsewhere.test': { '10': 1 }, 'p:': { '10': 3 } });
  });

  it('by site, tabs counted at the same time share the seconds of the total', async () => {
    const t = await setup([group('A', ['a.test', 'b.test'], [{ intervention: { type: 'track' } }])], (s) => {
      s.tracking.countInactive = true;
    });
    for (let i = 0; i < 4; i++) {
      await t.tick(T0 + i * 1000, 'https://a.test/', t.tab(1));
      await t.tick(T0 + i * 1000 + 500, 'https://b.test/', t.tab(2));
    }
    // Each site has been open for the whole time, which the rule counts once.
    expect(t.seconds('a:')[0]).toBe(4.5);
    expect(t.seconds('g:A')[0]).toBe(4.5);
    expect(t.seconds('h:a.test')[0] + t.seconds('h:b.test')[0]).toBe(4.5);
    expect(t.seconds('h:a.test')[1]).toBe(1);
    expect(t.seconds('h:b.test')[1]).toBe(1);
  });

  it('a rule over every website counts the time of each site on its own (#20)', async () => {
    const t = await setup([group('Everywhere', ['*'], [{ intervention: { type: 'track' } }])]);
    await t.tick(T0, 'https://first.test/');
    await t.tick(T0 + 1000, 'https://second.test/page');
    expect(t.seconds('g:Everywhere')[0]).toBe(2);
    expect(t.seconds('h:first.test')[0]).toBe(1);
    expect(t.seconds('h:second.test')[0]).toBe(1);
  });

  it('counters reach the storage within seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(T0);
    const t = await setup([group('A', ['a.test'], [{ intervention: { type: 'track' } }])]);
    await t.tick(T0);
    await t.tick(T0 + 1000);
    expect(fake.local.has('u:2026-10-05')).toBe(false);
    await vi.advanceTimersByTimeAsync(USAGE_FLUSH_MS);
    expect(fake.local.get('u:2026-10-05')).toMatchObject({ t: { 'g:A': [2, 1] } });
  });

  it('a new visit starts after the visit gap', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: { type: 'track' } }])]);
    await t.tick(T0);
    await t.tick(T0 + 4 * 60_000);
    await t.tick(T0 + 10 * 60_000);
    expect(t.seconds('g:A')[1]).toBe(2);
  });

  it('a limit that runs out applies at once', async () => {
    const t = await setup([
      group(
        'A',
        ['a.test'],
        [{ budget: { type: 'time', minutes: 2 / 60, period: day }, intervention: BLOCK }],
      ),
    ]);
    await t.tick(T0);
    expect(reconciled).toEqual([]);
    await t.tick(T0 + 1000);
    expect(reconciled).toContain('budget');
  });
});

describe('what the page shows', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    reconciled.length = 0;
    fake = installFakeBrowser();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../src/background/reconcile');
  });

  it('the filters of the rules, together', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ intervention: { type: 'filter', filter: 'grayscale', intensity: 50 } }]),
      group('B', ['a.test'], [{ intervention: { type: 'filter', filter: 'blur', intensity: 30 } }]),
    ]);
    const res = await t.tick(T0);
    expect(res.filter).toEqual({ css: 'grayscale(50%) blur(3px)' });
    // A filter leaves the sound alone.
    expect((fake.tabs[0] as { muted?: boolean }).muted).toBeUndefined();
  });

  it('a timer near the limit, a warning once (with a notification when allowed), labels when asked', async () => {
    const t = await setup(
      [group('A', ['a.test'], [{ budget: { type: 'time', minutes: 1, period: day }, intervention: BLOCK }])],
      (s) => {
        s.notifications.enabled = true;
      },
    );
    const res = await t.tick(T0, 'https://a.test/', t.tab(), { labels: true });
    expect(res.timer).toMatchObject({ label: 'A', kind: 'budget' });
    expect(res.timer!.seconds).toBeCloseTo(59, 0);
    expect(res.warning?.text).toMatch(/A/);
    expect(res.labels?.__locale).toBe('en');
    expect(res.labels?.['overlay.timerLeft']).toContain('{group}');
    await t.tick(T0 + 1000);
    expect(fake.notifications).toHaveLength(1);
  });

  it('the reason given to go in is recalled once per access', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ intervention: { type: 'ask', maxMinutes: 5, minReasonLength: 1 } }]),
    ]);
    t.store.state.grants.push({
      id: 'pass',
      kind: 'pass',
      groups: ['A'],
      scope: 'site',
      site: 'a.test',
      createdAt: T0,
      until: T0 + 5 * 60_000,
      severity: 4,
      intention: 'reply to Ada',
    });
    expect((await t.tick(T0)).intention).toEqual({ text: 'reply to Ada', until: T0 + 5 * 60_000 });
    expect((await t.tick(T0 + 1000)).intention).toBeNull();
  });

  it('a page that is replaced gets no filter and counts nothing', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    const res = await t.tick(T0);
    expect(res).toMatchObject({ tracked: true, filter: null, timer: null });
    expect(t.store.usage.days.size).toBe(0);
  });
});

describe('a page that refuses to leave', () => {
  const PAGE = 'chrome-extension://test/intervention.html#https://a.test/';
  /** Lets the calls started by a tick finish. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
  };
  const prepared = () => fake.messages.filter((m) => m.message.cmd === 'prepare').length;
  /** "Leave site?" → Stay: the tab keeps its page. */
  const stay = () => {
    fake.tabs[0].url = 'https://a.test/';
  };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ now: T0 });
    reconciled.length = 0;
    fake = installFakeBrowser();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../src/background/reconcile');
  });

  it('is asked again, covered once it stayed, and asked every few seconds', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    // Not asked yet: the reconciliation that asks may be on its way. The page reports meanwhile.
    expect(await t.tick(T0)).toMatchObject({ leaving: true, cover: false });
    await t.tick(T0 + 4000);
    await settle();
    expect(fake.tabs[0].url).toBe('https://a.test/');
    // Asked a few seconds later, as on a change of state: with a grace period if it is in use.
    await t.tick(T0 + 5000);
    await settle();
    expect(prepared()).toBe(1);
    expect(fake.tabs[0].url).toBe(PAGE);
    stay();
    // Still there a moment later: it stayed, and covers itself.
    expect((await t.tick(T0 + 6000)).cover).toBe(false);
    expect((await t.tick(T0 + 7000)).cover).toBe(true);
    // Asked again every few seconds, without another grace period, and covered meanwhile.
    expect((await t.tick(T0 + 9000)).cover).toBe(true);
    await settle();
    expect(fake.tabs[0].url).toBe('https://a.test/');
    expect((await t.tick(T0 + 10_000)).cover).toBe(true);
    await settle();
    expect(fake.tabs[0].url).toBe(PAGE);
    stay();
    expect((await t.tick(T0 + 10_500)).cover).toBe(true);
    expect(prepared()).toBe(1);
  });

  it('is not covered during a grace period, which it shows itself', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    const enforce = await import('../../src/background/enforce');
    await t.tick(T0);
    await t.tick(T0 + 5000);
    await settle();
    stay();
    expect((await t.tick(T0 + 7000)).cover).toBe(true);
    // A change of state gives the page in use a grace period: it is neither covered nor asked meanwhile.
    fake.contentReply.fn = (_tab, m) => (m.cmd === 'prepare' ? { grace: 30 } : undefined);
    await enforce.enforceTab({ ...fake.tabs[0] } as chrome.tabs.Tab, 'state');
    expect(prepared()).toBe(2);
    expect(await t.tick(T0 + 20_000)).toMatchObject({ leaving: true, cover: false });
    await settle();
    expect(fake.tabs[0].url).toBe('https://a.test/');
  });

  it('a page that may stay, or that the rules leave open, is forgotten', async () => {
    const g = group('A', ['a.test/games'], [{ intervention: BLOCK }]);
    const t = await setup([g]);
    const games = 'https://a.test/games';
    await t.tick(T0, games);
    await t.tick(T0 + 5000, games);
    await settle();
    stay();
    expect((await t.tick(T0 + 7000, games)).cover).toBe(true);
    // The site took the page elsewhere without leaving it: nothing to cover.
    expect(await t.tick(T0 + 8000, 'https://a.test/home')).toMatchObject({ leaving: false, cover: false });
    // Back on it, it is asked again before it is covered.
    expect(await t.tick(T0 + 9000, games)).toMatchObject({ leaving: true, cover: false });
    // A rule for the tab in use leaves a tab in the background alone.
    g.options.tabs = 'active';
    t.store.cc = compileConfig(t.store.config);
    const background = t.tab(2, { active: false, url: games });
    expect(await t.tick(T0 + 10_000, games, background)).toMatchObject({ leaving: false, cover: false });
  });

  it('a new page in the tab starts again', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    const enforce = await import('../../src/background/enforce');
    enforce.registerNavigationListeners(() => {});
    await t.tick(T0);
    await t.tick(T0 + 5000);
    await settle();
    stay();
    expect((await t.tick(T0 + 7000)).cover).toBe(true);
    // Another page of the site loads and is asked to leave at once: it has not refused yet.
    vi.setSystemTime(T0 + 8000);
    fake.events.onCommitted.fire({ tabId: 1, frameId: 0, url: 'https://a.test/next' });
    await settle();
    expect(fake.tabs[0].url).toBe('chrome-extension://test/intervention.html#https://a.test/next');
    stay();
    expect((await t.tick(T0 + 8500, 'https://a.test/next')).cover).toBe(false);
  });
});

describe('filters', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  it('each kind as CSS', async () => {
    const { filterCss } = await import('../../src/background/accounting');
    expect(filterCss('grayscale', 80)).toBe('grayscale(80%)');
    expect(filterCss('blur', 100)).toBe('blur(10px)');
    expect(filterCss('blur', 1)).toBe('blur(1px)');
    expect(filterCss('fade', 100)).toBe('opacity(10%)');
    expect(filterCss('invert', 100)).toBe('invert(100%)');
    expect(filterCss('sepia', 40)).toBe('sepia(40%)');
    // The custom filters of earlier versions are greyscale.
    expect(filterCss('custom', 40)).toBe('grayscale(40%)');
  });
});
