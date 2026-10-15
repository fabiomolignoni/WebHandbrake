/**
 * How severe each intervention is, from allowing a page to closing its tab. A module of its own,
 * without dependencies, so that the pages can tell a replaced page from an open one without
 * bundling the engine.
 */

import type { Intervention, InterventionType } from './types';

export const SEVERITY: Record<InterventionType, number> = {
  allow: 0,
  track: 1,
  // 2 was the reminder (#17); the numbers are kept because grants store them.
  filter: 3,
  ask: 4,
  delay: 5,
  challenge: 6,
  block: 7,
  redirect: 7,
  close: 8,
};

/** Interventions from this severity up replace the page (navigation interventions). */
export const NAV_SEVERITY = SEVERITY.ask;

/** Interventions that can be passed (a question, a wait, a challenge), for some access. */
export const PASSABLE: InterventionType[] = ['ask', 'delay', 'challenge'];

export function severityOf(i: Intervention): number {
  return SEVERITY[i.type];
}

/** Whether a decision replaces the page with an intervention. */
export function isNav(d: { severity: number }): boolean {
  return d.severity >= NAV_SEVERITY;
}
