/**
 * Usage accounting store: daily aggregates (statistics, day-based budgets) and minute buckets
 * for the last MINUTE_RETENTION_MINUTES (hourly/rolling budgets). STA-07: only aggregates are stored.
 */

import { MINUTE_RETENTION_MINUTES } from './limits';
import { type CalendarSettings, dayKeyOf, MINUTE, type PeriodRange } from './time';
import type { DayRecord, MinuteBuckets } from './types';

export const usageKeys = {
  group: (groupId: string) => `g:${groupId}`,
  site: (groupId: string, site: string) => `s:${groupId}:${site}`,
  host: (host: string) => `h:${host}`,
};

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
   * Instant at which the usage in a rolling window drops below `limit`, assuming no further use.
   * Used to tell when a rolling budget refills (SEM-07).
   */
  rollingRefill(key: string, windowMinutes: number, limit: number, field: 0 | 1, now: number): number | null {
    const m = this.minutes[key];
    if (!m) return null;
    const nowIdx = Math.floor(now / MINUTE);
    const from = nowIdx - windowMinutes;
    const entries = Object.entries(m)
      .map(([k, v]) => [Number(k), v[field]] as const)
      .filter(([i]) => i >= from && i <= nowIdx)
      .sort((a, b) => a[0] - b[0]);
    let total = entries.reduce((a, [, v]) => a + v, 0);
    if (total < limit) return null;
    for (const [i, v] of entries) {
      total -= v;
      if (total < limit) return (i + windowMinutes + 1) * MINUTE;
    }
    return null;
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
