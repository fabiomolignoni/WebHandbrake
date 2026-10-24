/**
 * Usage accounting store: daily aggregates (statistics, day-based budgets) and minute buckets
 * for the last MINUTE_RETENTION_MINUTES (budgets that start again within a day). Only aggregates are
 * stored.
 */

import { MINUTE_RETENTION_MINUTES } from './limits';
import { type CalendarSettings, dayKeyOf, MINUTE, type PeriodRange } from './time';
import type { DayRecord, MinuteBuckets } from './types';

export const usageKeys = {
  all: 'a:',
  group: (groupId: string) => `g:${groupId}`,
  site: (groupId: string, site: string) => `s:${groupId}:${site}`,
  host: (host: string) => `h:${host}`,
};

/**
 * "Times you chose not to go in" in a day's counters: the intervention pages that offered a way in
 * (a question, a wait, a challenge, a break) and that you opened, less those you went past.
 */
export function impulsesOf(counters: Record<string, number>): number {
  let offered = 0;
  let took = 0;
  for (const [key, n] of Object.entries(counters)) {
    if (key.startsWith('offered:')) offered += n;
    else if (key.startsWith('took:')) took += n;
  }
  return Math.max(0, offered - took);
}

export function emptyDay(): DayRecord {
  return { t: {}, c: {} };
}

export class Usage {
  readonly days: Map<string, DayRecord>;
  minutes: MinuteBuckets;
  /** Day keys modified since the last flush. */
  readonly dirtyDays = new Set<string>();
  dirtyMinutes = false;

  constructor(days: Record<string, DayRecord> | Map<string, DayRecord> = {}, minutes: MinuteBuckets = {}) {
    this.days = days instanceof Map ? days : new Map(Object.entries(days));
    this.minutes = minutes;
  }

  private day(key: string): DayRecord {
    let d = this.days.get(key);
    if (!d) {
      d = emptyDay();
      this.days.set(key, d);
    }
    return d;
  }

  /** Credits active seconds and/or visit starts to a key at instant t. */
  add(key: string, t: number, seconds: number, visits: number, cal: CalendarSettings, minuteBuckets = true) {
    const dk = dayKeyOf(t, cal);
    const d = this.day(dk);
    const cur = d.t[key] ?? [0, 0];
    cur[0] += seconds;
    cur[1] += visits;
    d.t[key] = cur;
    if (key === usageKeys.all && seconds) {
      const hk = String(new Date(t).getHours());
      d.h ??= {};
      d.h[hk] = (d.h[hk] ?? 0) + seconds;
    }
    this.dirtyDays.add(dk);
    if (!minuteBuckets) return;
    const mk = String(Math.floor(t / MINUTE));
    let m = this.minutes[key];
    if (!m) m = this.minutes[key] = {};
    const mc = m[mk] ?? [0, 0];
    mc[0] += seconds;
    mc[1] += visits;
    m[mk] = mc;
    this.dirtyMinutes = true;
  }

  count(name: string, t: number, cal: CalendarSettings, by = 1) {
    const dk = dayKeyOf(t, cal);
    const d = this.day(dk);
    d.c[name] = (d.c[name] ?? 0) + by;
    this.dirtyDays.add(dk);
  }

  /** Sum of seconds (field 0) or visits (field 1) for a key over a period range. */
  sum(key: string, range: PeriodRange, field: 0 | 1): number {
    let total = 0;
    if (range.kind === 'days') {
      for (const dk of range.days) total += this.days.get(dk)?.t[key]?.[field] ?? 0;
      return total;
    }
    const m = this.minutes[key];
    if (!m) return 0;
    const from = Math.floor(range.from / MINUTE);
    const to = Math.floor(range.to / MINUTE);
    if (to - from > 2000) {
      for (const [mk, v] of Object.entries(m)) {
        const i = Number(mk);
        if (i >= from && i <= to) total += v[field];
      }
      return total;
    }
    for (let i = from; i <= to; i++) total += m[i]?.[field] ?? 0;
    return total;
  }

  counterSum(name: string, dayKeys: string[]): number {
    let total = 0;
    for (const dk of dayKeys) total += this.days.get(dk)?.c[name] ?? 0;
    return total;
  }

  /**
   * Days recorded before the hours were kept get them from the minute buckets of the a: total,
   * when these still cover all of the day's time.
   */
  fillHours(cal: CalendarSettings) {
    const m = this.minutes[usageKeys.all];
    if (!m) return;
    const found = new Map<string, Record<string, number>>();
    for (const [mk, [seconds]] of Object.entries(m)) {
      const t = Number(mk) * MINUTE;
      const dk = dayKeyOf(t, cal);
      const d = this.days.get(dk);
      if (!d || d.h || !d.t[usageKeys.all]) continue;
      const h = found.get(dk) ?? {};
      const hk = String(new Date(t).getHours());
      h[hk] = (h[hk] ?? 0) + seconds;
      found.set(dk, h);
    }
    for (const [dk, h] of found) {
      const d = this.days.get(dk) as DayRecord;
      const sum = Object.values(h).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - d.t[usageKeys.all][0]) > 1) continue;
      d.h = h;
      this.dirtyDays.add(dk);
    }
  }

  pruneMinutes(now: number) {
    const min = Math.floor(now / MINUTE) - MINUTE_RETENTION_MINUTES;
    for (const key of Object.keys(this.minutes)) {
      const m = this.minutes[key];
      for (const mk of Object.keys(m)) if (Number(mk) < min) delete m[mk];
      if (!Object.keys(m).length) delete this.minutes[key];
    }
    this.dirtyMinutes = true;
  }
}
