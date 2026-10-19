import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBrowser } from './fake-browser';
import { group } from './helpers';

describe('deleting statistics never refills limits', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  it('keeps group totals, passes and break records; removes sites, counters, reasons and intentions', async () => {
    const { store } = await import('../../src/background/store');
    const { deleteStats } = await import('../../src/background/stats');
    const { dayKeyOf } = await import('../../src/engine/time');
    await store.ready();
    const now = Date.now();
    const today = dayKeyOf(now, store.cc.cal);
    store.usage.add('g:G', now, 1800, 2, store.cc.cal);
    store.usage.add('s:G:video.test', now, 1800, 2, store.cc.cal);
    store.usage.add('h:video.test', now, 1800, 2, store.cc.cal, false);
    store.usage.add('a:', now, 1800, 0, store.cc.cal);
    store.usage.count('shown:G', now, store.cc.cal);
    store.usage.count('proceeded:G', now, store.cc.cal);
    store.state.pauses.push({
      at: now,
      groups: ['G'],
      scope: 'site',
      minutes: 10,
      reason: 'private',
      grantId: 'x',
    });
    store.intentions.push({ at: now, groupId: 'G', text: 'secret', minutes: 5 });
    await store.flushUsage();

    await deleteStats('all');

    const rec = store.usage.days.get(today)!;
    expect(rec.t['g:G'][0]).toBe(1800);
    expect(rec.t['s:G:video.test'][0]).toBe(1800);
    expect(rec.t['h:video.test']).toBeUndefined();
    expect(rec.t['a:']).toBeUndefined();
    expect(rec.c).toEqual({ 'proceeded:G': 1 });
    expect(store.state.pauses).toHaveLength(1);
    expect(store.state.pauses[0].reason).toBeUndefined();
    expect(store.intentions).toEqual([]);
    expect(store.usage.minutes['g:G']).toBeDefined();
  });
});

describe('statistics', () => {
  const T0 = new Date(2026, 9, 7, 12).getTime();
  const dayMs = 86_400_000;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    installFakeBrowser();
  });
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const { store } = await import('../../src/background/store');
    const stats = await import('../../src/background/stats');
    await store.ready();
    store.config.groups = [group('G', ['video.test'])];
    const add = (key: string, daysAgo: number, seconds: number, visits: number) =>
      store.usage.add(key, T0 - daysAgo * dayMs, seconds, visits, store.cc.cal);
    add('a:', 0, 600, 0);
    add('a:', 1, 300, 0);
    add('a:', 3, 100, 0);
    add('g:G', 0, 600, 2);
    add('h:video.test', 0, 600, 2);
    add('h:news.test', 1, 300, 1);
    store.usage.count('shown:G', T0, store.cc.cal, 4);
    store.usage.count('proceeded:G', T0, store.cc.cal, 1);
    store.usage.count('pause:G', T0, store.cc.cal);
    store.usage.count('pauseMin:G', T0, store.cc.cal, 10);
    store.usage.count('sessions', T0, store.cc.cal);
    store.state.pauses.push({ at: T0, groups: '*', scope: 'all', minutes: 10, grantId: 'p' });
    store.intentions.push({ at: T0 - 5 * dayMs, groupId: 'G', text: 'old', minutes: 5 });
    return { store, stats };
  }

  it('a range of days: totals per day, rule and site, counters, and the period before', async () => {
    const { stats } = await setup();
    const s = await stats.getStats('2026-10-06', '2026-10-07');
    expect(s.days).toEqual([
      { day: '2026-10-06', seconds: 300, visits: 0 },
      { day: '2026-10-07', seconds: 600, visits: 0 },
    ]);
    expect(s.total).toEqual({ seconds: 900, visits: 2 });
    expect(s.previous.seconds).toBe(100);
    expect(s.groups).toEqual([{ id: 'G', name: 'G', color: expect.any(String), seconds: 600, visits: 2 }]);
    expect(s.sites.map((x) => x.host)).toEqual(['video.test', 'news.test']);
    expect(s.counters).toEqual({
      shown: 4,
      proceeded: 1,
      left: 0,
      pauses: 1,
      pauseMinutes: 10,
      sessions: 1,
      impulses: 3,
    });
    expect(s.pauses).toEqual([
      { at: T0, groups: ['*'], scope: 'all', minutes: 10, reason: undefined, used: undefined },
    ]);
    expect(s.intentions).toEqual([]);
  });

  it('breaks and reasons belong to the logical day, as the totals do', async () => {
    const { store, stats } = await setup();
    store.config.settings.dayStart = 240;
    store.cc = { ...store.cc, cal: { ...store.cc.cal, dayStart: 240 } };
    // 02:00 on 8 October is still the day of 7 October when days start at 04:00.
    const night = new Date(2026, 9, 8, 2).getTime();
    store.state.pauses = [{ at: night, groups: '*', scope: 'all', minutes: 5, grantId: 'n' }];
    store.intentions = [{ at: night, groupId: 'G', text: 'late', minutes: 5 }];
    const seventh = await stats.getStats('2026-10-07', '2026-10-07');
    expect(seventh.pauses.map((p) => p.at)).toEqual([night]);
    expect(seventh.intentions.map((i) => i.text)).toEqual(['late']);
    const eighth = await stats.getStats('2026-10-08', '2026-10-08');
    expect(eighth.pauses).toEqual([]);
    expect(eighth.intentions).toEqual([]);
  });

  it('exports every day as CSV or JSON', async () => {
    const { stats } = await setup();
    const csv = await stats.exportStats('csv');
    expect(csv.mime).toBe('text/csv');
    const lines = csv.text.split('\n');
    expect(lines[0]).toBe('day,kind,id,name,seconds,visits');
    expect(lines).toContain('2026-10-07,group,G,G,600,2');
    expect(lines).toContain('2026-10-07,site,video.test,,600,2');
    expect(lines).toContain('2026-10-07,counter,shown:G,,,4');
    const json = JSON.parse((await stats.exportStats('json')).text);
    expect(json.format).toBe('webhandbrake-statistics');
    expect(Object.keys(json.days).sort()).toEqual(['2026-10-04', '2026-10-06', '2026-10-07']);
  });

  it('deletes one site everywhere, or a range of days', async () => {
    const { store, stats } = await setup();
    await stats.deleteStats('site', undefined, undefined, 'video.test');
    expect((await stats.getStats('2026-10-07', '2026-10-07')).sites.map((x) => x.host)).toEqual([]);
    await stats.deleteStats('range', '2026-10-06', '2026-10-06');
    expect(store.usage.days.get('2026-10-06')?.t['a:']).toBeUndefined();
    expect(store.usage.days.get('2026-10-07')?.t['a:']).toEqual([600, 0]);
  });

  it('old days go after the retention period', async () => {
    const { store, stats } = await setup();
    store.config.settings.tracking.retentionDays = 2;
    await store.flushUsage();
    await stats.applyRetention();
    expect(store.usage.days.get('2026-10-04')?.t['a:']).toBeUndefined();
    expect(store.usage.days.get('2026-10-06')?.t['a:']).toEqual([300, 0]);
  });
});
