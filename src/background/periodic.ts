/** Work done by the periodic alarm, every minute (PERF-01: no tab polling). */

import { dayKeyOf } from '../engine/time';
import { now } from './clock';
import { counters } from './diagnostics-state';
import { announceAvailableLater } from './later';
import { checkIncognito } from './permissions';
import { maintenance, reconcile } from './reconcile';
import { applyRetention } from './stats';
import { store } from './store';

/** Persists counters, expires timed state and runs the daily tasks once per logical day. */
export async function periodic() {
  counters.wakeups++;
  await store.flushAll();
  const before = JSON.stringify([
    store.state.grants.length,
    store.state.sessions.length,
    store.state.pending.length,
  ]);
  await maintenance();
  const after = JSON.stringify([
    store.state.grants.length,
    store.state.sessions.length,
    store.state.pending.length,
  ]);
  if (before !== after) await reconcile('periodic');
  const today = dayKeyOf(now(), store.cc.cal);
  if (store.meta.lastDaily !== today) {
    store.meta.lastDaily = today;
    await store.saveMeta();
    await daily();
  }
  await announceAvailableLater();
}

async function daily() {
  store.usage.pruneMinutes(now());
  await store.flushUsage();
  await applyRetention();
  await checkIncognito();
  // A daily snapshot even when nothing changed (DAT-03).
  await store.snapshotDaily();
}
