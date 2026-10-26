/** Pauses / overrides. */

import { costRank } from '../engine/changes';
import { activeSessions, decide, grantActive } from '../engine/decide';
import { MAX_BREAK_RECORDS } from '../engine/limits';
import { periodRange } from '../engine/time';
import type { Cost, Grant, Group, PausePolicy, Period } from '../engine/types';
import { extensionUrl, INTERVENTION_PAGE } from '../platform/api';
import type { PauseOptions, PauseRequest, TicketView } from '../shared/models';
import { now } from './clock';
import { interventionTabs } from './enforce';
import { ctx } from './engine';
import { reconcile } from './reconcile';
import { store } from './store';
import {
  breakPasswordSteps,
  costSteps,
  createTicket,
  partnerOf,
  partnerSteps,
  registerExecutor,
  type Step,
} from './tickets';

function usedInPeriod(period: Period, groupId: string | null, t: number) {
  const range = periodRange(period, t, store.cc.cal);
  const records = store.state.pauses.filter(
    (p) =>
      p.at >= range.start &&
      p.at <= t &&
      (groupId === null || p.groups === '*' || p.groups.includes(groupId)),
  );
  return {
    count: records.length,
    minutes: records.reduce((a, p) => a + (p.used ?? p.minutes), 0),
  };
}

/** What a limit leaves, with its period; null without a limit. */
type Left = { n: number; period: Period } | null;

function remaining(
  limit: PausePolicy['limit'],
  groupId: string | null,
  t: number,
): { count: Left; minutes: Left } {
  const used = usedInPeriod(limit.period, groupId, t);
  return {
    count:
      limit.count === undefined ? null : { n: Math.max(0, limit.count - used.count), period: limit.period },
    minutes:
      limit.minutes === undefined
        ? null
        : { n: Math.max(0, limit.minutes - used.minutes), period: limit.period },
  };
}

const lower = (a: Left, b: Left): Left => (a === null ? b : b === null || a.n <= b.n ? a : b);

/** Distinct costs of the groups, strictest first: a pause covering several groups pays each one. */
function groupCosts(groups: Group[]): Cost[] {
  const seen = new Set<string>();
  let out: Cost[] = [];
  for (const g of groups) {
    const key = JSON.stringify(g.pause.cost);
    if (g.pause.cost.type === 'none' || seen.has(key)) continue;
    seen.add(key);
    out.push(g.pause.cost);
  }
  // A plain confirmation adds nothing to a real cost.
  if (out.length > 1) out = out.filter((c) => c.type !== 'confirm');
  return out.sort((a, b) => costRank(b) - costRank(a));
}

function unavailable(reason: string, url: string | undefined, incognito: boolean | null): PauseOptions {
  return {
    available: false,
    reason,
    groups: [],
    maxMinutes: 0,
    costs: [],
    remainingCount: null,
    remainingMinutes: null,
    countPeriod: null,
    minutesPeriod: null,
    url: url ?? null,
    incognito,
  };
}

/** Options of a pause covering these groups: the strictest rules of all of them apply. */
function optionsFor(
  groups: Group[],
  url: string | undefined,
  incognito: boolean | null,
  t: number,
): PauseOptions {
  const none = (reason: string) => unavailable(reason, url, incognito);
  // The groups' limits and the global one: the lowest remaining amount applies.
  const limits = [
    ...groups.map((g) => remaining(g.pause.limit, g.id, t)),
    remaining(store.config.settings.pauseLimit, null, t),
  ];
  let count: Left = null;
  let mins: Left = null;
  for (const r of limits) {
    count = lower(count, r.count);
    mins = lower(mins, r.minutes);
  }
  const remCount = count?.n ?? null;
  const remMinutes = mins?.n ?? null;
  if (remCount === 0) return { ...none('pause.unavailable.noneLeft'), remainingCount: 0 };
  if (remMinutes !== null && remMinutes <= 0)
    return { ...none('pause.unavailable.noMinutesLeft'), remainingMinutes: 0 };

  let maxMinutes = Math.min(...groups.map((g) => g.pause.maxMinutes));
  if (remMinutes !== null) maxMinutes = Math.min(maxMinutes, remMinutes);
  return {
    available: true,
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    maxMinutes,
    costs: groupCosts(groups),
    remainingCount: remCount,
    remainingMinutes: remMinutes,
    countPeriod: count?.period ?? null,
    minutesPeriod: mins?.period ?? null,
    url: url ?? null,
    incognito,
  };
}

/**
 * What break the user can take now for a URL, or for a group: a break covers the rules of the page
 * that allow breaks, each one whole.
 */
export function pauseOptions(url?: string, groupId?: string, incognito: boolean | null = null): PauseOptions {
  const c = ctx();
  const none = (reason: string) => unavailable(reason, url, incognito);

  let groups: Group[] = [];
  if (url) {
    const d = decide(c, url, { incognito });
    if (d.session) return none('pause.unavailable.session');
    groups = d.groups.map((r) => r.group);
    const pausable = d.groups.filter((r) => r.pausable);
    if (!groups.length) return none('pause.unavailable.noGroup');
    if (!pausable.length) {
      const inSession = activeSessions(c.state, c.now).some((s) =>
        groups.some((g) => s.groups.includes(g.id)),
      );
      return none(inSession ? 'pause.unavailable.session' : 'pause.unavailable.notAllowed');
    }
    // A break already lets the page through: another one would use up a break for nothing.
    if (pausable.every((r) => r.pause)) return none('pause.unavailable.onBreak');
    groups = pausable.map((r) => r.group);
  } else if (groupId) {
    const g = store.config.groups.find((x) => x.id === groupId);
    if (!g?.pause.allowed) return none('pause.unavailable.notAllowed');
    groups = [g];
  } else {
    return none('pause.unavailable.noGroup');
  }
  return optionsFor(groups, url, incognito, c.now);
}

/**
 * The intervention page that a break of this address lets through, if one is shown: the page that
 * asks for the break, or else a tab showing the page of the address (a break asked in the popup).
 */
function shownPage(
  url: string | undefined,
  sender?: chrome.runtime.MessageSender,
): { tabId: number; groupId: string } | undefined {
  if (!url) return undefined;
  const tabId = sender?.tab?.id;
  if (tabId !== undefined && (sender?.url ?? '').startsWith(extensionUrl(INTERVENTION_PAGE))) {
    const info = interventionTabs.get(tabId);
    if (info?.proceeded) return undefined;
    // After a restart of the background, the page's rule is the one that restricts the address.
    const groupId =
      info?.groupId ??
      decide(ctx(), url, { incognito: Boolean(sender?.tab?.incognito) }).primary?.group.id ??
      'session';
    return { tabId, groupId };
  }
  for (const [id, info] of interventionTabs)
    if (info.url === url && !info.proceeded) return { tabId: id, groupId: info.groupId ?? 'session' };
  return undefined;
}

export async function startPause(
  req: PauseRequest,
  sender?: chrome.runtime.MessageSender,
): Promise<{ ticket: TicketView | null; error?: string }> {
  await store.ready();
  const opts = pauseOptions(req.url, req.groupId, req.incognito ?? null);
  if (!opts.available) return { ticket: null, error: opts.reason ?? 'pause.unavailable.notAllowed' };
  const minutes = req.minutes;
  if (!(minutes > 0) || minutes > opts.maxMinutes) return { ticket: null, error: 'pause.error.duration' };
  const steps: Step[] = [];
  const covered = store.config.groups.filter((g) => opts.groups.some((x) => x.id === g.id));
  for (const cost of opts.costs)
    steps.push(
      ...(cost.type === 'password'
        ? breakPasswordSteps(covered.filter((g) => g.pause.cost.type === 'password'))
        : costSteps(cost)),
    );
  // The codes of the partners of the rules covered, unless a rule's breaks do not need it.
  steps.push(...partnerSteps(covered.filter((g) => partnerOf(g)?.breaks)));
  try {
    const { view } = await createTicket(
      {
        kind: 'pause',
        groups: opts.groups.map((g) => g.id),
        minutes,
        shown: shownPage(req.url, sender),
      },
      steps,
    );
    return { ticket: view };
  } catch (e) {
    // A break without a cost starts at once: another one may have used up what was left.
    return { ticket: null, error: e instanceof Error ? e.message : 'ticket.error.failed' };
  }
}

/**
 * Why a break of these rules for this long cannot start now, if it cannot. The limits are checked
 * again as the break starts, not only when it is asked: breaks asked together, each with its cost
 * still to answer, would otherwise all start.
 */
function refusal(ids: string[], minutes: number, t: number): string | null {
  const groups = store.config.groups.filter((g) => ids.includes(g.id));
  if (groups.length < ids.length || groups.some((g) => !g.pause.allowed))
    return 'pause.unavailable.notAllowed';
  const opts = optionsFor(groups, undefined, null, t);
  if (!opts.available) return opts.reason ?? 'pause.unavailable.notAllowed';
  return minutes > opts.maxMinutes ? 'pause.error.duration' : null;
}

registerExecutor('pause', async (ticket) => {
  if (ticket.purpose.kind !== 'pause') return;
  const p = ticket.purpose;
  const t0 = now();
  const refused = refusal(p.groups, p.minutes, t0);
  if (refused) throw new Error(refused);
  const grant: Grant = {
    id: crypto.randomUUID(),
    kind: 'pause',
    groups: p.groups,
    scope: 'group',
    createdAt: t0,
    until: t0 + p.minutes * 60_000,
    severity: 99,
  };
  store.state.grants.push(grant);
  store.state.pauses.push({
    at: t0,
    groups: p.groups,
    scope: 'group',
    minutes: p.minutes,
    grantId: grant.id,
  });
  store.state.pauses = store.state.pauses.slice(-MAX_BREAK_RECORDS);
  // An intervention page that the break lets through is not an impulse resisted (Insights).
  if (p.shown) {
    const info = interventionTabs.get(p.shown.tabId);
    if (!info?.proceeded) store.usage.count(`pausedIn:${p.shown.groupId}`, t0, store.cc.cal);
    if (info?.offered && !info.proceeded) store.usage.count(`took:${p.shown.groupId}`, t0, store.cc.cal);
    if (info) interventionTabs.set(p.shown.tabId, { ...info, proceeded: true });
  }
  for (const id of p.groups) {
    store.usage.count(`pause:${id}`, t0, store.cc.cal);
    store.usage.count(`pauseMin:${id}`, t0, store.cc.cal, p.minutes);
  }
  store.scheduleUsage();
  await store.saveState();
  await reconcile('pause');
  return { grantId: grant.id };
});

/** Ending a pause early is a strengthening, always immediate. */
export async function cancelPause(grantId?: string, all = false) {
  await store.ready();
  const t0 = now();
  const c = ctx(t0);
  for (const g of store.state.grants) {
    if (g.kind !== 'pause') continue;
    if (!all && g.id !== grantId) continue;
    if (!grantActive(c, g)) continue;
    const rec = store.state.pauses.find((p) => p.grantId === g.id);
    if (rec) rec.used = Math.round((t0 - g.createdAt) / 60_000);
  }
  store.state.grants = store.state.grants.filter((g) => !(g.kind === 'pause' && (all || g.id === grantId)));
  await store.saveState();
  await reconcile('pause-cancel');
}

export function activePauses(): Grant[] {
  const c = ctx();
  return store.state.grants.filter((g) => g.kind === 'pause' && grantActive(c, g));
}
