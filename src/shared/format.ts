/** Locale aware formatting of times, dates and durations (I18N-04, SET-03). */

import type { Settings } from '../engine/types';
import { locale, t } from '../i18n/i18n';

let hourPref: Settings['hour12'] = 'auto';
let datePref: Settings['dateFormat'] = 'auto';

export function setFormatPrefs(s: Pick<Settings, 'hour12' | 'dateFormat'>) {
  hourPref = s.hour12;
  datePref = s.dateFormat;
}

function hour12(): boolean | undefined {
  return hourPref === 'auto' ? undefined : hourPref === '12';
}

export function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', hour12: hour12() }).format(
    ms,
  );
}

export function formatDate(
  ms: number,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
): string {
  if (datePref === 'iso') {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return new Intl.DateTimeFormat(locale(), opts).format(ms);
}

export function formatDateTime(ms: number): string {
  return `${formatDate(ms, { weekday: 'short', day: 'numeric', month: 'short' })} ${formatTime(ms)}`;
}

function sameDay(a: number, b: number) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** "17:00", "tomorrow 09:00", "Fri 09:00", "12 Oct 09:00". */
export function formatWhen(ms: number, now = Date.now()): string {
  if (sameDay(ms, now)) return formatTime(ms);
  if (sameDay(ms, now + 86_400_000)) return t('time.tomorrowAt', { time: formatTime(ms) });
  if (ms - now < 6 * 86_400_000) return `${formatDate(ms, { weekday: 'short' })} ${formatTime(ms)}`;
  return `${formatDate(ms, { day: 'numeric', month: 'short' })} ${formatTime(ms)}`;
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
  if (h >= 48 && m === 0) return t('duration.d', { d: Math.round(h / 24) });
  return m ? t('duration.hm', { h, m }) : t('duration.h', { h });
}

/** Countdown "4:59" or "1:02:03". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Badge text (4 characters at most): "45s", "18m", "2h". */
export function formatBadge(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.ceil(seconds))}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export function weekdayNames(style: 'short' | 'long' = 'short'): string[] {
  const f = new Intl.DateTimeFormat(locale(), { weekday: style });
  // 2026-10-04 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2026, 9, 4 + i, 12)));
}

export function formatMinutesOfDay(min: number): string {
  if (min >= 1440) return hour12() ? '12:00 AM' : '24:00';
  const d = new Date(2026, 0, 1, Math.floor(min / 60), min % 60);
  return formatTime(d.getTime());
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(n);
}

export function formatPercent(ratio: number): string {
  return new Intl.NumberFormat(locale(), {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(ratio);
}

export function timestampSuffix(ms = Date.now()): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
