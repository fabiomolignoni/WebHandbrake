import { describe, expect, it } from 'vitest';
import { MINUTE_RETENTION_MINUTES } from '../../src/engine/limits';
import { MINUTE, periodRange } from '../../src/engine/time';
import { Usage, usageKeys } from '../../src/engine/usage';
import { at } from './helpers';

const cal = { dayStart: 0, weekStart: 1 };
const KEY = usageKeys.group('A');

describe('usage', () => {
  it('keys name a rule, a site of a rule and a host', () => {
    expect([usageKeys.group('A'), usageKeys.site('A', 'x.test'), usageKeys.host('x.test')]).toEqual([
      'g:A',
      's:A:x.test',
      'h:x.test',
    ]);
  });

  it('adds seconds and visits per logical day and per minute, and marks what to save', () => {
    const u = new Usage();
    u.add(KEY, at(0, 10), 30, 1, cal);
    u.add(KEY, at(0, 10, 0) + 20_000, 15, 0, cal);
    u.add(KEY, at(1, 10), 5, 1, cal);
    expect(u.days.get('2026-10-05')?.t[KEY]).toEqual([45, 1]);
    expect(u.days.get('2026-10-06')?.t[KEY]).toEqual([5, 1]);
    expect(u.minutes[KEY][String(Math.floor(at(0, 10) / MINUTE))]).toEqual([45, 1]);
    expect([...u.dirtyDays].sort()).toEqual(['2026-10-05', '2026-10-06']);
    expect(u.dirtyMinutes).toBe(true);
  });

  it('host totals can skip the minute buckets', () => {
    const u = new Usage();
    u.add('h:x.test', at(0, 10), 10, 1, cal, false);
    expect(u.days.get('2026-10-05')?.t['h:x.test']).toEqual([10, 1]);
    expect(u.minutes['h:x.test']).toBeUndefined();
    expect(u.dirtyMinutes).toBe(false);
  });

  it('keeps the hours of the totals and of the sites, not of the rules', () => {
    const u = new Usage();
    for (const key of ['a:', 'o:', 'p:', 'h:x.test', 'h:', KEY, 's:A:x.test'])
      u.add(key, at(0, 10, 30), 10, 1, cal, false);
    u.add('h:x.test', at(0, 11), 5, 0, cal, false);
    // A visit without time has no hour.
    u.add('p:', at(0, 12), 0, 1, cal, false);
    const d = u.days.get('2026-10-05');
    expect(d?.h).toEqual({ '10': 10 });
    expect(d?.hk).toEqual({
      'o:': { '10': 10 },
      'p:': { '10': 10 },
      'h:x.test': { '10': 10, '11': 5 },
      'h:': { '10': 10 },
    });
  });

  it('sums over days or over minutes, seconds or visits', () => {
    const u = new Usage();
    u.add(KEY, at(0, 9), 60, 1, cal);
    u.add(KEY, at(0, 10, 30), 120, 1, cal);
    u.add(KEY, at(1, 9), 30, 1, cal);
    const week = periodRange({ kind: 'week' }, at(1, 12), cal);
    expect(u.sum(KEY, week, 0)).toBe(210);
    expect(u.sum(KEY, week, 1)).toBe(3);
    const hour = periodRange({ kind: 'hour' }, at(0, 10, 45), cal);
    expect(u.sum(KEY, hour, 0)).toBe(120);
    expect(u.sum('g:other', hour, 0)).toBe(0);
    // A long minute range reads the buckets instead of every minute.
    const long = { kind: 'minutes' as const, from: at(0, 0), to: at(2, 0), start: at(0, 0), end: at(2, 0) };
    expect(u.sum(KEY, long, 0)).toBe(210);
  });

  it('counters per day', () => {
    const u = new Usage();
    u.count('shown:A', at(0, 9), cal);
    u.count('shown:A', at(0, 10), cal, 2);
    u.count('shown:A', at(1, 10), cal);
    expect(u.counterSum('shown:A', ['2026-10-05'])).toBe(3);
    expect(u.counterSum('shown:A', ['2026-10-05', '2026-10-06', '2026-10-07'])).toBe(4);
  });

  it('drops minute buckets older than the retention, and empty keys', () => {
    const u = new Usage();
    u.add(KEY, at(0, 10), 10, 0, cal);
    u.add('g:old', at(0, 10), 10, 0, cal);
    u.add(KEY, at(3, 10), 10, 0, cal);
    u.dirtyMinutes = false;
    u.pruneMinutes(at(0, 10) + (MINUTE_RETENTION_MINUTES + 1) * MINUTE);
    expect(Object.keys(u.minutes[KEY])).toHaveLength(1);
    expect(u.minutes['g:old']).toBeUndefined();
    expect(u.dirtyMinutes).toBe(true);
  });

  it('starts from stored days, as an object or a map', () => {
    const fromObject = new Usage({ '2026-10-05': { t: { [KEY]: [5, 1] }, c: {} } });
    const fromMap = new Usage(new Map([['2026-10-05', { t: { [KEY]: [5, 1] }, c: {} }]]));
    const day = periodRange({ kind: 'day' }, at(0, 12), cal);
    expect(fromObject.sum(KEY, day, 0)).toBe(5);
    expect(fromMap.sum(KEY, day, 1)).toBe(1);
  });
});
