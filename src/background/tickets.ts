/**
 * Tickets: multi-step costs verified in the background.
 * The UI only presents steps; waits are timed and answers are checked here, so editing the
 * DOM of an extension page cannot skip a cost.
 */

import type { ChangeUnit } from '../engine/changes';
import {
  SECRET_LOCK_MS,
  SECRET_MAX_FAILURES,
  TICKET_LOCK_MS,
  TICKET_MAX_FAILURES,
  TICKET_TTL_MS,
} from '../engine/limits';
import type { Charset, Cost, Group } from '../engine/types';
import { sessionStore } from '../platform/api';
import type { StepView, TicketPurposeKind, TicketView } from '../shared/models';
import { now } from './clock';
import { randomInt, randomText, verifyPassword } from './crypto';
import { store } from './store';
import { matchStep } from './totp';

export type Step =
  | { type: 'confirm' }
  | { type: 'wait'; seconds: number }
  | { type: 'text'; length: number; charset?: Charset }
  | { type: 'phrase'; phrase: string }
  | { type: 'math' }
  /** The password that these rules share. */
  | { type: 'rulePassword'; groups: string[]; names: string[] }
  /** The code that the app of the partner these rules share shows. */
  | { type: 'partner'; groups: string[]; names: string[] }
  /** A reason is always required; the minutes are one of the choices or any other up to the maximum. */
  | { type: 'intention'; choices: number[]; maxMinutes: number; seconds: number };

export type Purpose =
  /** `base`: the checksum of the configuration when the cost was shown. */
  | { kind: 'units'; units: ChangeUnit[]; reason: string; base?: string }
  | { kind: 'pending'; id: string }
  | {
      kind: 'pause';
      /** The rules the break covers, whole. */
      groups: string[];
      minutes: number;
      /** The intervention page that the break lets through, if one is shown (statistics). */
      shown?: { tabId: number; groupId: string };
    }
  | {
      kind: 'pass';
      url: string;
      groups: string[];
      severity: number;
      scope: 'page' | 'site' | 'group';
      mode: 'visit' | 'minutes';
      minutes?: number;
      site: string;
      cooldownMinutes?: number;
      incognito: boolean;
    }
  | { kind: 'session.end'; id: string }
  | { kind: 'emergency.complete' };

export interface Ticket {
  id: string;
  purpose: Purpose;
  steps: Step[];
  index: number;
  createdAt: number;
  expiresAt: number;
  /** Secret data of the active step. */
  active: { readyAt?: number; text?: string; answer?: number; question?: string };
  collected: { intention?: string; minutes?: number };
  failures: number;
  lockedUntil?: number;
}

type Executor = (t: Ticket) => Promise<unknown>;

const executors = new Map<Purpose['kind'], Executor>();
const tickets = new Map<string, Ticket>();
let loaded = false;

const STORE_KEY = 'tickets';

export function registerExecutor(kind: Purpose['kind'], fn: Executor) {
  executors.set(kind, fn);
}

async function load() {
  if (loaded) return;
  loaded = true;
  const saved = await sessionStore.get<Ticket[]>(STORE_KEY);
  for (const t of saved ?? []) tickets.set(t.id, t);
}

async function persist() {
  const t = now();
  for (const [id, x] of tickets) if (x.expiresAt < t) tickets.delete(id);
  await sessionStore.set(STORE_KEY, [...tickets.values()]);
}

const MATH_OPS = ['+', '-', '×'] as const;

function activate(t: Ticket) {
  const step = t.steps[t.index];
  t.active = {};
  if (!step) return;
  const n = now();
  switch (step.type) {
    case 'wait':
    case 'intention':
      t.active.readyAt = n + step.seconds * 1000;
      break;
    case 'text':
      t.active.text = randomText(step.length, step.charset ?? 'alnum');
      break;
    case 'math': {
      const op = MATH_OPS[randomInt(0, 2)];
      const a = randomInt(12, 99);
      const b = randomInt(3, op === '×' ? 9 : 49);
      t.active.answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
      t.active.question = `${a} ${op} ${b}`;
      break;
    }
  }
}

function stepView(t: Ticket): StepView {
  const step = t.steps[t.index];
  switch (step.type) {
    case 'wait':
      return { type: 'wait', seconds: step.seconds, readyAt: t.active.readyAt ?? now() };
    case 'text':
      return { type: 'text', text: t.active.text ?? '', length: step.length };
    case 'math':
      return { type: 'math', question: t.active.question ?? '' };
    case 'intention':
      return {
        type: 'intention',
        choices: step.choices,
        maxMinutes: step.maxMinutes,
        seconds: step.seconds,
        readyAt: t.active.readyAt ?? now(),
      };
    case 'rulePassword':
    case 'partner':
      return { type: step.type, names: step.names };
    default:
      return step;
  }
}

export function ticketView(t: Ticket): TicketView {
  const kind: TicketPurposeKind = t.purpose.kind;
  return {
    id: t.id,
    purpose: kind,
    step: stepView(t),
    stepIndex: t.index,
    stepCount: t.steps.length,
    units: t.purpose.kind === 'units' ? t.purpose.units : undefined,
  };
}

/** Creates a ticket. With no steps the purpose is executed immediately and null is returned. */
export async function createTicket(
  purpose: Purpose,
  steps: Step[],
): Promise<{ view: TicketView | null; result?: unknown }> {
  await load();
  if (!steps.length) {
    const exec = executors.get(purpose.kind);
    const result = exec
      ? await exec({
          id: '',
          purpose,
          steps,
          index: 0,
          createdAt: now(),
          expiresAt: now(),
          active: {},
          collected: {},
          failures: 0,
        })
      : undefined;
    return { view: null, result };
  }
  // The time to answer comes after the waits: a wait of an hour or more can still be completed.
  const waits = steps.reduce(
    (ms, s) => ms + (s.type === 'wait' || s.type === 'intention' ? s.seconds * 1000 : 0),
    0,
  );
  const t: Ticket = {
    id: crypto.randomUUID(),
    purpose,
    steps,
    index: 0,
    createdAt: now(),
    expiresAt: now() + waits + TICKET_TTL_MS,
    active: {},
    collected: {},
    failures: 0,
  };
  activate(t);
  tickets.set(t.id, t);
  await persist();
  return { view: ticketView(t) };
}

export async function getTicket(id: string): Promise<Ticket | undefined> {
  await load();
  const t = tickets.get(id);
  if (t && t.expiresAt < now()) {
    tickets.delete(id);
    return undefined;
  }
  return t;
}

export async function cancelTicket(id: string) {
  await load();
  tickets.delete(id);
  await persist();
}

export type AnswerResult =
  | { status: 'next'; ticket: TicketView }
  | { status: 'done'; result?: unknown }
  | { status: 'error'; error: string; ticket?: TicketView };

const normalise = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export async function answerTicket(
  id: string,
  answer: string | undefined,
  minutes?: number,
): Promise<AnswerResult> {
  const t = await getTicket(id);
  if (!t) return { status: 'error', error: 'ticket.error.expired' };
  const n = now();
  if (t.lockedUntil && n < t.lockedUntil)
    return { status: 'error', error: 'ticket.error.tooMany', ticket: ticketView(t) };
  const step = t.steps[t.index];
  const fail = async (error: string) => {
    t.failures++;
    if (t.failures >= TICKET_MAX_FAILURES) {
      t.lockedUntil = n + TICKET_LOCK_MS;
      t.failures = 0;
    }
    await persist();
    return { status: 'error' as const, error, ticket: ticketView(t) };
  };
  const a = answer ?? '';
  // Passwords and partner codes share one count of wrong answers across every ticket.
  const secret = step.type === 'rulePassword' || step.type === 'partner';
  const guesses = store.state.secretFailures;
  if (secret && n < (guesses.lockedUntil ?? 0))
    return { status: 'error', error: 'ticket.error.tooManySecrets', ticket: ticketView(t) };
  const failSecret = async (error: string) => {
    const count = (guesses.count ?? 0) + 1;
    store.state.secretFailures =
      count >= SECRET_MAX_FAILURES
        ? { count: 0, lockedUntil: n + SECRET_LOCK_MS }
        : { count, lockedUntil: 0 };
    await store.saveState();
    return fail(error);
  };
  switch (step.type) {
    case 'confirm':
      break;
    case 'wait':
      if (n < (t.active.readyAt ?? 0) - 500)
        return { status: 'error', error: 'ticket.error.notYet', ticket: ticketView(t) };
      break;
    case 'text':
      if (a !== t.active.text) return fail('ticket.error.mismatch');
      break;
    case 'phrase':
      if (normalise(a) !== normalise(step.phrase)) return fail('ticket.error.mismatch');
      break;
    case 'math':
      if (Number(a.trim()) !== t.active.answer) return fail('ticket.error.wrongAnswer');
      break;
    case 'rulePassword': {
      const hash = sharedSecret(step.groups, passwordOf);
      if (hash && !(await verifyPassword(a, hash))) return failSecret('ticket.error.wrongPassword');
      break;
    }
    case 'partner': {
      const partner = sharedSecret(step.groups, partnerOf);
      if (partner && !(await usePartnerCode(partner.secret, a, n)))
        return failSecret('ticket.error.partnerCode');
      break;
    }
    case 'intention': {
      if (n < (t.active.readyAt ?? 0) - 500)
        return { status: 'error', error: 'ticket.error.notYet', ticket: ticketView(t) };
      if (!a.trim())
        return { status: 'error', error: 'ticket.error.intentionRequired', ticket: ticketView(t) };
      const m = Number(minutes);
      if (!Number.isFinite(m) || m <= 0 || m > step.maxMinutes)
        return { status: 'error', error: 'ticket.error.minutes', ticket: ticketView(t) };
      t.collected.intention = a.trim().slice(0, 300);
      t.collected.minutes = m;
      break;
    }
  }
  if (secret && guesses.count) {
    store.state.secretFailures = { count: 0, lockedUntil: 0 };
    await store.saveState();
  }
  t.index++;
  t.failures = 0;
  if (t.index < t.steps.length) {
    activate(t);
    await persist();
    return { status: 'next', ticket: ticketView(t) };
  }
  tickets.delete(t.id);
  await persist();
  const exec = executors.get(t.purpose.kind);
  try {
    const result = exec ? await exec(t) : undefined;
    return { status: 'done', result };
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : 'ticket.error.failed' };
  }
}

/**
 * The canvas code is replaced by a longer commitment phrase that screen readers can read.
 * The cost stays (typing is still required) but no longer depends on sight.
 */
export async function accessibleAlternative(id: string, phrase: string): Promise<TicketView | null> {
  const t = await getTicket(id);
  if (!t) return null;
  const step = t.steps[t.index];
  if (step.type !== 'text') return ticketView(t);
  t.steps[t.index] = { type: 'phrase', phrase };
  activate(t);
  await persist();
  return ticketView(t);
}

/** The key under which the last accepted step of a partner secret is kept. */
const partnerKey = (secret: string) => secret.slice(0, 16);

/**
 * Checks a partner code and spends it. A code is accepted once: its time step must come
 * after the last one accepted for the same secret, as RFC 6238 recommends.
 */
export async function usePartnerCode(secret: string, code: string, at: number): Promise<boolean> {
  const step = await matchStep(secret, code, at);
  const key = partnerKey(secret);
  if (step === null || step <= (store.state.partnerSteps[key] ?? -1)) return false;
  // A few secrets are kept: replacing a partner spends codes of the old and of the new one.
  const others = Object.entries(store.state.partnerSteps).filter(([k]) => k !== key);
  store.state.partnerSteps = Object.fromEntries([...others.slice(-3), [key, step]]);
  await store.saveState();
  return true;
}

/** The password hash of a rule protected by a password. */
const passwordOf = (g: Group) => (g.protection.kind === 'password' ? g.protection.hash : undefined);
/** The partner code of a rule protected by one. */
export const partnerOf = (g: Group) => (g.protection.kind === 'partner' ? g.protection : undefined);

/** Rules grouped by a secret they share: one step asks it for all of them. */
function bySecret(groups: Group[], secret: (g: Group) => string | undefined) {
  const out = new Map<string, { groups: string[]; names: string[] }>();
  for (const g of groups) {
    const key = secret(g);
    if (!key) continue;
    const shared = out.get(key);
    if (shared) {
      shared.groups.push(g.id);
      shared.names.push(g.name);
    } else out.set(key, { groups: [g.id], names: [g.name] });
  }
  return [...out.values()];
}

/** The secret a step checks: that of the first of its rules that still has one. */
function sharedSecret<T>(ids: string[], secret: (g: Group) => T | undefined): T | undefined {
  for (const id of ids) {
    const g = store.config.groups.find((x) => x.id === id);
    const value = g && secret(g);
    if (value) return value;
  }
  return undefined;
}

/** The passwords of these rules, each asked once. */
export function passwordSteps(groups: Group[]): Step[] {
  return bySecret(groups, passwordOf).map((x) => ({ type: 'rulePassword' as const, ...x }));
}

/** The codes of the partners of these rules, each asked once. */
export function partnerSteps(groups: Group[]): Step[] {
  return bySecret(groups, (g) => partnerOf(g)?.secret).map((x) => ({ type: 'partner' as const, ...x }));
}

/**
 * The password cost of a break of these rules: the password of each rule, or a
 * long code for a rule that has none.
 */
export function breakPasswordSteps(groups: Group[]): Step[] {
  const steps = passwordSteps(groups);
  if (groups.some((g) => !passwordOf(g))) steps.push(...costSteps({ type: 'password' }));
  return steps;
}

/** Whether a step answered covers a step needed now (the accessible phrase replaces a code). */
function satisfies(paid: Step, needed: Step): boolean {
  switch (needed.type) {
    case 'confirm':
      return paid.type === 'confirm' || paid.type === 'wait';
    case 'wait':
      return paid.type === 'wait' && paid.seconds >= needed.seconds;
    case 'text':
      return (paid.type === 'text' && paid.length >= needed.length) || paid.type === 'phrase';
    case 'rulePassword':
    case 'partner':
      // The secret was asked for every rule that needs it now, as one of the rules sharing it.
      return paid.type === needed.type && needed.groups.every((id) => paid.groups.includes(id));
    default:
      return paid.type === needed.type;
  }
}

/**
 * Whether the steps of a ticket cover what its purpose needs at the moment it runs. Each
 * step answered covers one step needed; the longest codes are matched first.
 */
export function covers(paid: Step[], needed: Step[]): boolean {
  const pool = [...paid];
  const length = (s: Step) => (s.type === 'text' ? s.length : 0);
  return [...needed]
    .sort((a, b) => length(b) - length(a))
    .every((n) => {
      const i = pool.findIndex((p) => satisfies(p, n));
      if (i === -1) return false;
      pool.splice(i, 1);
      return true;
    });
}

/** Steps for a cost. */
export function costSteps(cost: Cost): Step[] {
  switch (cost.type) {
    case 'none':
      return [];
    case 'confirm':
      return [{ type: 'confirm' }];
    case 'delay':
      return [{ type: 'wait', seconds: cost.seconds }];
    case 'challenge':
      if (cost.kind === 'phrase' && cost.phrase) return [{ type: 'phrase', phrase: cost.phrase }];
      if (cost.kind === 'math') return [{ type: 'math' }];
      return [{ type: 'text', length: cost.length ?? 24 }];
    case 'password':
      // A password without a rule to take it from: a long code instead.
      return [{ type: 'text', length: 32 }];
  }
}
