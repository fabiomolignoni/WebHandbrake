/**
 * Reconciliation (REL-01): idempotently brings rules, open tabs, alarms, badges and content
 * scripts in line with the stored state. Called on start-up, on every state change and by
 * alarms at the next scheduled transition (event driven, PERF-01).
 */

import { SEVERITY } from '../engine/decide';
import { expiredGrants, nextGlobalChange } from '../engine/next';
import { t } from '../i18n/i18n';
import { api, quiet } from '../platform/api';
import { formatDuration } from '../shared/format';
import type { ChangedBroadcast } from '../shared/rpc';
import { updateActiveBadges } from './badge';
import { now } from './clock';
import { updateContentScripts } from './contentscripts';
import { counters } from './diagnostics-state';
import { syncRules } from './dnr-sync';
import { enforceAllTabs } from './enforce';
import { ctx } from './engine';
import { rebuildMenus } from './menus';
import { notify } from './notifications';
import { store } from './store';

export const ALARM_NEXT = 'whb-next';
export const ALARM_PERIODIC = 'whb-periodic';

let queued: Promise<void> | null = null;
let inFlight: Promise<void> = Promise.resolve();
let configDirty = true;
let preciseTimer: ReturnType<typeof setTimeout> | null = null;

export function reconcile(_reason: string, opts: { config?: boolean } = {}): Promise<void> {
  if (opts.config) configDirty = true;
  if (queued) return queued;
  const run = inFlight.then(async () => {
    queued = null;
    const cfg = configDirty;
    configDirty = false;
    await doReconcile(cfg);
  });
  queued = run;
  inFlight = run.catch((e) => console.error('WebHandbrake reconcile failed', e));
  return run;
}

async function doReconcile(configChanged: boolean) {
  await store.ready();
  counters.reconciles++;
  await maintenance();
  await syncRules();
  if (configChanged) {
    await quiet(updateContentScripts());
    await quiet(rebuildMenus());
  }
  await enforceAllTabs();
  await scheduleNext();
  await quiet(updateActiveBadges());
  broadcast(['state', ...(configChanged ? (['config'] as const) : [])]);
}

/** Expires grants, sessions, cool-downs and pending changes; sends due notifications. */
export async function maintenance() {
  const c = ctx();
  const t0 = c.now;
  const state = store.state;
  let changed = false;

  for (const g of expiredGrants(c)) {
    state.grants = state.grants.filter((x) => x !== g);
    changed = true;
    if (g.kind === 'pass' && g.cooldownMinutes && g.until && g.groups !== '*') {
      // LIM-06: the chosen time is over, a cool-down follows.
      for (const groupId of g.groups) {
        state.cooldowns[`ask:${groupId}:${g.site ?? ''}`] = {
          until: g.until + g.cooldownMinutes * 60_000,
          group: groupId,
          site: g.scope === 'site' ? g.site : undefined,
          kind: 'ask',
        };
      }
    }
    if (g.kind === 'pause') {
      const rec = state.pauses.find((p) => p.grantId === g.id);
      if (rec && g.remaining !== undefined)
        rec.used = Math.round(((g.minutes ?? rec.minutes) * 60 - Math.max(0, g.remaining)) / 60);
    }
  }
  for (const [k, cd] of Object.entries(state.cooldowns)) {
    if (cd.until <= t0) {
      delete state.cooldowns[k];
      changed = true;
    }
  }
  for (const [k, until] of Object.entries(state.forfeits)) {
    if (until <= t0) {
      delete state.forfeits[k];
      changed = true;
    }
  }
  for (const s of state.sessions) {
    if (s.endAt <= t0 && !s.notified) {
      s.notified = true;
      changed = true;
      if (store.config.settings.notifications.sessionEnd) {
        await notify(
          `session-${s.id}`,
          t('notify.sessionEnd.title'),
          t('notify.sessionEnd.body', {
            duration: formatDuration((s.endAt - s.startAt) / 1000),
            stopped: (s as { stopped?: number }).stopped ?? 0,
          }),
        );
      }
    }
  }
  const before = state.sessions.length;
  state.sessions = state.sessions.filter((s) => s.endAt > t0 - 60_000 || !s.notified);
  if (state.sessions.length !== before) changed = true;

  const pendingBefore = state.pending.length;
  state.pending = state.pending.filter((p) => p.expiresAt > t0);
  if (state.pending.length !== pendingBefore) changed = true;
  for (const p of state.pending) {
    const flagged = p as { notified?: boolean };
    if (p.readyAt <= t0 && !flagged.notified) {
      flagged.notified = true;
      changed = true;
      if (store.config.settings.notifications.pendingReady) {
        await notify(
          `pending-${p.id}`,
          t('notify.pending.title'),
          t('notify.pending.body', { count: p.units.length }),
        );
      }
    }
  }
  state.lastAlive = t0;
  if (changed) await store.saveState();
}

async function scheduleNext() {
  const c = ctx();
  const next = nextGlobalChange(c);
  if (preciseTimer) {
    clearTimeout(preciseTimer);
    preciseTimer = null;
  }
  if (next === null) {
    await quiet(api.alarms.clear(ALARM_NEXT));
    return;
  }
  const delay = Math.max(0, next - c.now);
  await quiet(api.alarms.create(ALARM_NEXT, { when: Date.now() + delay + 200 }));
  // Alarms can be late by up to 30 s on Chrome: also use a timer while the worker is alive (ENF-02).
  if (delay < 5 * 60_000) {
    preciseTimer = setTimeout(() => void reconcile('timer'), delay + 100);
  }
}

export async function ensurePeriodicAlarm() {
  const existing = await quiet(api.alarms.get(ALARM_PERIODIC));
  if (!existing) await quiet(api.alarms.create(ALARM_PERIODIC, { periodInMinutes: 1 }));
}

export function broadcast(changed: ChangedBroadcast['changed']) {
  const msg: ChangedBroadcast = { whb: 1, changed };
  void quiet(api.runtime.sendMessage(msg));
}

export function severityChanged(a: number, b: number) {
  return a >= SEVERITY.ask !== b >= SEVERITY.ask || a !== b;
}

export function trustedNow() {
  return now();
}
