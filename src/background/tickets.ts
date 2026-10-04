/**
 * Tickets: multi-step costs verified in the background (PRO-05, PRO-14, BRK-05, INT-02…04).
 * The UI only presents steps; waits are timed and answers are checked here, so editing the
 * DOM of an extension page cannot skip a cost.
 */

import type { ChangeUnit } from '../engine/changes';
import type { Charset, Cost, PauseScope } from '../engine/types';
import { sessionStore } from '../platform/api';
import type { StepView, TicketPurposeKind, TicketView } from '../shared/models';
import { now } from './clock';
import { randomInt, randomText, verifyPassword } from './crypto';
import { store } from './store';

export type Step =
  | { type: 'confirm' }
  | { type: 'wait'; seconds: number }
  | { type: 'text'; length: number; charset?: Charset }
  | { type: 'phrase'; phrase: string }
  | { type: 'math' }
  | { type: 'password' }
  | { type: 'reason'; required: boolean }
  | { type: 'intention'; choices: number[]; maxMinutes: number; requireIntention: boolean; seconds: number };

export type Purpose =
  | { kind: 'units'; units: ChangeUnit[]; reason: string }
  | { kind: 'pending'; id: string }
  | {
      kind: 'pause';
      groups: string[] | '*';
      scope: PauseScope;
      minutes: number;
      url?: string;
      site?: string;
      metered: boolean;
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
  | { kind: 'emergency.complete' }
  | { kind: 'password' };

export interface Ticket {
  id: string;
  purpose: Purpose;
  steps: Step[];
  index: number;
  createdAt: number;
  expiresAt: number;
  /** Secret data of the active step. */
  active: { readyAt?: number; text?: string; answer?: number; question?: string };
  collected: { reason?: string; intention?: string; minutes?: number };
  failures: number;
  lockedUntil?: number;
}

type Executor = (t: Ticket) => Promise<unknown>;

const executors = new Map<Purpose['kind'], Executor>();
const tickets = new Map<string, Ticket>();
let loaded = false;

const TICKET_TTL = 60 * 60_000;
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
      t.active.readyAt = n + step.seconds * 1000;
      break;
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
        requireIntention: step.requireIntention,
        seconds: step.seconds,
        readyAt: t.active.readyAt ?? now(),
      };
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
  const t: Ticket = {
    id: crypto.randomUUID(),
    purpose,
    steps,
    index: 0,
    createdAt: now(),
    expiresAt: now() + TICKET_TTL,
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
    if (t.failures >= 5) {
      t.lockedUntil = n + 30_000;
      t.failures = 0;
    }
    await persist();
    return { status: 'error' as const, error, ticket: ticketView(t) };
  };
  const a = answer ?? '';
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
    case 'password': {
      const hash = store.config.settings.protection.access.passwordHash;
      if (hash && !(await verifyPassword(a, hash))) return fail('ticket.error.wrongPassword');
      break;
    }
    case 'reason':
      if (step.required && !a.trim())
        return { status: 'error', error: 'ticket.error.reasonRequired', ticket: ticketView(t) };
      t.collected.reason = a.trim().slice(0, 500) || undefined;
      break;
    case 'intention': {
      if (n < (t.active.readyAt ?? 0) - 500)
        return { status: 'error', error: 'ticket.error.notYet', ticket: ticketView(t) };
      if (step.requireIntention && !a.trim())
        return { status: 'error', error: 'ticket.error.intentionRequired', ticket: ticketView(t) };
      const m = Number(minutes);
      if (!Number.isFinite(m) || m <= 0 || m > step.maxMinutes)
        return { status: 'error', error: 'ticket.error.minutes', ticket: ticketView(t) };
      t.collected.intention = a.trim().slice(0, 300) || undefined;
      t.collected.minutes = m;
      break;
    }
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
 * A11Y-05: the canvas code is replaced by a longer commitment phrase that screen readers can read.
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

/** Steps for a cost (BRK-05). */
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
      return store.config.settings.protection.access.passwordHash
        ? [{ type: 'password' }]
        : [{ type: 'text', length: 32 }];
  }
}

/** Steps required by the settings access requirements (PRO-05). */
export function accessSteps(): Step[] {
  const a = store.config.settings.protection.access;
  const steps: Step[] = [];
  if (a.passwordHash) steps.push({ type: 'password' });
  if (a.codeLength > 0) steps.push({ type: 'text', length: a.codeLength });
  return steps;
}
