/** Locale aware formatting of times, dates and durations. */

import type { Settings } from '../engine/types';
import { formatLocale, t } from '../i18n/i18n';

let hourPref: Settings['hour12'] = 'auto';
let datePref: Settings['dateFormat'] = 'auto';

export function setFormatPrefs(s: Pick<Settings, 'hour12' | 'dateFormat'>) {
  hourPref = s.hour12;
  datePref = s.dateFormat;
}

function hour12(): boolean | undefined {
  return hourPref === 'auto' ? undefined : hourPref === '12';
}

/** "17:05", or "17:05:09" with the seconds (logs). */
export function formatTime(ms: number, seconds = false): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    hour12: hour12(),
  }).format(ms);
}

/** An hour as an axis label, such as "14" or "2 pm". */
export function formatHour(ms: number): string {
  return new Intl.DateTimeFormat(formatLocale(), { hour: 'numeric', hour12: hour12() }).format(ms);
}

export function formatDate(
  ms: number,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
): string {
  if (datePref === 'iso') {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return new Intl.DateTimeFormat(formatLocale(), opts).format(ms);
}

/** A date and a time, in the order and with the separators of the language ("Fri 12 Oct, 17:00"). */
function formatDateAndTime(ms: number, date: Intl.DateTimeFormatOptions): string {
  if (datePref === 'iso') return `${formatDate(ms)} ${formatTime(ms)}`;
  return new Intl.DateTimeFormat(formatLocale(), {
    ...date,
    hour: 'numeric',
    minute: '2-digit',
    hour12: hour12(),
  }).format(ms);
}

export function formatDateTime(ms: number): string {
  return formatDateAndTime(ms, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Social, News and Games". */
export function formatList(items: string[]): string {
  return new Intl.ListFormat(formatLocale(), { type: 'conjunction' }).format(items);
}

function sameDay(a: number, b: number) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Which day a moment falls on, seen from now: what decides the words around it. */
export type WhenDay = 'today' | 'tomorrow' | 'week' | 'date';

function whenDay(ms: number, now: number): WhenDay {
  if (sameDay(ms, now)) return 'today';
  if (sameDay(ms, now + 86_400_000)) return 'tomorrow';
  return ms - now < 6 * 86_400_000 ? 'week' : 'date';
}

/** "17:00", "tomorrow 09:00", "Fri 09:00", "12 Oct, 09:00". */
export function formatWhen(ms: number, now = Date.now()): string {
  switch (whenDay(ms, now)) {
    case 'today':
      return formatTime(ms);
    case 'tomorrow':
      return t('time.tomorrowAt', { time: formatTime(ms) });
    case 'week':
      return formatDateAndTime(ms, { weekday: 'short' });
    case 'date':
      return formatDateAndTime(ms, { day: 'numeric', month: 'short' });
  }
}

/** The parameters of a moment in a message. See whenParams. */
export interface WhenParams {
  [name: string]: string;
  when: string;
  day: WhenDay;
  time: string;
  date: string;
}

/**
 * A moment for a message: {when} as formatWhen writes it, and its parts for a language whose words
 * around it change with the day ("alle 17:00", "domani alle 17:00"): {day} (today, tomorrow, week
 * or date) to choose with select, {time} and {date} (the weekday within a week, else the date).
 */
export function whenParams(ms: number, now = Date.now()): WhenParams {
  const day = whenDay(ms, now);
  return {
    when: formatWhen(ms, now),
    day,
    time: formatTime(ms),
    date: formatDate(ms, day === 'week' ? { weekday: 'short' } : { day: 'numeric', month: 'short' }),
  };
}

/** A moment always written with its date, as formatDateTime writes it, for a message (see whenParams). */
export function dateTimeParams(ms: number): WhenParams {
  return {
    when: formatDateTime(ms),
    day: 'date',
    time: formatTime(ms),
    date: formatDate(ms, { weekday: 'short', day: 'numeric', month: 'short' }),
  };
}

/** "1 h 12 min", "45 min", "30 s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s === 0) return t('duration.m', { m: 0 });
  if (s < 60) return t('duration.s', { s });
  const totalMin = Math.round(s / 60);
  if (totalMin < 60) return t('duration.m', { m: totalMin });
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  // Whole days only: 50 h is not "2 days".
  if (h >= 48 && m === 0 && h % 24 === 0) return t('duration.d', { d: h / 24 });
  return m ? t('duration.hm', { h, m }) : t('duration.h', { h });
}

/** Badge text (4 characters at most): "45s", "18m", "2h". */
export function formatBadge(seconds: number): string {
  if (seconds < 60) return t('badge.seconds', { n: Math.max(0, Math.ceil(seconds)) });
  if (seconds < 3600) return t('badge.minutes', { n: Math.ceil(seconds / 60) });
  return t('badge.hours', { n: Math.floor(seconds / 3600) });
}

export function weekdayNames(style: 'short' | 'long' = 'short'): string[] {
  const f = new Intl.DateTimeFormat(formatLocale(), { weekday: style });
  // 2026-10-04 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2026, 9, 4 + i, 12)));
}

/** A time of day; the end of the day is 24:00, or midnight on a 12-hour clock. */
export function formatMinutesOfDay(min: number): string {
  const end = min >= 1440;
  if (end && !usesHour12()) return '24:00';
  const d = end ? new Date(2026, 0, 2) : new Date(2026, 0, 1, Math.floor(min / 60), min % 60);
  return formatTime(d.getTime());
}

/** Whether times are written on a 12-hour clock, as chosen or as the language does. */
function usesHour12(): boolean {
  const h = hour12();
  if (h !== undefined) return h;
  return Boolean(new Intl.DateTimeFormat(formatLocale(), { hour: 'numeric' }).resolvedOptions().hour12);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(formatLocale(), { maximumFractionDigits: 1 }).format(n);
}

/** A size of stored data, such as "9 kB" or "1.2 MB", as the language writes it. */
export function formatSize(bytes: number): string {
  const mb = bytes >= 1024 * 1024;
  return new Intl.NumberFormat(formatLocale(), {
    style: 'unit',
    unit: mb ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: mb ? 1 : 0,
  }).format(mb ? bytes / 1024 / 1024 : Math.ceil(bytes / 1024));
}

/** A time in milliseconds, such as "12 ms". */
export function formatMilliseconds(ms: number): string {
  return new Intl.NumberFormat(formatLocale(), { style: 'unit', unit: 'millisecond' }).format(ms);
}

/** "+25%" (a change, signed) or "25%", with the spacing of the language ("25 %" in French). */
export function formatPercent(ratio: number, signed = true): string {
  return new Intl.NumberFormat(formatLocale(), {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(ratio);
}

export function timestampSuffix(ms = Date.now()): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
