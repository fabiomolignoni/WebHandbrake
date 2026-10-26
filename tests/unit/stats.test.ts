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
      site: 'video.test',
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
    expect(store.state.pauses[0].site).toBeUndefined();
    expect(store.intentions).toEqual([]);
    expect(store.usage.minutes['g:G']).toBeDefined();
  });
});

describe('deleting a site', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  it('removes it from the breaks taken on it, which stay for the limits', async () => {
    const { store } = await import('../../src/background/store');
    const { deleteStats } = await import('../../src/background/stats');
    await store.ready();
    const at = Date.now();
    store.state.pauses.push(
      { at, groups: ['G'], scope: 'site', site: 'video.test', minutes: 5, grantId: 'a' },
      { at, groups: ['G'], scope: 'page', url: 'https://www.video.test/watch?v=1', minutes: 5, grantId: 'b' },
      { at, groups: ['G'], scope: 'site', site: 'news.test', minutes: 5, grantId: 'c' },
    );
    await deleteStats('site', undefined, undefined, 'video.test');
    expect(store.state.pauses.map((p) => [p.grantId, p.site ?? p.url ?? null])).toEqual([
      ['a', null],
      ['b', null],
      ['c', 'news.test'],
    ]);
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
    // A break taken from a block page is going in too.
    store.usage.count('pausedIn:G', T0, store.cc.cal, 1);
    // Of the pages shown, those that offered a way in, and the ways taken.
    store.usage.count('offered:G', T0, store.cc.cal, 3);
    store.usage.count('took:G', T0, store.cc.cal, 1);
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
      { day: '2026-10-06', seconds: 300, visits: 0, outside: 0, sites: [0, 300], otherSites: 0, private: 0 },
      { day: '2026-10-07', seconds: 600, visits: 0, outside: 0, sites: [600, 0], otherSites: 0, private: 0 },
    ]);
    expect(s.stack).toEqual(['video.test', 'news.test']);
    expect(s.total).toEqual({ seconds: 900, visits: 2 });
    expect(s.previous.seconds).toBe(100);
    expect(s.groups).toEqual([{ id: 'G', name: 'G', color: expect.any(String), seconds: 600, visits: 2 }]);
    expect(s.sites.map((x) => x.host)).toEqual(['video.test', 'news.test']);
    expect(s.counters).toEqual({
      shown: 4,
      proceeded: 2,
      left: 0,
      pauses: 1,
      pauseMinutes: 10,
      sessions: 1,
      impulses: 2,
    });
    expect(s.pauses).toEqual([
      { at: T0, groups: ['*'], scope: 'all', minutes: 10, reason: undefined, used: undefined },
    ]);
    expect(s.intentions).toEqual([]);
  });

  it('the days split their time by the sites with the most time, the rest as other sites', async () => {
    const { store, stats } = await setup();
    for (let i = 0; i < 8; i++) store.usage.add(`h:s${i}.test`, T0, 100 - i, 1, store.cc.cal, false);
    const s = await stats.getStats('2026-10-07', '2026-10-07');
    expect(s.stack).toEqual(['video.test', 's0.test', 's1.test', 's2.test', 's3.test', 's4.test']);
    expect(s.days[0].sites).toEqual([600, 100, 99, 98, 97, 96]);
    expect(s.days[0].otherSites).toBe(95 + 94 + 93);
  });

  it('beyond the sites listed, all of them add up; private windows have their own total', async () => {
    const { store, stats } = await setup();
    for (let i = 0; i < 120; i++) store.usage.add(`h:s${i}.test`, T0, 10, 1, store.cc.cal, false);
    store.usage.add('a:', T0, 1200 + 200, 0, store.cc.cal);
    store.usage.add('p:', T0, 200, 3, store.cc.cal, false);
    const s = await stats.getStats('2026-10-07', '2026-10-07');
    expect(s.sites).toHaveLength(100);
    expect(s.siteTotal).toEqual({ count: 121, seconds: 600 + 1200, visits: 2 + 120 });
    expect(s.private).toEqual({ seconds: 200, visits: 3 });
    expect(s.days[0].private).toBe(200);
    // The sites and the private windows make the total.
    expect(s.siteTotal.seconds + s.private.seconds).toBe(s.total.seconds);
    const csv = (await stats.exportStats('csv')).text.split('\n');
    expect(csv).toContain('2026-10-07,private,,,200,3');
  });

  /** The time of a day's column without and with its split by site. */
  const columns = (d: {
    seconds: number;
    outside: number;
    sites: number[];
    otherSites: number;
    private: number;
  }) => [d.seconds + d.outside, d.sites.reduce((a, b) => a + b, 0) + d.otherSites + d.private];

  it('with every site tracked, the days have the time outside the rules, which their sites hold too', async () => {
    const { store, stats } = await setup();
    store.usage.add('o:', T0, 300, 0, store.cc.cal, false);
    store.usage.add('h:elsewhere.test', T0, 250, 1, store.cc.cal, false);
    store.usage.add('p:', T0, 50, 1, store.cc.cal, false);
    const s = await stats.getStats('2026-10-07', '2026-10-07');
    expect(s.days[0]).toMatchObject({ seconds: 600, outside: 300, private: 50, otherSites: 0 });
    expect(columns(s.days[0])).toEqual([900, 900]);
    // On limited sites only.
    expect(s.total.seconds).toBe(600);
    const csv = (await stats.exportStats('csv')).text.split('\n');
    expect(csv).toContain('2026-10-07,outside-rules,,,300,0');
  });

  it('days of earlier versions add up too: the time their sites miss was in private windows', async () => {
    const { store, stats } = await setup();
    // Until 1.1.0, the time in private windows was only in the total.
    store.usage.add('a:', T0, 400, 0, store.cc.cal);
    // A few seconds are the rounding of the clocks that each site had.
    store.usage.add('a:', T0 - dayMs, 20, 0, store.cc.cal);
    // Tabs open at the same time could count more on their sites than in the total.
    store.usage.add('h:extra.test', T0 - 3 * dayMs, 150, 1, store.cc.cal, false);
    const s = await stats.getStats('2026-10-04', '2026-10-07');
    const [fourth, , sixth, seventh] = s.days;
    expect(seventh).toMatchObject({ seconds: 1000, private: 400 });
    expect(sixth).toMatchObject({ seconds: 320, private: 0, otherSites: 20 });
    // 100 s in the total, 150 s on its sites.
    expect(fourth).toMatchObject({ seconds: 150, private: 0 });
    for (const d of s.days) expect(columns(d)).toEqual([d.seconds, d.seconds]);
    expect(s.private.seconds).toBe(400);
    // The sites and the private windows, listed or not, have the time of the columns.
    expect(s.siteTotal.seconds + s.private.seconds).toBe(s.days.reduce((a, d) => a + d.seconds, 0));
  });

  it('a deleted site leaves its time to the other sites, without its name', async () => {
    const { store, stats } = await setup();
    await stats.deleteStats('site', undefined, undefined, 'video.test');
    const s = await stats.getStats('2026-10-07', '2026-10-07');
    expect(s.sites).toEqual([]);
    expect(s.siteTotal).toEqual({ count: 0, seconds: 600, visits: 2 });
    expect(s.days[0]).toMatchObject({ seconds: 600, sites: [], otherSites: 600, private: 0 });
    expect(JSON.stringify(store.usage.days.get('2026-10-07'))).not.toContain('video.test');
  });

  it('the hours of a day hold its time on limited sites by clock hour', async () => {
    const { store, stats } = await setup();
    store.usage.add('a:', new Date(2026, 9, 7, 9, 30).getTime(), 120, 0, store.cc.cal);
    store.usage.add('a:', new Date(2026, 9, 7, 23, 59).getTime(), 30, 0, store.cc.cal);
    const s = await stats.getStats('2026-10-07', '2026-10-07');
    expect(s.hours).toHaveLength(24);
    expect(s.hours?.[12]).toBe(600);
    expect(s.hours?.[9]).toBe(120);
    expect(s.hours?.[23]).toBe(30);
    expect(s.hours?.reduce((a, b) => a + b, 0)).toBe(s.total.seconds);
    const csv = (await stats.exportStats('csv')).text.split('\n');
    expect(csv).toContain('2026-10-07,hour,9,,120,');
  });

  it('a day recorded without hours gets them from the minute buckets, or says it has none', async () => {
    const { store, stats } = await setup();
    // As recorded before the hours were kept.
    for (const d of store.usage.days.values()) delete d.h;
    await store.flushUsage();
    // The minute buckets of the last 48 hours cover the time of 7 and 6 October, not of 4 October.
    store.usage.pruneMinutes(T0);
    store.usage.fillHours(store.cc.cal);
    expect((await stats.getStats('2026-10-07', '2026-10-07')).hours?.[12]).toBe(600);
    expect((await stats.getStats('2026-10-06', '2026-10-06')).hours?.[12]).toBe(300);
    expect((await stats.getStats('2026-10-04', '2026-10-04')).hours).toBeNull();
    // A day without time has nothing to miss.
    expect((await stats.getStats('2026-10-05', '2026-10-05')).hours).toEqual(Array(24).fill(0));
  });

  it('deleting a range of days deletes its hours', async () => {
    const { store, stats } = await setup();
    await store.flushUsage();
    await stats.deleteStats('range', '2026-10-07', '2026-10-07');
    expect(store.usage.days.get('2026-10-07')?.h).toBeUndefined();
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
