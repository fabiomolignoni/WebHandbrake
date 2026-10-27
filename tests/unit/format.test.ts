import { afterEach, describe, expect, it } from 'vitest';
import {
  dateTimeParams,
  formatBadge,
  formatDate,
  formatDateTime,
  formatDuration,
  formatList,
  formatMilliseconds,
  formatMinutesOfDay,
  formatNumber,
  formatPercent,
  formatSize,
  formatTime,
  formatWhen,
  setFormatPrefs,
  timestampSuffix,
  weekdayNames,
  whenParams,
} from '../../src/shared/format';
import { at } from './helpers';

afterEach(() => setFormatPrefs({ hour12: 'auto', dateFormat: 'auto' }));

describe('durations', () => {
  it('seconds under a minute, minutes under an hour, then hours and minutes', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(-5)).toBe('0 min');
    expect(formatDuration(30)).toBe('30 s');
    expect(formatDuration(89)).toBe('1 min');
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(72 * 60)).toBe('1 h 12 min');
  });

  it('whole days from two days on', () => {
    expect(formatDuration(24 * 3600)).toBe('24 h');
    expect(formatDuration(48 * 3600)).toBe('2 days');
    expect(formatDuration(7 * 86_400)).toBe('7 days');
    expect(formatDuration(48 * 3600 + 60)).toBe('48 h 1 min');
    expect(formatDuration(50 * 3600)).toBe('50 h');
    expect(formatDuration(71 * 3600)).toBe('71 h');
  });

  it('the badge holds four characters at most', () => {
    expect(formatBadge(-1)).toBe('0s');
    expect(formatBadge(44.2)).toBe('45s');
    expect(formatBadge(61)).toBe('2m');
    expect(formatBadge(3599)).toBe('60m');
    expect(formatBadge(7300)).toBe('2h');
  });
});

describe('times and dates', () => {
  it('24 or 12 hours as chosen; 24:00 is the end of the day', () => {
    setFormatPrefs({ hour12: '24', dateFormat: 'auto' });
    expect(formatTime(at(0, 9, 5))).toBe('09:05');
    expect(formatTime(at(0, 9, 5) + 7000, true)).toBe('09:05:07');
    expect(formatMinutesOfDay(17 * 60 + 30)).toBe('17:30');
    expect(formatMinutesOfDay(1440)).toBe('24:00');
    setFormatPrefs({ hour12: '12', dateFormat: 'auto' });
    expect(formatTime(at(0, 21, 5))).toMatch(/^9:05\s?PM$/);
    expect(formatMinutesOfDay(1440)).toMatch(/^12:00\s?AM$/);
    // Automatic: as the language writes times (English without a region: 12 hours).
    setFormatPrefs({ hour12: 'auto', dateFormat: 'auto' });
    expect(formatMinutesOfDay(1440)).toMatch(/^12:00\s?AM$/);
  });

  it('when: the time today, "tomorrow", a weekday this week, else a date', () => {
    setFormatPrefs({ hour12: '24', dateFormat: 'auto' });
    const now = at(0, 10);
    expect(formatWhen(at(0, 17), now)).toBe('17:00');
    expect(formatWhen(at(1, 9), now)).toBe('tomorrow 09:00');
    expect(formatWhen(at(3, 9), now)).toBe('Thu 09:00');
    expect(formatWhen(at(10, 9), now)).toBe('Oct 15, 09:00');
    // The parts of a moment, for the languages whose words around it change with the day.
    expect(whenParams(at(0, 17), now)).toEqual({ when: '17:00', day: 'today', time: '17:00', date: 'Oct 5' });
    expect(whenParams(at(1, 9), now)).toMatchObject({
      when: 'tomorrow 09:00',
      day: 'tomorrow',
      time: '09:00',
    });
    expect(whenParams(at(3, 9), now)).toMatchObject({ day: 'week', date: 'Thursday' });
    expect(whenParams(at(10, 9), now)).toMatchObject({ day: 'date', date: 'Oct 15' });
    expect(dateTimeParams(at(10, 9))).toEqual({
      when: 'Thu, Oct 15, 09:00',
      day: 'date',
      time: '09:00',
      date: 'Thu, Oct 15',
    });
  });

  it('ISO dates when chosen', () => {
    setFormatPrefs({ hour12: '24', dateFormat: 'iso' });
    expect(formatDate(at(0, 12))).toBe('2026-10-05');
    expect(formatDateTime(at(0, 12))).toBe('2026-10-05 12:00');
    setFormatPrefs({ hour12: '24', dateFormat: 'auto' });
    expect(formatDate(at(0, 12))).toBe('Oct 5');
  });

  it('weekday names from Sunday, numbers, percentages, lists, file suffixes', () => {
    expect(weekdayNames()).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(weekdayNames('long')[1]).toBe('Monday');
    expect(formatNumber(1234.56)).toBe('1,234.6');
    expect(formatPercent(0.25)).toBe('+25%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.5, false)).toBe('50%');
    expect(formatSize(9 * 1024)).toBe('9 kB');
    expect(formatSize(1.25 * 1024 * 1024)).toBe('1.3 MB');
    expect(formatMilliseconds(12)).toBe('12 ms');
    expect(formatList(['Social', 'News', 'Games'])).toBe('Social, News, and Games');
    expect(timestampSuffix(at(0, 9, 7))).toBe('2026-10-05_0907');
  });
});
