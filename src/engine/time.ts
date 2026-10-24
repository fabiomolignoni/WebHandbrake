/**
 * Calendar logic: logical days, weekly windows including overnight windows,
 * budget periods. All computations use local wall-clock time through the
 * Date constructor, so daylight saving changes are handled by the platform.
 */

import type { Period, Schedule, TimeWindow } from './types';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface CalendarSettings {
  /** Minutes after midnight at which a logical day starts. */
  dayStart: number;
  /** 0 = Sunday. */
  weekStart: number;
}

/** A logical day, identified by its calendar date. */
export interface LogicalDay {
  y: number;
  m: number; // 0-based
  d: number;
}

export function logicalDayOf(t: number, cal: CalendarSettings): LogicalDay {
  const date = new Date(t);
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes < cal.dayStart) date.setDate(date.getDate() - 1);
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
}

export function addDays(day: LogicalDay, n: number): LogicalDay {
  const date = new Date(day.y, day.m, day.d + n, 12);
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
}

export function weekdayOf(day: LogicalDay): number {
  return new Date(day.y, day.m, day.d, 12).getDay();
}

/** Start instant of a logical day. */
export function dayStartAt(day: LogicalDay, cal: CalendarSettings): number {
  return new Date(day.y, day.m, day.d, 0, cal.dayStart).getTime();
}

export function dayKey(day: LogicalDay): string {
  return `${day.y}-${String(day.m + 1).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
}

export function dayKeyOf(t: number, cal: CalendarSettings): string {
  return dayKey(logicalDayOf(t, cal));
}

export function parseDayKey(key: string): LogicalDay {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m: m - 1, d };
}

/** Days since 1970-01-01 of a logical day (timezone independent). */
export function dayNumber(day: LogicalDay): number {
  return Math.round(Date.UTC(day.y, day.m, day.d) / DAY);
}

/** Wall-clock instant of minute `min` belonging to logical day `day`. */
function wallTime(day: LogicalDay, min: number, cal: CalendarSettings): number {
  const sameDate = min >= cal.dayStart;
  return new Date(day.y, day.m, day.d + (sameDate ? 0 : 1), 0, min).getTime();
}

export function isFullDay(w: TimeWindow): boolean {
  return (w.start === 0 && w.end >= 1440) || (w.start === w.end && w.start === 0);
}

/** Absolute interval of a window on a logical day, or null if the window is not on that weekday. */
export function windowInterval(
  w: TimeWindow,
  day: LogicalDay,
  cal: CalendarSettings,
): [number, number] | null {
  if (!w.days.includes(weekdayOf(day))) return null;
  if (isFullDay(w)) return [dayStartAt(day, cal), dayStartAt(addDays(day, 1), cal)];
  const start = wallTime(day, w.start, cal);
  // The end is the first occurrence of the end time after the start (overnight windows, 24:00).
  const s = new Date(start);
  let end = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, w.end % 1440).getTime();
  if (end <= start) end = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1, 0, w.end % 1440).getTime();
  return [start, end];
}

/** Merged intervals of all windows for logical days [from, from + count). */
export function windowIntervals(
  windows: TimeWindow[],
  from: LogicalDay,
  count: number,
  cal: CalendarSettings,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const day = addDays(from, i);
    for (const w of windows) {
      const iv = windowInterval(w, day, cal);
      if (iv) out.push(iv);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const iv of out) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  return merged;
}

export function inWindows(windows: TimeWindow[], t: number, cal: CalendarSettings): boolean {
  if (!windows.length) return false;
  const today = logicalDayOf(t, cal);
  // An overnight window from yesterday can still be running.
  for (const [s, e] of windowIntervals(windows, addDays(today, -1), 2, cal)) {
    if (t >= s && t < e) return true;
  }
  return false;
}

export function scheduleActive(s: Schedule, t: number, cal: CalendarSettings): boolean {
  switch (s.mode) {
    case 'always':
      return true;
    case 'during':
      return inWindows(s.windows, t, cal);
  }
}

/** Boundaries (window starts and ends) strictly after t, within the horizon in days. */
export function scheduleBoundaries(s: Schedule, t: number, cal: CalendarSettings, horizonDays = 8): number[] {
  if (s.mode === 'always' || !s.windows.length) return [];
  const today = logicalDayOf(t, cal);
  const out: number[] = [];
  for (const [a, b] of windowIntervals(s.windows, addDays(today, -1), horizonDays + 1, cal)) {
    if (a > t) out.push(a);
    if (b > t) out.push(b);
  }
  return out;
}

const WEEK_MINUTES = 7 * 1440;

/**
 * Week bitmap (minute resolution) of when a schedule is active, minute 0 being Sunday at midnight.
 * The days of the windows are logical days, as the engine reads them (`windowInterval`): a whole
 * day starts at the day start, and a window that starts before it belongs to the night after its
 * day.
 */
export function scheduleBitmap(s: Schedule, dayStart = 0): Uint8Array {
  const bits = new Uint8Array(WEEK_MINUTES);
  if (s.mode === 'always') return bits.fill(1);
  const mark = (w: TimeWindow) => {
    const whole = isFullDay(w);
    const offset = whole ? dayStart : w.start + (w.start < dayStart ? 1440 : 0);
    let len = whole || w.start === w.end ? 1440 : (w.end % 1440) - w.start;
    if (len <= 0) len += 1440;
    for (const day of w.days) {
      const start = day * 1440 + offset;
      for (let i = 0; i < len; i++) bits[(start + i) % WEEK_MINUTES] = 1;
    }
  };
  s.windows.forEach(mark);
  return bits;
}

/**
 * The schedule of a week bitmap (`scheduleBitmap`): always, or windows within logical days, the
 * days with the same times in one window.
 */
export function bitmapSchedule(bits: Uint8Array, dayStart = 0): Schedule {
  if (bits.every(Boolean)) return { mode: 'always', windows: [] };
  const byTimes = new Map<string, TimeWindow>();
  for (let day = 0; day < 7; day++) {
    const at = (i: number) => bits[(day * 1440 + dayStart + i) % WEEK_MINUTES];
    for (let i = 0; i < 1440; i++) {
      if (!at(i) || (i > 0 && at(i - 1))) continue;
      let end = i;
      while (end < 1440 && at(end)) end++;
      const w =
        end - i === 1440
          ? { start: 0, end: 1440 }
          : { start: (dayStart + i) % 1440, end: (dayStart + end) % 1440 || 1440 };
      const key = `${w.start}-${w.end}`;
      const same = byTimes.get(key);
      if (same) same.days.push(day);
      else byTimes.set(key, { days: [day], ...w });
    }
  }
  return { mode: 'during', windows: [...byTimes.values()].sort((a, b) => a.start - b.start) };
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export type PeriodRange =
  | { kind: 'days'; days: string[]; start: number; end: number }
  | { kind: 'minutes'; from: number; to: number; start: number; end: number };

/** Reference logical day for multi-day periods: Monday 2024-01-01. */
const DAYS_EPOCH = dayNumber({ y: 2024, m: 0, d: 1 });

/**
 * The period containing t. `start`/`end` are instants; for day-based periods `days` lists the
 * day keys from the period start up to and including the day of t.
 */
export function periodRange(p: Period, t: number, cal: CalendarSettings): PeriodRange {
  const today = logicalDayOf(t, cal);
  const daysBetween = (first: LogicalDay, n: number) => {
    const days: string[] = [];
    for (let i = 0; i < n; i++) days.push(dayKey(addDays(first, i)));
    return days;
  };
  switch (p.kind) {
    case 'hour': {
      const d = new Date(t);
      d.setMinutes(0, 0, 0);
      const start = d.getTime();
      return { kind: 'minutes', from: start, to: t, start, end: start + HOUR };
    }
    case 'rolling': {
      const n = clamp(p.n ?? 60, 1, 1440);
      return { kind: 'minutes', from: t - n * MINUTE, to: t, start: t - n * MINUTE, end: t };
    }
    case 'minutes': {
      const n = clamp(p.n ?? 60, 5, 1440);
      const offset = (p.offset ?? 0) % n;
      const dayStart = dayStartAt(today, cal);
      const nextDay = dayStartAt(addDays(today, 1), cal);
      const elapsed = Math.floor((t - dayStart) / MINUTE);
      const index = Math.floor((elapsed - offset) / n);
      let start = dayStart + (index * n + offset) * MINUTE;
      if (start < dayStart) start = dayStart;
      const end = Math.min(dayStart + ((index + 1) * n + offset) * MINUTE, nextDay);
      return { kind: 'minutes', from: start, to: t, start, end };
    }
    case 'day': {
      return {
        kind: 'days',
        days: [dayKey(today)],
        start: dayStartAt(today, cal),
        end: dayStartAt(addDays(today, 1), cal),
      };
    }
    case 'week': {
      const back = (weekdayOf(today) - cal.weekStart + 7) % 7;
      const first = addDays(today, -back);
      return {
        kind: 'days',
        days: daysBetween(first, back + 1),
        start: dayStartAt(first, cal),
        end: dayStartAt(addDays(first, 7), cal),
      };
    }
    case 'month': {
      const first = { y: today.y, m: today.m, d: 1 };
      const next = { y: today.m === 11 ? today.y + 1 : today.y, m: (today.m + 1) % 12, d: 1 };
      return {
        kind: 'days',
        days: daysBetween(first, today.d),
        start: dayStartAt(first, cal),
        end: dayStartAt(next, cal),
      };
    }
    case 'days': {
      const n = clamp(p.n ?? 1, 1, 90);
      const num = dayNumber(today) - DAYS_EPOCH - (p.offset ?? 0);
      const index = Math.floor(num / n);
      const back = num - index * n;
      const first = addDays(today, -back);
      return {
        kind: 'days',
        days: daysBetween(first, back + 1),
        start: dayStartAt(first, cal),
        end: dayStartAt(addDays(first, n), cal),
      };
    }
  }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Minutes of the day → "HH:MM". */
export function formatHM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = min >= 1440 && m === 0 ? 24 : Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
