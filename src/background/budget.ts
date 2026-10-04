/** LIM-11: give up the remaining time now (a strengthening, always immediate). */

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
    if (b.type === 'session') {
      store.state.cooldowns[`session:${policyKey(p.id, null)}`] = {
        until: t0 + b.cooldownMinutes * 60_000,
        group: g.id,
        kind: 'session',
        policy: p.id,
      };
      continue;
    }
    const range = periodRange(b.period, t0, store.cc.cal);
    const until = b.period.kind === 'rolling' ? t0 + (b.period.n ?? 60) * 60_000 : range.end;
    store.state.forfeits[policyKey(p.id, null)] = until;
  }
  // Per-site budgets: forfeit for every site seen today.
  for (const p of g.policies) {
    if (!p.budget?.perSite || p.budget.type === 'session') continue;
    const range = periodRange(p.budget.period, t0, store.cc.cal);
    for (const key of Object.keys(store.state.activity)) {
      const prefix = `s:${g.id}:`;
      if (key.startsWith(prefix)) store.state.forfeits[policyKey(p.id, key.slice(prefix.length))] = range.end;
    }
  }
  // Passes and pauses for the group end too.
  store.state.grants = store.state.grants.filter(
    (x) =>
      !(x.kind !== 'recheck' && Array.isArray(x.groups) && x.groups.length === 1 && x.groups[0] === g.id),
  );
  await store.saveState();
  await reconcile('forfeit');
}
