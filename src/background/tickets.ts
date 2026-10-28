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
import type { Cost, Group, Intervention } from '../engine/types';
import { api, extensionUrl, features, INTERVENTION_PAGE, quiet, sessionStore } from '../platform/api';
import type { StepView, TicketPurposeKind, TicketView } from '../shared/models';
import { listenEverywhere } from './bridge';
import { now } from './clock';
import { randomInt, randomText, verifyPassword } from './crypto';
import { store } from './store';
import { getTab, getWindow } from './tabs';
import { matchStep } from './totp';

export type Step =
  | { type: 'confirm' }
  | { type: 'wait'; seconds: number }
  | { type: 'text'; length: number }
  | { type: 'phrase'; phrase: string }
  | { type: 'math' }
  /** The password that these rules share. */
  | { type: 'rulePassword'; groups: string[]; names: string[] }
  /** The code that the app of the partner these rules share shows. */
  | { type: 'partner'; groups: string[]; names: string[] }
  /**
   * A reason of at least `minLength` characters is always required; the minutes are one of the
   * choices or any other up to the maximum.
   */
  | { type: 'intention'; choices: number[]; maxMinutes: number; seconds: number; minLength: number };

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
      /** What the rule asked when the page was shown: the access is given only while it still asks it. */
      intervention: Intervention;
      groups: string[];
      severity: number;
      scope: 'page' | 'site' | 'group';
      mode: 'visit' | 'minutes';
      minutes?: number;
      site: string;
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
  /** What the ticket gives, when pages that ask for the same share it (passes). */
  key?: string;
  /** A wait that pauses or starts again when its page is left: the tabs that show it. */
  watch?: Watch;
}

/**
 * Where the wait of a pass is shown, for a rule whose wait pauses or starts again when you switch
 * to another tab. The background follows the tabs itself: a page that stops its own countdown
 * (with the developer tools) does not skip what leaving it adds.
 */
interface Watch {
  onBlur: 'pause' | 'restart';
  /** The tabs whose page shows the ticket. */
  tabs: number[];
  /** Those of them whose page said it is hidden (a window covered, another app on Android). */
  hidden: number[];
  /** Whether a tab showed it: a page opened in the background counts down until it is seen. */
  seen: boolean;
  /** Since when no tab shows it. */
  awayAt?: number;
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
      t.active.text = randomText(step.length);
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
      return { type: 'wait', seconds: step.seconds, readyAt: waitEnd(t, now()) ?? now() };
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
        // A ticket of an earlier version has no shortest reason.
        minLength: step.minLength ?? 1,
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

/**
 * Creates a ticket. With no steps the purpose is executed immediately and null is returned. With a
 * key, a ticket of the same key not yet answered is returned instead: one at a time for the same
 * thing, with its wait, its code and its wrong answers.
 */
export async function createTicket(
  purpose: Purpose,
  steps: Step[],
  key?: string,
): Promise<{ view: TicketView | null; result?: unknown }> {
  await load();
  const same = key && [...tickets.values()].find((x) => x.key === key && x.expiresAt >= now());
  if (same) return { view: ticketView(same) };
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
    key,
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

/**
 * A typed sentence as compared: the same in any case and spacing, with straight or curly quotes
 * and apostrophes (« » with their spaces too), composed or decomposed accents, and with or without
 * the space that some languages put before ! ? : ; (French): keyboards make them hard to type
 * exactly as shown.
 */
export const normalise = (s: string) =>
  s
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u02BC`´]/g, "'")
    .replace(/\u00AB\s*|\s*\u00BB/g, '"')
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/ ([!?:;])/g, '$1')
    .trim()
    .toLowerCase();

export async function answerTicket(
  id: string,
  answer: string | undefined,
  minutes?: number,
): Promise<AnswerResult> {
  const t = await getTicket(id);
  if (!t) return { status: 'error', error: 'ticket.error.expired' };
  // An event of the tabs may still be on its way: where the wait is shown is looked at now.
  if (t.watch && (await serially(() => follow(t)))) await persist();
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
      if (n < (waitEnd(t, n) ?? 0) - 500)
        return { status: 'error', error: 'ticket.error.notYet', ticket: ticketView(t) };
      break;
    case 'text':
      if (a !== t.active.text) return fail('ticket.error.mismatch');
      break;
    case 'phrase':
      if (normalise(a) !== normalise(step.phrase)) return fail('ticket.error.mismatch');
      break;
    case 'math':
      // An empty answer is no number, not 0.
      if (!a.trim() || Number(a.trim()) !== t.active.answer) return fail('ticket.error.wrongAnswer');
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
      if ([...a.trim()].length < (step.minLength ?? 1))
        return { status: 'error', error: 'ticket.error.intentionShort', ticket: ticketView(t) };
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

// ---------------------------------------------------------------------------
// Waits that pause or start again when their page is left
// ---------------------------------------------------------------------------

/**
 * When the wait of a ticket ends. While no tab shows a wait followed, it ends later the longer it
 * is away, or a whole wait after it is shown again.
 */
function waitEnd(t: Ticket, n: number): number | undefined {
  const end = t.active.readyAt;
  const w = t.watch;
  const step = t.steps[t.index];
  if (end === undefined || w?.awayAt === undefined || step?.type !== 'wait') return end;
  return w.onBlur === 'restart' ? n + step.seconds * 1000 : end + (n - w.awayAt);
}

let following: Promise<unknown> = Promise.resolve();

/** Looks at the tabs of the waits one change at a time: each one reads them, then decides. */
function serially<T>(fn: () => Promise<T>): Promise<T> {
  const run = following.then(fn);
  following = run.catch(() => undefined);
  return run;
}

/** What a tab shows of a wait: in view, hidden, or nothing any more (null). */
async function tabShows(id: number, hidden: number[]): Promise<'visible' | 'hidden' | null> {
  const tab = await quiet(getTab(id));
  if (!tab?.url?.startsWith(extensionUrl(INTERVENTION_PAGE))) return null;
  if (!tab.active || hidden.includes(id)) return 'hidden';
  if (!features.windows || tab.windowId === undefined) return 'visible';
  const win = await quiet(getWindow(id, tab.windowId));
  return win?.state === 'minimized' ? 'hidden' : 'visible';
}

/**
 * Looks at where the wait of a ticket is shown, and moves it as the page would: while no tab shows
 * it, it is away; shown again, it ends as much later as it was away, or starts again. Run serially.
 * Returns whether the ticket changed.
 */
async function follow(t: Ticket): Promise<boolean> {
  const w = t.watch;
  if (!w) return false;
  const shows = await Promise.all(w.tabs.map((id) => tabShows(id, w.hidden)));
  const before = JSON.stringify([w, t.active.readyAt]);
  w.tabs = w.tabs.filter((_, i) => shows[i] !== null);
  w.hidden = w.hidden.filter((id) => w.tabs.includes(id));
  const n = now();
  if (shows.includes('visible')) {
    w.seen = true;
    const end = waitEnd(t, n);
    if (w.awayAt !== undefined && end !== undefined) {
      t.active.readyAt = end;
      // The time to answer still comes after the wait.
      t.expiresAt = Math.max(t.expiresAt, end + TICKET_TTL_MS);
    }
    delete w.awayAt;
  } else if (w.seen && w.awayAt === undefined) w.awayAt = n;
  return JSON.stringify([w, t.active.readyAt]) !== before;
}

/**
 * The page of a tab shows this ticket now, or none: a tab shows one page at a time. The wait of a
 * pass that pauses or starts again when its page is left is followed in its tabs from now on.
 * Returns the ticket as it is now: coming back to a wait left moves it.
 */
export async function showTicket(
  tabId: number | undefined,
  view: TicketView | null,
  onBlur: 'pause' | 'restart' | 'ignore',
): Promise<TicketView | null> {
  if (tabId === undefined) return view;
  await load();
  const shown = view ? tickets.get(view.id) : undefined;
  const followed = shown?.steps[shown.index]?.type === 'wait' && onBlur !== 'ignore';
  if (!followed && ![...tickets.values()].some((t) => t.watch?.tabs.includes(tabId))) return view;
  const changed = await serially(async () => {
    let any = false;
    for (const t of [...tickets.values()]) {
      if (t === shown || !t.watch?.tabs.includes(tabId)) continue;
      t.watch.tabs = t.watch.tabs.filter((id) => id !== tabId);
      any = (await follow(t)) || any;
    }
    if (!followed) return any;
    shown.watch ??= { onBlur, tabs: [], hidden: [], seen: false };
    if (!shown.watch.tabs.includes(tabId)) shown.watch.tabs.push(tabId);
    await follow(shown);
    return true;
  });
  if (changed) await persist();
  return shown ? ticketView(shown) : view;
}

/**
 * The page of a ticket says whether it is in view, which the background cannot always see (a
 * window covered by another, another app on Android): it can only make the wait longer. Returns the
 * ticket as it is now, for the page to show.
 */
export async function ticketShown(
  id: string,
  tabId: number | undefined,
  visible: boolean,
): Promise<TicketView | null> {
  const t = await getTicket(id);
  if (!t) return null;
  const w = t.watch;
  if (w && tabId !== undefined && w.tabs.includes(tabId)) {
    await serially(() => {
      w.hidden = w.hidden.filter((x) => x !== tabId);
      if (!visible) w.hidden.push(tabId);
      return follow(t);
    });
    await persist();
  }
  return ticketView(t);
}

/** The tabs changed (another one shown, one closed, a window minimised): the waits look again. */
async function followAll() {
  await load();
  if (![...tickets.values()].some((t) => t.watch)) return;
  const changed = await serially(async () => {
    let any = false;
    for (const t of [...tickets.values()]) any = (await follow(t)) || any;
    return any;
  });
  if (changed) await persist();
}

/** Listens to the changes of the tabs and windows, in the private windows too. */
export function registerWaitListeners() {
  const again = () => void followAll();
  listenEverywhere(api.tabs.onActivated, 'tabs.onActivated', again);
  listenEverywhere(api.tabs.onRemoved, 'tabs.onRemoved', again);
  listenEverywhere(api.tabs.onUpdated, 'tabs.onUpdated', (_id: number, info: { url?: string }) => {
    if (info.url) again();
  });
  listenEverywhere(api.windows?.onFocusChanged, 'windows.onFocusChanged', again);
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

/** Whether a step answered covers a step needed now. */
function satisfies(paid: Step, needed: Step): boolean {
  switch (needed.type) {
    case 'confirm':
      return paid.type === 'confirm' || paid.type === 'wait';
    case 'wait':
      return paid.type === 'wait' && paid.seconds >= needed.seconds;
    case 'text':
      return paid.type === 'text' && paid.length >= needed.length;
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
