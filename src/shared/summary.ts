/**
 * Natural-language summaries: the same functions are used by the group
 * cards, the editor's "In brief" panel and the "Why?" tool.
 */

import type { ChangeUnit } from '../engine/changes';
import { ALL_SITES } from '../engine/patterns';
import { isFullDay } from '../engine/time';
import type {
  Budget,
  Group,
  Intervention,
  Period,
  Policy,
  Schedule,
  Target,
  TimeWindow,
} from '../engine/types';
import { t } from '../i18n/i18n';
import { formatDuration, formatMinutesOfDay, weekdayNames } from './format';

let weekStart = 1;
export function setWeekStart(ws: number) {
  weekStart = ws;
}

function orderedDays(): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

export function describeDays(days: number[]): string {
  const set = new Set(days);
  if (set.size === 7) return t('days.everyDay');
  if (set.size === 0) return t('days.none');
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return t('days.weekdays');
  if (set.size === 2 && set.has(0) && set.has(6)) return t('days.weekends');
  const names = weekdayNames('short');
  const order = orderedDays();
  const runs: number[][] = [];
  for (const d of order) {
    if (!set.has(d)) continue;
    const last = runs[runs.length - 1];
    if (last && order.indexOf(last[last.length - 1]) === order.indexOf(d) - 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) =>
      r.length >= 3 ? `${names[r[0]]}–${names[r[r.length - 1]]}` : r.map((d) => names[d]).join(', '),
    )
    .join(', ');
}

export function describeRange(w: TimeWindow): string {
  if (isFullDay(w)) return t('time.allDay');
  return `${formatMinutesOfDay(w.start)}–${formatMinutesOfDay(w.end === 0 ? 1440 : w.end)}`;
}

export function describeWindows(windows: TimeWindow[]): string {
  if (!windows.length) return t('summary.noWindows');
  const byDays = new Map<string, TimeWindow[]>();
  for (const w of windows) {
    const key = [...w.days].sort().join(',');
    byDays.set(key, [...(byDays.get(key) ?? []), w]);
  }
  return [...byDays.values()]
    .map((ws) => `${describeDays(ws[0].days)} ${ws.map(describeRange).join(', ')}`)
    .join('; ');
}

export function describeSchedule(s: Schedule): string {
  switch (s.mode) {
    case 'always':
      return t('summary.always');
    case 'during':
      return describeWindows(s.windows);
  }
}

export function describePeriod(p: Period): string {
  switch (p.kind) {
    case 'hour':
      return t('period.perHour');
    case 'day':
      return t('period.perDay');
    case 'week':
      return t('period.perWeek');
    case 'month':
      return t('period.perMonth');
    case 'minutes':
      return t('period.everyMinutes', { duration: formatDuration((p.n ?? 60) * 60) });
    case 'days':
      return t('period.everyDays', { n: p.n ?? 1 });
    case 'rolling':
      return t('period.rolling', { duration: formatDuration((p.n ?? 60) * 60) });
  }
}

export function describeBudget(b: Budget): string {
  const perSite = b.perSite ? 'yes' : 'no';
  switch (b.type) {
    case 'time':
      return t('budget.time', {
        duration: formatDuration(b.minutes * 60),
        period: describePeriod(b.period),
        perSite,
      });
    case 'visits':
      return t('budget.visits', { count: b.count, period: describePeriod(b.period), perSite });
  }
}

export function interventionName(type: Intervention['type']): string {
  return t(`intervention.${type}`);
}

export function describeIntervention(i: Intervention): string {
  switch (i.type) {
    case 'delay': {
      const hidden = i.hideCountdown ? 'yes' : 'no';
      if (i.increase)
        return t('intervention.delay.growingSummary', { seconds: i.seconds, increase: i.increase, hidden });
      const seconds = i.randomTo && i.randomTo > i.seconds ? `${i.seconds}–${i.randomTo}` : String(i.seconds);
      return t('intervention.delay.summary', { seconds, hidden });
    }
    case 'ask':
      return t('intervention.ask.summary', { max: formatDuration(i.maxMinutes * 60) });
    case 'challenge':
      if (i.kind === 'phrase') return t('intervention.challenge.phrase');
      if (i.kind === 'math') return t('intervention.challenge.math');
      return t('intervention.challenge.random', { length: i.length ?? 24 });
    case 'filter':
      return t(`filter.${i.filter}`);
    case 'redirect':
      return t('intervention.redirect.summary', { url: i.url });
    case 'allow':
      return t('intervention.allow.summary');
    default:
      return interventionName(i.type);
  }
}

export function describeCondition(p: Policy): string {
  const sched = describeSchedule(p.schedule);
  if (!p.budget) return sched;
  return t('summary.condition', { schedule: sched, budget: describeBudget(p.budget) });
}

export function describePolicy(p: Policy): string {
  return `${describeCondition(p)} → ${describeIntervention(p.intervention)}`;
}

/** A rule's condition and what happens then, as a sentence. */
export function summarizeGroup(g: Group): string {
  return g.policies.map(describePolicy).join(' · ');
}

export function targetTypeLabel(type: Target['type']): string {
  return t(`targetType.${type}`);
}

export function describeTarget(tg: Pick<Target, 'type' | 'value' | 'allow'>): string {
  const v =
    tg.type === 'homepage'
      ? `${tg.value}/`
      : tg.type === 'wildcard' && tg.value === ALL_SITES
        ? t('targets.allSites')
        : tg.value;
  return tg.allow ? t('target.exceptionOf', { value: v }) : v;
}

/** One line for a configuration change unit (pending changes, cost dialogs, import previews). */
export function describeUnit(u: ChangeUnit): string {
  switch (u.kind) {
    case 'group.add':
      return t('unit.groupAdd', { name: u.group.name });
    case 'group.remove':
      return t('unit.groupRemove', { name: u.name });
    case 'group.field':
      return t(`unit.field.${u.field}`, { name: u.name });
    case 'target.add':
      return t(u.target.allow ? 'unit.exceptionAdd' : 'unit.targetAdd', {
        value: u.target.value,
        owner: u.ownerName,
      });
    case 'target.remove':
      return t(u.target.allow ? 'unit.exceptionRemove' : 'unit.targetRemove', {
        value: u.target.value,
        owner: u.ownerName,
      });
    case 'order':
      return t('unit.order');
    case 'setting':
      return t('unit.setting', { setting: settingLabel(u.path) });
  }
}

export function settingLabel(path: string): string {
  const key = `setting.${path}`;
  const s = t(key);
  return s === key ? path : s;
}
