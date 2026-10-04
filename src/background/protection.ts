/**
 * Protection (PRO-01…PRO-05, PRO-12, PRO-15): every configuration change goes through here.
 * Strengthening units are applied at once (PRO-02); weakening ones cost a confirmation (Soft), a
 * wait (Balanced), a cooling-off with confirmation and challenge (Strict) or are refused
 * (Locked, or Strict while the group is active, or inside the access lock windows).
 */

import {
  applyUnits,
  type ChangeUnit,
  classify,
  type Direction,
  diffConfig,
  isStale,
  LEVEL_RANK,
  unitGroups,
} from '../engine/changes';
import { normalizeConfig } from '../engine/schema';
import type { Config, PendingChange, ProtectionLevel } from '../engine/types';
import { t } from '../i18n/i18n';
import type { SaveResult, TicketView } from '../shared/models';
import { now } from './clock';
import { hashPassword } from './crypto';
import { ctx, globalLevel, groupLevel, inAccessWindow, lockedNow, lockedUntilFor } from './engine';
import { reconcile } from './reconcile';
import { store } from './store';
import { accessSteps, createTicket, registerExecutor, type Step } from './tickets';

const emptyResult = (): SaveResult => ({ applied: [], ticket: null, pending: null, refused: null });

function unitLevel(u: ChangeUnit, config: Config, t0: number): { level: ProtectionLevel; groups: string[] } {
  const ids = unitGroups(u, config);
  if (!ids.length) return { level: globalLevel(t0), groups: [] };
  let level: ProtectionLevel = 'soft';
  for (const id of ids) {
    const g = config.groups.find((x) => x.id === id);
    const l = g ? groupLevel(g, t0) : globalLevel(t0);
    if (LEVEL_RANK[l] > LEVEL_RANK[level]) level = l;
  }
  return { level, groups: ids };
}

/** Writes a configuration (already approved units) and reconciles everything. */
export async function commit(next: Config, reason: string) {
  await store.writeConfig(next, reason);
  await reconcile(reason, { config: true });
}

export async function applyApproved(units: ChangeUnit[], reason: string): Promise<ChangeUnit[]> {
  const live = units.filter((u) => !isStale(u, store.config));
  if (!live.length) return [];
  await commit(applyUnits(store.config, live, now()), reason);
  return live;
}

/**
 * Proposes a full new configuration. The difference with the current one is split into units
 * that are classified and routed according to the protection rules.
 */
export async function proposeConfig(
  raw: Config,
  reason: string,
  opts: { errors?: string[] } = {},
): Promise<SaveResult> {
  await store.ready();
  const { config: next } = normalizeConfig(raw);
  const cur = store.config;
  const units = diffConfig(cur, next);
  const result = emptyResult();
  if (opts.errors?.length) result.errors = opts.errors;
  if (!units.length) return result;

  const c = ctx();
  const t0 = c.now;
  const access = accessSteps();
  const immediate: ChangeUnit[] = [];
  const costed: ChangeUnit[] = [];
  const pending: ChangeUnit[] = [];
  const refused: ChangeUnit[] = [];
  // Reported reason: the most binding one seen (locked > lockedNow > accessWindow).
  let refusedReason: NonNullable<SaveResult['refused']>['reason'] | null = null;
  let refusedUntil: number | null = null;
  let costLevel: ProtectionLevel = 'soft';
  const accessWindow = inAccessWindow(t0);

  for (const u of units) {
    const dir: Direction = classify(u, cur);
    if (dir === 'strengthen') {
      immediate.push(u);
      continue;
    }
    if (dir === 'neutral') {
      if (accessWindow && access.length) {
        refused.push(u);
        if (!refusedReason) refusedReason = 'accessWindow';
      } else if (access.length) costed.push(u);
      else immediate.push(u);
      continue;
    }
    // Weakening.
    if (accessWindow) {
      refused.push(u);
      if (!refusedReason) refusedReason = 'accessWindow';
      continue;
    }
    const { level, groups } = unitLevel(u, cur, t0);
    if (level === 'locked') {
      refused.push(u);
      refusedReason = 'locked';
      const g = groups.length ? (cur.groups.find((x) => x.id === groups[0]) ?? null) : null;
      refusedUntil = lockedUntilFor(g && g.protection === 'locked' ? g : null);
      continue;
    }
    if (level === 'strict') {
      const locked = groups.length
        ? groups.some((id) => {
            const g = cur.groups.find((x) => x.id === id);
            return g ? lockedNow(g, c) : false;
          })
        : lockedNow(null, c);
      if (locked) {
        refused.push(u);
        if (refusedReason !== 'locked') refusedReason = 'lockedNow';
        continue;
      }
      pending.push(u);
      continue;
    }
    if (LEVEL_RANK[level] > LEVEL_RANK[costLevel]) costLevel = level;
    costed.push(u);
  }

  if (immediate.length) {
    await commit(applyUnits(cur, immediate, t0), reason);
    result.applied = immediate;
  }
  if (costed.length) {
    const p = store.config.settings.protection;
    const steps: Step[] = [...access];
    const weakening = costed.some((u) => classify(u, cur) === 'weaken');
    if (weakening)
      steps.push(
        costLevel === 'balanced' ? { type: 'wait', seconds: p.balancedDelaySeconds } : { type: 'confirm' },
      );
    const { view } = await createTicket({ kind: 'units', units: costed, reason }, steps);
    result.ticket = view;
    if (!view) result.applied.push(...costed);
  }
  if (pending.length) {
    const p = store.config.settings.protection;
    const change: PendingChange = {
      id: crypto.randomUUID(),
      createdAt: t0,
      readyAt: t0 + p.coolingOffHours * 3_600_000,
      expiresAt: t0 + (p.coolingOffHours + p.confirmHours) * 3_600_000,
      units: pending,
    };
    store.state.pending.push(change);
    await store.saveState();
    await reconcile('pending');
    result.pending = change;
  }
  if (refused.length)
    result.refused = { units: refused, reason: refusedReason ?? 'locked', until: refusedUntil };
  return result;
}

registerExecutor('units', async (ticket) => {
  if (ticket.purpose.kind !== 'units') return;
  return applyApproved(ticket.purpose.units, ticket.purpose.reason);
});

// ---------------------------------------------------------------------------
// Pending changes (PRO-03)
// ---------------------------------------------------------------------------

export async function confirmPending(id: string): Promise<{ ticket: TicketView | null; error?: string }> {
  await store.ready();
  const p = store.state.pending.find((x) => x.id === id);
  if (!p) return { ticket: null, error: 'pending.error.notFound' };
  const c = ctx();
  if (c.now < p.readyAt) return { ticket: null, error: 'pending.error.notReady' };
  const live = p.units.filter((u) => !isStale(u, store.config));
  if (!live.length) {
    store.state.pending = store.state.pending.filter((x) => x.id !== id);
    await store.saveState();
    await reconcile('pending');
    return { ticket: null, error: 'pending.error.outdated' };
  }
  for (const u of live) {
    const { level, groups } = unitLevel(u, store.config, c.now);
    if (level === 'locked') return { ticket: null, error: 'pending.error.locked' };
    const locked = groups.length
      ? groups.some((gid) => {
          const g = store.config.groups.find((x) => x.id === gid);
          return g ? lockedNow(g, c) && level === 'strict' : false;
        })
      : level === 'strict' && lockedNow(null, c);
    if (locked) return { ticket: null, error: 'pending.error.lockedNow' };
  }
  const steps: Step[] = [
    ...accessSteps(),
    { type: 'text', length: store.config.settings.protection.challengeLength },
  ];
  const { view } = await createTicket({ kind: 'pending', id }, steps);
  return { ticket: view };
}

registerExecutor('pending', async (ticket) => {
  if (ticket.purpose.kind !== 'pending') return;
  const id = ticket.purpose.id;
  const p = store.state.pending.find((x) => x.id === id);
  if (!p) throw new Error('pending.error.notFound');
  store.state.pending = store.state.pending.filter((x) => x.id !== id);
  await store.saveState();
  return applyApproved(p.units, 'pending');
});

/** Cancelling a pending weakening is a strengthening: always immediate. */
export async function cancelPending(id: string) {
  await store.ready();
  store.state.pending = store.state.pending.filter((x) => x.id !== id);
  await store.saveState();
  await reconcile('pending-cancel');
}

// ---------------------------------------------------------------------------
// Password (PRO-05, SEC-01)
// ---------------------------------------------------------------------------

export async function changePassword(password: string | null): Promise<SaveResult> {
  await store.ready();
  const next: Config = JSON.parse(JSON.stringify(store.config));
  next.settings.protection.access.passwordHash = password ? await hashPassword(password) : null;
  return proposeConfig(next, 'password');
}

// ---------------------------------------------------------------------------
// Emergency exit (PRO-15)
// ---------------------------------------------------------------------------

export async function requestEmergency(): Promise<{ readyAt: number }> {
  await store.ready();
  const t0 = now();
  if (!store.state.emergency) {
    store.state.emergency = {
      requestedAt: t0,
      readyAt: t0 + store.config.settings.protection.emergencyHours * 3_600_000,
    };
    store.addTamper({ at: t0, kind: 'emergency', detail: 'requested' });
    await store.saveState();
    await reconcile('emergency');
  }
  return { readyAt: store.state.emergency.readyAt };
}

export async function cancelEmergency() {
  await store.ready();
  if (!store.state.emergency) return;
  store.state.emergency = null;
  store.addTamper({ at: now(), kind: 'emergency', detail: 'cancelled' });
  await store.saveState();
  await reconcile('emergency');
}

export function emergencyPhrase(): string {
  return t('emergency.phrase');
}

export async function startEmergency(): Promise<{ ticket: TicketView | null; error?: string }> {
  await store.ready();
  const e = store.state.emergency;
  if (!e) return { ticket: null, error: 'emergency.error.notRequested' };
  if (now() < e.readyAt) return { ticket: null, error: 'emergency.error.notReady' };
  const { view } = await createTicket({ kind: 'emergency.complete' }, [
    { type: 'phrase', phrase: emergencyPhrase() },
  ]);
  return { ticket: view };
}

registerExecutor('emergency.complete', async () => {
  const t0 = now();
  const next: Config = JSON.parse(JSON.stringify(store.config));
  const p = next.settings.protection;
  p.level = 'soft';
  p.lockedUntil = null;
  p.access = { passwordHash: null, codeLength: 0, lockWindows: [] };
  for (const g of next.groups) {
    g.protection = null;
    g.protectionUntil = null;
  }
  store.state.sessions = store.state.sessions.map((s) =>
    s.endAt > t0 ? { ...s, endAt: t0, locked: false } : s,
  );
  store.state.emergency = null;
  store.addTamper({ at: t0, kind: 'emergency', detail: 'completed' });
  await store.saveState();
  await commit(next, 'emergency');
  return true;
});
