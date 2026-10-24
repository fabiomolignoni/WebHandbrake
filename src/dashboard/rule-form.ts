/**
 * How the rule editor shows a rule: the answer to When, and whether the rule already uses one of
 * the advanced options of Details (which then start open, so that nothing in force is hidden).
 * Sites, When and What happens show every setting.
 */

import { defaultOptions } from '../engine/defaults';
import type { GroupOptions, Policy } from '../engine/types';

/** "When should it apply?": every time, at certain times, after some time or after some visits. */
export type WhenKind = 'always' | 'schedule' | 'limit' | 'visits';

export function whenKind(p: Policy): WhenKind {
  if (p.budget) return p.budget.type === 'visits' ? 'visits' : 'limit';
  return p.schedule.mode === 'always' ? 'always' : 'schedule';
}

/** Which windows and tabs the rule applies to, frames, quick focus sessions. */
export function optionsAdvanced(o: GroupOptions): boolean {
  const d = defaultOptions();
  return (
    o.privacy !== d.privacy || o.tabs !== d.tabs || o.embeds !== d.embeds || o.quickSession !== d.quickSession
  );
}
