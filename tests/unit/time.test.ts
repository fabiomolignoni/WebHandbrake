import { describe, expect, it } from 'vitest';
import {
  addDays,
  bitmapSchedule,
  chosenPeriod,
  clamp,
  DAY,
  dayKey,
  dayKeyOf,
  dayNumber,
  dayStartAt,
  formatHM,
  HOUR,
  inWindows,
  isFullDay,
  logicalDayOf,
  MINUTE,
  parseDayKey,
  periodRange,
  scheduleActive,
  scheduleBitmap,
  scheduleBoundaries,
  weekdayOf,
  windowInterval,
  windowIntervals,
} from '../../src/engine/time';
import { at } from './helpers';

const cal = { dayStart: 0, weekStart: 1 };
const late = { dayStart: 4 * 60, weekStart: 1 };

describe('logical days', () => {
  it('a day starts at the day start, so the small hours belong to the day before', () => {
    expect(logicalDayOf(at(1, 3, 59), cal)).toEqual({ y: 2026, m: 9, d: 6 });
    expect(logicalDayOf(at(1, 3, 59), late)).toEqual({ y: 2026, m: 9, d: 5 });
    expect(logicalDayOf(at(1, 4, 0), late)).toEqual({ y: 2026, m: 9, d: 6 });
    expect(dayKeyOf(at(1, 3), late)).toBe('2026-10-05');
    expect(dayStartAt({ y: 2026, m: 9, d: 5 }, late)).toBe(at(0, 4));
  });

  it('day keys, weekdays and day numbers', () => {
    const day = parseDayKey('2026-12-31');
    expect(day).toEqual({ y: 2026, m: 11, d: 31 });
    expect(dayKey(day)).toBe('2026-12-31');
    expect(dayKey(addDays(day, 1))).toBe('2027-01-01');
    expect(dayKey(addDays(day, -365))).toBe('2025-12-31');
    expect(weekdayOf({ y: 2026, m: 9, d: 5 })).toBe(1);
    expect(weekdayOf({ y: 2026, m: 9, d: 4 })).toBe(0);
    expect(dayNumber({ y: 1970, m: 0, d: 2 })).toBe(1);
    expect(dayNumber(addDays(day, 10)) - dayNumber(day)).toBe(10);
  });

  it('the days of the change of the clocks last 23 and 25 hours', () => {
    const spring = { y: 2026, m: 2, d: 29 };
    const autumn = { y: 2026, m: 9, d: 25 };
    expect(dayStartAt(addDays(spring, 1), cal) - dayStartAt(spring, cal)).toBe(23 * HOUR);
    expect(dayStartAt(addDays(autumn, 1), cal) - dayStartAt(autumn, cal)).toBe(25 * HOUR);
    // Adding days never slips by an hour across the change.
    expect(dayKey(addDays(autumn, 1))).toBe('2026-10-26');
    expect(dayNumber(addDays(spring, 1)) - dayNumber(spring)).toBe(1);
  });
});

describe('time windows', () => {
  it('a full day is 00:00–24:00 or 00:00–00:00', () => {
    expect(isFullDay({ days: [1], start: 0, end: 1440 })).toBe(true);
    expect(isFullDay({ days: [1], start: 0, end: 0 })).toBe(true);
    expect(isFullDay({ days: [1], start: 60, end: 60 })).toBe(false);
  });

  it('a window is placed on the weekday it starts; other days have none', () => {
    const w = { days: [1], start: 9 * 60, end: 17 * 60 };
    expect(windowInterval(w, { y: 2026, m: 9, d: 5 }, cal)).toEqual([at(0, 9), at(0, 17)]);
    expect(windowInterval(w, { y: 2026, m: 9, d: 6 }, cal)).toBeNull();
    // 24:00 ends at midnight; a window that ends where it starts lasts a whole day.
    expect(windowInterval({ days: [1], start: 20 * 60, end: 1440 }, { y: 2026, m: 9, d: 5 }, cal)).toEqual([
      at(0, 20),
      at(1, 0),
    ]);
    expect(windowInterval({ days: [1], start: 9 * 60, end: 9 * 60 }, { y: 2026, m: 9, d: 5 }, cal)).toEqual([
      at(0, 9),
      at(1, 9),
    ]);
  });

  it('keeps wall-clock times across the change of the clocks', () => {
    // Sunday 25 October 2026: 02:00–03:00 happens twice.
    const night = { days: [0], start: 60, end: 4 * 60 };
    const [s, e] = windowInterval(night, { y: 2026, m: 9, d: 25 }, cal)!;
    expect(new Date(s).getHours()).toBe(1);
    expect(new Date(e).getHours()).toBe(4);
    expect(e - s).toBe(4 * HOUR);
  });

  it('merges touching and overlapping windows', () => {
    const windows = [
      { days: [1], start: 9 * 60, end: 12 * 60 },
      { days: [1], start: 12 * 60, end: 13 * 60 },
      { days: [1], start: 11 * 60, end: 11 * 60 + 30 },
      { days: [2], start: 9 * 60, end: 10 * 60 },
    ];
    expect(windowIntervals(windows, { y: 2026, m: 9, d: 5 }, 2, cal)).toEqual([
      [at(0, 9), at(0, 13)],
      [at(1, 9), at(1, 10)],
    ]);
  });

  it('no windows means never inside', () => {
    expect(inWindows([], at(0, 12), cal)).toBe(false);
    expect(scheduleActive({ mode: 'during', windows: [] }, at(0, 12), cal)).toBe(false);
  });

  it('a week bitmap gives back its schedule: windows within logical days, the days with the same times together', () => {
    const office = { mode: 'during' as const, windows: [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }] };
    expect(bitmapSchedule(scheduleBitmap(office))).toEqual(office);
    expect(bitmapSchedule(scheduleBitmap({ mode: 'always', windows: [] }))).toEqual({
      mode: 'always',
      windows: [],
    });
    expect(bitmapSchedule(new Uint8Array(7 * 1440))).toEqual({ mode: 'during', windows: [] });
    // An overnight window is split at the start of the day.
    const night = { mode: 'during' as const, windows: [{ days: [5], start: 1320, end: 120 }] };
    expect(bitmapSchedule(scheduleBitmap(night))).toEqual({
      mode: 'during',
      windows: [
        { days: [6], start: 0, end: 120 },
        { days: [5], start: 1320, end: 1440 },
      ],
    });
    // With days starting at 05:00, a whole logical day and the same night in one window.
    expect(bitmapSchedule(scheduleBitmap(night, 300), 300)).toEqual(night);
    const sunday = { mode: 'during' as const, windows: [{ days: [0], start: 0, end: 1440 }] };
    expect(bitmapSchedule(scheduleBitmap(sunday, 300), 300)).toEqual(sunday);
  });

  it('boundaries are the starts and ends after now, an overnight window from yesterday included', () => {
    const nights = {
      mode: 'during' as const,
      windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: 22 * 60, end: 6 * 60 }],
    };
    const b = scheduleBoundaries(nights, at(1, 2), cal, 2);
    expect(b.slice(0, 3)).toEqual([at(1, 6), at(1, 22), at(2, 6)]);
    expect(b.every((t) => t > at(1, 2))).toBe(true);
    expect(scheduleBoundaries({ mode: 'always', windows: [] }, at(0, 0), cal)).toEqual([]);
    expect(scheduleBoundaries({ mode: 'during', windows: [] }, at(0, 0), cal)).toEqual([]);
  });
});

describe('periods', () => {
  it('an hour starts on the hour; a rolling window ends now', () => {
    const h = periodRange({ kind: 'hour' }, at(0, 10, 25), cal);
    expect([h.start, h.end]).toEqual([at(0, 10), at(0, 11)]);
    expect(h.kind === 'minutes' && h.to).toBe(at(0, 10, 25));
    const r = periodRange({ kind: 'rolling', n: 90 }, at(0, 10), cal);
    expect([r.start, r.end]).toEqual([at(0, 8, 30), at(0, 10)]);
  });

  it('blocks of minutes are aligned on the day start, with an offset, and end with the day', () => {
    const p = periodRange({ kind: 'minutes', n: 120, offset: 30 }, at(0, 10), cal);
    expect([p.start, p.end]).toEqual([at(0, 8, 30), at(0, 10, 30)]);
    // Before the first block of the day starts, the period starts with the day.
    const early = periodRange({ kind: 'minutes', n: 120, offset: 30 }, at(0, 0, 10), cal);
    expect([early.start, early.end]).toEqual([at(0, 0), at(0, 0, 30)]);
    // A block never runs into the next day.
    const last = periodRange({ kind: 'minutes', n: 300 }, at(0, 23), cal);
    expect(last.end).toBe(at(1, 0));
    // Out-of-range lengths are clamped.
    const tiny = periodRange({ kind: 'minutes', n: 1 }, at(0, 10, 7), cal);
    expect(tiny.end - tiny.start).toBe(5 * MINUTE);
  });

  it('a day lasts from day start to day start, 25 hours when the clocks go back', () => {
    const d = periodRange({ kind: 'day' }, at(1, 3), late);
    expect(d.kind === 'days' && d.days).toEqual(['2026-10-05']);
    expect([d.start, d.end]).toEqual([at(0, 4), at(1, 4)]);
    const autumn = periodRange({ kind: 'day' }, new Date(2026, 9, 25, 12).getTime(), cal);
    expect(autumn.end - autumn.start).toBe(25 * HOUR);
  });

  it('a week starts on the chosen weekday', () => {
    const monday = periodRange({ kind: 'week' }, at(6, 12), cal);
    expect(monday.kind === 'days' && monday.days.length).toBe(7);
    expect([monday.start, monday.end]).toEqual([at(0, 0), at(7, 0)]);
    const sunday = periodRange({ kind: 'week' }, at(6, 12), { dayStart: 0, weekStart: 0 });
    expect(sunday.kind === 'days' && sunday.days).toEqual(['2026-10-11']);
    expect(sunday.start).toBe(at(6, 0));
  });

  it('a month ends on the first of the next one, December included', () => {
    const dec = periodRange({ kind: 'month' }, new Date(2026, 11, 3, 12).getTime(), cal);
    expect(dec.kind === 'days' && dec.days).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
    expect(dec.end).toBe(new Date(2027, 0, 1).getTime());
  });

  it('every n days, counted from a fixed Monday and shifted by the offset', () => {
    const three = periodRange({ kind: 'days', n: 3 }, at(0, 12), cal);
    const shifted = periodRange({ kind: 'days', n: 3, offset: 1 }, at(0, 12), cal);
    expect(three.end - three.start).toBe(3 * DAY);
    expect(shifted.start).not.toBe(three.start);
    for (const p of [three, shifted]) {
      expect(p.start <= at(0, 12) && at(0, 12) < p.end).toBe(true);
      expect(p.kind === 'days' && p.days[p.days.length - 1]).toBe('2026-10-05');
    }
    // The next period starts where this one ends.
    const next = periodRange({ kind: 'days', n: 3 }, three.end, cal);
    expect(next.start).toBe(three.end);
  });

  it('a number of days chosen today starts today; chosen again, its length keeps its start', () => {
    const now = at(2, 15);
    const three = chosenPeriod({ kind: 'days', n: 3 }, undefined, now, cal);
    const r = periodRange(three, now, cal);
    expect([r.start, r.end]).toEqual([at(2, 0), at(5, 0)]);
    expect(r.kind === 'days' && r.days).toEqual(['2026-10-07']);
    // Chosen the next day, it starts that day.
    const later = chosenPeriod({ kind: 'days', n: 3 }, undefined, at(3, 9), cal);
    expect(periodRange(later, at(3, 9), cal).start).toBe(at(3, 0));
    // The length it had keeps the start it had; another length starts on the day it is chosen.
    expect(chosenPeriod({ kind: 'days', n: 3 }, three, at(3, 9), cal)).toBe(three);
    const four = chosenPeriod({ kind: 'days', n: 4 }, three, at(3, 9), cal);
    expect(periodRange(four, at(3, 9), cal).start).toBe(at(3, 0));
    // Before the day starts, it is still the day before.
    const night = chosenPeriod({ kind: 'days', n: 3 }, undefined, at(3, 2), late);
    expect(periodRange(night, at(3, 2), late).start).toBe(at(2, 4));
    // On the reference day, no offset is needed.
    const monday = new Date(2024, 0, 1, 12).getTime();
    expect(chosenPeriod({ kind: 'days', n: 7 }, undefined, monday, cal)).toEqual({ kind: 'days', n: 7 });
  });

  it('the other periods start with the clock or the calendar, without an offset', () => {
    const sevenDays = { kind: 'days' as const, n: 7, offset: 2 };
    expect(chosenPeriod({ kind: 'week' }, sevenDays, at(2, 9), cal)).toEqual({ kind: 'week' });
    expect(chosenPeriod({ kind: 'month' }, undefined, at(2, 9), cal)).toEqual({ kind: 'month' });
    expect(chosenPeriod({ kind: 'minutes', n: 90, offset: 30 }, undefined, at(2, 9), cal)).toEqual({
      kind: 'minutes',
      n: 90,
    });
    // A number of minutes saved with an offset keeps it while its length stays.
    const minutes = { kind: 'minutes' as const, n: 90, offset: 30 };
    expect(chosenPeriod({ kind: 'minutes', n: 90 }, minutes, at(2, 9), cal)).toBe(minutes);
  });
});

describe('helpers', () => {
  it('clamp and formatHM', () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(formatHM(0)).toBe('00:00');
    expect(formatHM(9 * 60 + 5)).toBe('09:05');
    expect(formatHM(1440)).toBe('24:00');
    expect(formatHM(1440 + 90)).toBe('01:30');
  });
});
