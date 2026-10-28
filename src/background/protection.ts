/**
 * Protection: every configuration change goes
 * through here. Strengthening and neutral units are applied at once. A loosening unit
 * follows the protections of the rules it changes (`unitGroups()`): a reminder costs a
 * confirmation, a wait is spent in the cost dialog or, when longer, becomes a pending change, a
 * password and a partner code are asked, and Locked and Permanent refuse it. A loosening that
 * changes no rule has nothing to follow and applies at once.
 *
 * Two kinds of loosening follow the emergency exit instead, for that change only: a restore, an
 * import or a reset, and a setting of the protection itself (`GUARD_SETTINGS`). They become a
 * pending change that waits the emergency exit's hours and is confirmed with a sentence.
 */

import {
  applyUnits,
  type ChangeUnit,
  classify,
  diffConfig,
  GUARD_SETTINGS,
  isStale,
  unitGroups,
} from '../engine/changes';
import { clone } from '../engine/json';
import { WAIT_IN_DIALOG_SECONDS } from '../engine/limits';
import { configChecksum, normalizeConfig } from '../engine/schema';
import type { Config, Group, PartnerCode, PendingChange, Protection } from '../engine/types';
import { t } from '../i18n/i18n';
import { sessionStore } from '../platform/api';
import type { PartnerSetup, SaveResult, TicketView } from '../shared/models';
import { now } from './clock';
import { hashPassword } from './crypto';
import { groupProtection } from './engine';
import { reconcile } from './reconcile';
import { store } from './store';
import {
  covers,
  createTicket,
  partnerSteps,
  passwordSteps,
  registerExecutor,
  type Step,
  usePartnerCode,
} from './tickets';
import { newSecret, otpauthUri } from './totp';

/** A save that changed nothing, with the errors to show. */
export const emptySaveResult = (errors?: string[]): SaveResult => ({
  applied: [],
  ticket: null,
  pending: null,
  refused: null,
  ...(errors ? { errors } : {}),
});

/** The rules that units change, in the order of the configuration. */
function touchedRules(units: ChangeUnit[], config: Config): Group[] {
  const ids = new Set(units.flatMap((u) => unitGroups(u, config)));
  return config.groups.filter((g) => ids.has(g.id));
}

/** What loosening these rules takes now, all together. */
interface Needs {
  /** Refused: by a Permanent rule, or by a Locked one until the last of the dates. */
  refused: { reason: 'permanent' } | { reason: 'locked'; until: number } | null;
  /** The longest wait, in seconds (0 for none). */
  wait: number;
}

function needs(rules: Group[], t0: number): Needs {
  const all: Protection[] = rules.map((g) => groupProtection(g, t0));
  if (all.some((p) => p.kind === 'permanent')) return { refused: { reason: 'permanent' }, wait: 0 };
  const locked = all.flatMap((p) => (p.kind === 'locked' ? [p.until] : []));
  if (locked.length) return { refused: { reason: 'locked', until: Math.max(...locked) }, wait: 0 };
  return { refused: null, wait: Math.max(0, ...all.map((p) => (p.kind === 'wait' ? p.seconds : 0))) };
}

/** The passwords and the partner codes of the rules that loosening units change. */
function secretSteps(units: ChangeUnit[], config: Config): Step[] {
  const rules = touchedRules(units, config);
  return [...passwordSteps(rules), ...partnerSteps(rules)];
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

interface Route {
  immediate: ChangeUnit[];
  costed: ChangeUnit[];
  /** Units to wait for, by the seconds of their wait. */
  pending: Map<number, ChangeUnit[]>;
  refused: ChangeUnit[];
  /** The most binding reason seen (Permanent before Locked) and, for Locked, the last date. */
  refusedReason: NonNullable<SaveResult['refused']>['reason'] | null;
  refusedUntil: number | null;
  /** The longest wait among the costed units, in seconds (0: a confirmation). */
  costWait: number;
  /** Units that follow the emergency exit instead of the protections of their rules. */
  emergency: ChangeUnit[];
}

/**
 * How the protections of the rules route each unit at this moment. `bulk`: the whole
 * configuration is replaced or merged (a restore, an import, a reset).
 */
function route(units: ChangeUnit[], cur: Config, t0: number, bulk = false): Route {
  const r: Route = {
    immediate: [],
    costed: [],
    pending: new Map(),
    refused: [],
    refusedReason: null,
    refusedUntil: null,
    costWait: 0,
    emergency: [],
  };
  for (const u of units) {
    const rules = classify(u, cur) === 'weaken' ? touchedRules([u], cur) : [];
    if (!rules.length) {
      r.immediate.push(u);
      continue;
    }
    if (bulk || (u.kind === 'setting' && GUARD_SETTINGS.includes(u.path))) {
      r.emergency.push(u);
      continue;
    }
    const n = needs(rules, t0);
    if (n.refused) {
      r.refused.push(u);
      if (n.refused.reason === 'permanent') {
        r.refusedReason = 'permanent';
        r.refusedUntil = null;
      } else if (r.refusedReason !== 'permanent') {
        r.refusedReason = 'locked';
        r.refusedUntil = Math.max(r.refusedUntil ?? 0, n.refused.until);
      }
      continue;
    }
    if (n.wait > WAIT_IN_DIALOG_SECONDS) {
      r.pending.set(n.wait, [...(r.pending.get(n.wait) ?? []), u]);
      continue;
    }
    r.costWait = Math.max(r.costWait, n.wait);
    r.costed.push(u);
  }
  return r;
}

/**
 * The steps that costed units need: the passwords and partner codes of the rules they change,
 * then the longest wait; a confirmation when nothing else is asked.
 */
function costedSteps(costed: ChangeUnit[], cur: Config, costWait: number): Step[] {
  if (!costed.length) return [];
  const secrets = secretSteps(costed, cur);
  if (costWait > 0) return [...secrets, { type: 'wait', seconds: costWait }];
  return secrets.length ? secrets : [{ type: 'confirm' }];
}

/**
 * Proposes a full new configuration. The difference with the current one is split into units
 * that are classified and routed according to the protection of the rules they change. `bulk`:
 * a restore, an import or a reset, whose loosening units follow the emergency exit.
 */
export async function proposeConfig(
  raw: Config,
  reason: string,
  opts: { errors?: string[]; bulk?: boolean } = {},
): Promise<SaveResult> {
  await store.ready();
  const cur = store.config;
  const { config: next } = normalizeConfig(raw, Date.now(), { secretsFrom: cur });
  const units = diffConfig(cur, next);
  const result = emptySaveResult(opts.errors?.length ? opts.errors : undefined);
  if (!units.length) return result;

  const t0 = now();
  const { immediate, costed, pending, refused, refusedReason, refusedUntil, costWait, emergency } = route(
    units,
    cur,
    t0,
    opts.bulk,
  );

  if (immediate.length) {
    await commit(applyUnits(cur, immediate, t0), reason);
    result.applied = immediate;
  }
  if (costed.length) {
    const { view } = await createTicket(
      { kind: 'units', units: costed, reason, base: configChecksum(store.config) },
      costedSteps(costed, cur, costWait),
    );
    result.ticket = view;
    if (!view) result.applied.push(...costed);
  }
  const queue = (units: ChangeUnit[], seconds: number, more: Partial<PendingChange> = {}) => {
    const change: PendingChange = {
      id: crypto.randomUUID(),
      createdAt: t0,
      readyAt: t0 + seconds * 1000,
      expiresAt: t0 + seconds * 1000 + store.config.settings.protection.confirmHours * 3_600_000,
      units,
      ...more,
    };
    store.state.pending.push(change);
    result.pending = change;
  };
  for (const [seconds, units] of pending) queue(units, seconds);
  if (emergency.length) queue(emergency, cur.settings.protection.emergencyHours * 3600, { emergency: true });
  if (pending.size || emergency.length) {
    await store.saveState();
    await reconcile('pending');
  }
  if (refused.length)
    result.refused = { units: refused, reason: refusedReason ?? 'locked', until: refusedUntil };
  return result;
}

registerExecutor('units', async (ticket) => {
  if (ticket.purpose.kind !== 'units') return;
  const live = ticket.purpose.units.filter((u) => !isStale(u, store.config));
  if (configChecksum(store.config) !== ticket.purpose.base) {
    // The configuration changed elsewhere since the cost was shown (another tab, an import, a new
    // password): the units must still cost no more than what was paid, or nothing is applied.
    const again = route(live, store.config, now());
    if (again.pending.size || again.refused.length || again.emergency.length)
      throw new Error('ticket.error.changed');
    if (!covers(ticket.steps, costedSteps(again.costed, store.config, again.costWait)))
      throw new Error('ticket.error.changed');
  }
  return applyApproved(live, ticket.purpose.reason);
});

// ---------------------------------------------------------------------------
// Pending changes
// ---------------------------------------------------------------------------

/** The sentence that confirms a change that followed the emergency exit. */
export function pendingPhrase(): string {
  return t('pending.phrase');
}

/**
 * What confirming a pending change needs now, or why it cannot be confirmed: checked when the
 * confirmation starts and again when its last step is answered. A rule may be firmer since the
 * change was asked: a longer wait counts from the request, and a password, a partner code, Locked
 * and Permanent apply as they are now. A change that followed the emergency exit needs its
 * sentence only, as the emergency exit does.
 */
function pendingRequirements(p: PendingChange): { error: string } | { live: ChangeUnit[]; steps: Step[] } {
  const t0 = now();
  if (t0 < p.readyAt) return { error: 'pending.error.notReady' };
  const live = p.units.filter((u) => !isStale(u, store.config));
  if (!live.length) return { error: 'pending.error.outdated' };
  if (p.emergency) return { live, steps: [{ type: 'phrase', phrase: pendingPhrase() }] };
  const n = needs(touchedRules(live, store.config), t0);
  if (n.refused) return { error: `pending.error.${n.refused.reason}` };
  if (t0 < p.createdAt + n.wait * 1000) return { error: 'pending.error.notReady' };
  return { live, steps: [...secretSteps(live, store.config), { type: 'confirm' }] };
}

export async function confirmPending(id: string): Promise<{ ticket: TicketView | null; error?: string }> {
  await store.ready();
  const p = store.state.pending.find((x) => x.id === id);
  if (!p) return { ticket: null, error: 'pending.error.notFound' };
  const req = pendingRequirements(p);
  if ('error' in req) {
    if (req.error === 'pending.error.outdated') {
      store.state.pending = store.state.pending.filter((x) => x.id !== id);
      await store.saveState();
      await reconcile('pending');
    }
    return { ticket: null, error: req.error };
  }
  const { view } = await createTicket({ kind: 'pending', id }, req.steps);
  return { ticket: view };
}

registerExecutor('pending', async (ticket) => {
  if (ticket.purpose.kind !== 'pending') return;
  const id = ticket.purpose.id;
  const p = store.state.pending.find((x) => x.id === id);
  if (!p) throw new Error('pending.error.notFound');
  // Checked again: a rule may restrict now, a lock window may have started, a password may be new.
  const req = pendingRequirements(p);
  if ('error' in req) throw new Error(req.error);
  if (!covers(ticket.steps, req.steps)) throw new Error('ticket.error.changed');
  store.state.pending = store.state.pending.filter((x) => x.id !== id);
  await store.saveState();
  return applyApproved(req.live, 'pending');
});

/** Cancelling a pending weakening is a strengthening: always immediate. */
export async function cancelPending(id: string) {
  await store.ready();
  store.state.pending = store.state.pending.filter((x) => x.id !== id);
  await store.saveState();
  await reconcile('pending-cancel');
}

// ---------------------------------------------------------------------------
// Passwords and partner codes
// ---------------------------------------------------------------------------

/**
 * The hash of a password for a rule's Password protection. The page puts it in the rule it
 * saves, so choosing a password is classified like any other change of protection.
 */
export async function passwordHash(password: string): Promise<{ hash: string }> {
  return { hash: await hashPassword(password) };
}

const PARTNER_SETUP_KEY = 'partnerSetup';
/** Minutes to scan the code and type the first code before a new secret is needed. */
const PARTNER_SETUP_MINUTES = 15;

interface PartnerSetupState {
  /** The rule the code is for, or the draft of a rule not created yet. */
  groupId: string;
  secret: string;
  expiresAt: number;
}

/**
 * Starts setting up a partner code for a rule (or the draft of one, which `name` names): a new
 * secret, kept in session storage until a code proves that the partner's app has it. The secret is
 * returned once, to be shown to the partner; it is never shown again.
 */
export async function beginPartnerSetup(groupId: string, name = ''): Promise<PartnerSetup> {
  await store.ready();
  const label = store.config.groups.find((x) => x.id === groupId)?.name ?? name;
  const secret = newSecret();
  const expiresAt = now() + PARTNER_SETUP_MINUTES * 60_000;
  await sessionStore.set(PARTNER_SETUP_KEY, { groupId, secret, expiresAt } satisfies PartnerSetupState);
  // The rule's name tells the partner's app which rule a code is for; a label holds no colon.
  const account = label.replace(/:/g, ' ').trim().slice(0, 60) || t('partner.account');
  return { secret, uri: otpauthUri(secret, account, 'WebHandbrake'), expiresAt };
}

/**
 * Completes the setup with the code that the partner's app shows now, which proves that the app
 * has the secret: the Partner code protection to save with the rule, or the error to show. Saving
 * it is classified like any other change of protection: a first one is stricter, another partner a
 * loosening that needs the current partner's code.
 */
export async function verifyPartnerSetup(
  groupId: string,
  code: string,
  breaks: boolean,
): Promise<{ partner: PartnerCode } | { error: string }> {
  await store.ready();
  const setup = await sessionStore.get<PartnerSetupState>(PARTNER_SETUP_KEY);
  if (!setup || setup.groupId !== groupId || setup.expiresAt < now())
    return { error: t('partner.error.expired') };
  if (!(await usePartnerCode(setup.secret, code, now()))) return { error: t('partner.error.code') };
  await sessionStore.remove(PARTNER_SETUP_KEY);
  return { partner: { kind: 'partner', secret: setup.secret, breaks } };
}

// ---------------------------------------------------------------------------
// Emergency exit
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
  // Checked again: the exit may have been cancelled since its sentence was asked, or asked again.
  const e = store.state.emergency;
  if (!e) throw new Error('emergency.error.notRequested');
  if (t0 < e.readyAt) throw new Error('emergency.error.notReady');
  const next: Config = clone(store.config);
  // Every rule asks only for a reminder, which also forgets the passwords and partner codes.
  for (const g of next.groups) g.protection = { kind: 'reminder' };
  store.state.sessions = store.state.sessions.map((s) =>
    s.endAt > t0 ? { ...s, endAt: t0, locked: false } : s,
  );
  store.state.emergency = null;
  store.addTamper({ at: t0, kind: 'emergency', detail: 'completed' });
  await store.saveState();
  await commit(next, 'emergency');
  return true;
});
