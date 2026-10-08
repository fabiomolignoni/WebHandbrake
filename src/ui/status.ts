/**
 * One visual language for the friction ladder (principle G1, docs/design.md): every intervention
 * has a fixed icon and one of a few tones, used identically on every surface. Tones always come
 * with an icon and words (WCAG 1.4.1).
 */

import type { Intervention, InterventionType } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatDuration, formatWhen } from '../shared/format';
import type { DecisionView, GroupStatus } from '../shared/models';

export type Tone = 'free' | 'gentle' | 'friction' | 'protected' | 'calm' | 'neutral';

/** Interventions from the gentlest to the strongest (the order of the friction picker). */
export const LADDER: InterventionType[] = [
  'track',
  'remind',
  'filter',
  'ask',
  'delay',
  'challenge',
  'block',
  'close',
  'redirect',
];

const ICONS: Record<InterventionType, string> = {
  allow: 'check-circle',
  track: 'chart',
  remind: 'bell',
  filter: 'droplet',
  ask: 'chat',
  delay: 'hourglass',
  challenge: 'keyboard',
  block: 'brake',
  close: 'x-circle',
  redirect: 'redirect',
};

export function interventionIcon(type: InterventionType): string {
  return ICONS[type];
}

/** Icon of a state: free states show a check, the others what happens. */
export function statusIcon(type: InterventionType): string {
  return toneOf(type) === 'free' ? 'check-circle' : ICONS[type];
}

/** A state as a noun ("Blocked", "Asks first", "Wait 20 s"), for pills and headlines. */
export function statusName(i: Intervention): string {
  return t(`status.type.${i.type}`, { seconds: i.type === 'delay' ? i.seconds : 0 });
}

export function toneOf(type: InterventionType): Tone {
  switch (type) {
    case 'allow':
    case 'track':
      return 'free';
    case 'remind':
    case 'filter':
      return 'gentle';
    case 'ask':
    case 'delay':
    case 'challenge':
      return 'friction';
    default:
      return 'protected';
  }
}

/** Notches of the friction meter (0 = not applicable). */
export function meterLevel(tone: Tone): number {
  return { neutral: 0, calm: 0, free: 1, gentle: 2, friction: 3, protected: 4 }[tone];
}

export interface StatusView {
  tone: Tone;
  icon: string;
  /** Short label for pills ("Blocked until 17:00"). */
  label: string;
}

/** Status of a group right now (Today, group rows). */
export function groupStatus(g: GroupStatus, now = Date.now()): StatusView {
  if (!g.enabled) return { tone: 'neutral', icon: 'circle', label: t('status.off') };
  if (g.pause) {
    return {
      tone: 'calm',
      icon: 'pause',
      label: g.pause.until
        ? t('status.pausedUntil', { when: formatWhen(g.pause.until, now) })
        : t('status.paused'),
    };
  }
  const i = g.intervention;
  if (!i) return { tone: 'neutral', icon: 'circle', label: t('status.noRule') };
  if (g.source === 'session')
    return {
      tone: 'protected',
      icon: 'target',
      label: g.until ? t('status.sessionUntil', { when: formatWhen(g.until, now) }) : t('status.session'),
    };
  return interventionStatus(i, g.until, now);
}

export function interventionStatus(i: Intervention, until: number | null, now = Date.now()): StatusView {
  const tone = toneOf(i.type);
  const icon = statusIcon(i.type);
  if (i.type === 'allow' || i.type === 'track')
    return {
      tone,
      icon,
      label: until ? t('status.freeUntil', { when: formatWhen(until, now) }) : t('status.free'),
    };
  const what = statusName(i);
  return {
    tone,
    icon,
    label: until ? t('status.until', { what, when: formatWhen(until, now) }) : what,
  };
}

export interface SiteStatus extends StatusView {
  /** The headline of the popup hero. */
  title: string;
}

/** Status of the current site (popup hero). */
export function siteStatus(d: DecisionView | null, now = Date.now()): SiteStatus {
  if (!d || d.exempt) return { tone: 'neutral', icon: 'globe', label: '', title: t('status.site.exempt') };
  if (d.allowlisted)
    return { tone: 'free', icon: 'check-circle', label: '', title: t('status.site.allowlisted') };
  if (d.session && d.severity >= 4) {
    return {
      tone: 'protected',
      icon: 'target',
      label: '',
      title: t('status.site.session', { when: formatWhen(d.session.endAt, now) }),
    };
  }
  if (d.severity >= 4) {
    const s = interventionStatus(d.intervention, d.until, now);
    return { ...s, title: s.label };
  }
  if (!d.groups.length) {
    return d.excepted.length
      ? { tone: 'free', icon: 'check-circle', label: '', title: t('status.site.excepted') }
      : { tone: 'neutral', icon: 'globe', label: '', title: t('status.site.noRules') };
  }
  const paused = d.groups.find((g) => g.pause);
  if (paused?.pause) {
    return {
      tone: 'calm',
      icon: 'pause',
      label: '',
      title: paused.pause.until
        ? t('status.pausedUntil', { when: formatWhen(paused.pause.until, now) })
        : t('status.pausedLeft', { duration: formatDuration(paused.pause.remaining ?? 0) }),
    };
  }
  const passed = d.groups.find((g) => g.pass);
  if (passed?.pass) {
    return {
      tone: 'calm',
      icon: 'check-circle',
      label: '',
      title: passed.pass.until
        ? t('status.site.passUntil', { when: formatWhen(passed.pass.until, now) })
        : t('status.site.passVisit'),
    };
  }
  const tone = toneOf(d.intervention.type);
  const icon = statusIcon(d.intervention.type);
  const budget = d.groups[0]?.policies.find(
    (p) => p.budget && p.scheduleActive && !p.budget.exhausted,
  )?.budget;
  if (budget) {
    const left =
      budget.type === 'visits'
        ? t('status.site.visitsLeft', { count: Math.max(0, budget.limit - budget.used) })
        : t('status.site.timeLeft', { duration: formatDuration(budget.remaining) });
    return { tone, icon, label: '', title: left };
  }
  if (d.intervention.type === 'remind' || d.intervention.type === 'filter')
    return {
      tone,
      icon,
      label: '',
      title: t('status.site.gentle', { what: statusName(d.intervention) }),
    };
  if (d.restriction)
    return {
      tone,
      icon,
      label: '',
      title: t('status.site.freeUntil', { when: formatWhen(d.restriction.at, now) }),
    };
  return { tone, icon, label: '', title: t('status.site.free') };
}
