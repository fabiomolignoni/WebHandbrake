/**
 * How the rule editor shows a rule: the first question of each part, and whether the rule already
 * uses one of the advanced options of When or Details (which then start open, so that nothing in
 * force is hidden). Sites and What happens show every setting.
 */

import { defaultOptions } from '../engine/defaults';
import type { GroupOptions, Period, Policy } from '../engine/types';

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

/** Outside certain times; a limit on visits or continuous use, with another period or only at certain times. */
export function conditionAdvanced(p: Policy): boolean {
  const b = p.budget;
  if (!b) return p.schedule.mode === 'outside';
  if (p.schedule.mode !== 'always' || b.type !== 'time') return true;
  return !everyKind(b.period) || Boolean(b.period.offset);
}

/** Which windows and tabs the rule applies to, frames, quick focus sessions. */
export function optionsAdvanced(o: GroupOptions): boolean {
  const d = defaultOptions();
  return (
    o.privacy !== d.privacy || o.tabs !== d.tabs || o.embeds !== d.embeds || o.quickSession !== d.quickSession
  );
}
