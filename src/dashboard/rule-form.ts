/**
 * How the rule editor shows a rule: the first question of each part, and whether the rule already
 * uses one of the part's advanced options (which then start open, so that nothing in force is
 * hidden).
 */

import { defaultIntervention, defaultOptions } from '../engine/defaults';
import type { GroupOptions, Intervention, PausePolicy, Period, Policy, Target } from '../engine/types';

/** "When should it apply?": every time, at certain times, or after some time. */
export type WhenKind = 'always' | 'schedule' | 'limit';

export function whenKind(p: Policy): WhenKind {
  if (p.budget) return 'limit';
  return p.schedule.mode === 'always' ? 'always' : 'schedule';
}

/** A period that starts again every so many minutes, hours or days, as the first question sets it. */
export function everyKind(p: Period): boolean {
  return p.kind === 'hour' || p.kind === 'day' || p.kind === 'days' || p.kind === 'minutes';
}

/** The rule's sites have exceptions. */
export const targetsAdvanced = (targets: Target[]): boolean => targets.some((x) => x.allow);

/** Outside certain times; a limit on visits or continuous use, with another period or only at certain times. */
export function conditionAdvanced(p: Policy): boolean {
  const b = p.budget;
  if (!b) return p.schedule.mode === 'outside';
  if (p.schedule.mode !== 'always' || b.type !== 'time') return true;
  return !everyKind(b.period) || Boolean(b.period.offset);
}

/** Settings of what happens that its first question leaves as they are. */
export function interventionAdvanced(i: Intervention): boolean {
  switch (i.type) {
    case 'filter':
      return i.filter === 'custom' || Boolean(i.mute);
    case 'ask': {
      const d = defaultIntervention('ask') as Extract<Intervention, { type: 'ask' }>;
      // The longest time, a first question, leaves out the choices longer than it.
      const usual = d.choices.filter((c) => c <= i.maxMinutes);
      return (
        i.choices.join() !== (usual.length ? usual : [i.maxMinutes]).join() ||
        (i.seconds ?? 0) !== d.seconds ||
        i.cooldownMinutes !== undefined
      );
    }
    case 'delay':
      return (
        Boolean(i.randomTo) ||
        Boolean(i.increase) ||
        (i.onBlur ?? 'pause') !== 'pause' ||
        Boolean(i.autoContinue) ||
        Boolean(i.hideCountdown) ||
        grantAdvanced(i.grant)
      );
    case 'challenge':
      return (i.kind === 'random' && (i.charset ?? 'alnum') !== 'alnum') || grantAdvanced(i.grant);
    case 'redirect':
      return /\{[a-z]+\}/.test(i.url);
    default:
      return false;
  }
}

const grantAdvanced = (g: { scope: string; mode: string }) => g.scope !== 'site' || g.mode !== 'visit';

/** Whether what happens has advanced options at all. */
export const hasAdvancedOptions = (type: Intervention['type']): boolean =>
  ['filter', 'ask', 'delay', 'challenge', 'redirect'].includes(type);

export const pauseAdvanced = (p: PausePolicy): boolean => p.allowed && p.duringSessions;

/** Which windows and tabs the rule applies to, frames, quick focus sessions. */
export function optionsAdvanced(o: GroupOptions): boolean {
  const d = defaultOptions();
  return (
    o.privacy !== d.privacy || o.tabs !== d.tabs || o.embeds !== d.embeds || o.quickSession !== d.quickSession
  );
}
