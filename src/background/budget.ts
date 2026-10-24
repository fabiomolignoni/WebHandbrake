/** Give up the remaining time now (a strengthening, always immediate). */

import { policyKey } from '../engine/decide';
import { periodRange } from '../engine/time';
import { now } from './clock';
import { reconcile } from './reconcile';
import { store } from './store';

export async function forfeitBudget(groupId: string) {
  await store.ready();
  const g = store.config.groups.find((x) => x.id === groupId);
  if (!g) return;
  const t0 = now();
  for (const p of g.policies) {
    const b = p.budget;
    if (!b) continue;
    // Per-site budgets included: the policy-wide forfeit covers every site.
    store.state.forfeits[policyKey(p.id, null)] = periodRange(b.period, t0, store.cc.cal).end;
  }
  // Passes and pauses for the group end too.
  store.state.grants = store.state.grants.filter(
    (x) =>
      !(x.kind !== 'recheck' && Array.isArray(x.groups) && x.groups.length === 1 && x.groups[0] === g.id),
  );
  await store.saveState();
  await reconcile('forfeit');
}
