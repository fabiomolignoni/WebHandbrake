/** LIM-11: give up the remaining time now (a strengthening, always immediate). */

import { policyKey } from '../engine/decide';
import { MINUTE, periodRange } from '../engine/time';
import type { Period } from '../engine/types';
import { now } from './clock';
import { reconcile } from './reconcile';
import { store } from './store';

/** End of the period that a forfeit covers: a rolling window refills only after its full length. */
function forfeitEnd(period: Period, t0: number): number {
  if (period.kind === 'rolling') return t0 + (period.n ?? 60) * MINUTE;
  return periodRange(period, t0, store.cc.cal).end;
}

export async function forfeitBudget(groupId: string) {
  await store.ready();
  const g = store.config.groups.find((x) => x.id === groupId);
  if (!g) return;
  const t0 = now();
  for (const p of g.policies) {
    const b = p.budget;
    if (!b) continue;
    if (b.type === 'session') {
      store.state.cooldowns[`session:${policyKey(p.id, null)}`] = {
        until: t0 + b.cooldownMinutes * 60_000,
        group: g.id,
        kind: 'session',
        policy: p.id,
      };
      continue;
    }
    // Per-site budgets included: the policy-wide forfeit covers every site.
    store.state.forfeits[policyKey(p.id, null)] = forfeitEnd(b.period, t0);
  }
  // Passes and pauses for the group end too.
  store.state.grants = store.state.grants.filter(
    (x) =>
      !(x.kind !== 'recheck' && Array.isArray(x.groups) && x.groups.length === 1 && x.groups[0] === g.id),
  );
  await store.saveState();
  await reconcile('forfeit');
}
