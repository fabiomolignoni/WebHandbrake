/** Pauses / overrides. */

import { costRank } from '../engine/changes';
import { isGroupActive } from '../engine/compile';
import { activeSessions, decide, grantActive } from '../engine/decide';
import { MAX_BREAK_RECORDS, MAX_REASON_CHARS } from '../engine/limits';
import { periodRange } from '../engine/time';
import type { Cost, Grant, Group, PausePolicy, Period } from '../engine/types';
import { pageKey } from '../engine/url';
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
    scopes: [],
    duration: { mode: 'fixed', minutes: 0 },
    costs: [],
    reasonMode: 'none',
    remainingCount: null,
    remainingMinutes: null,
    countPeriod: null,
    minutesPeriod: null,
    metered: false,
    site: null,
    url: url ?? null,
    incognito,
  };
}

/** Minutes a break was started or extended for. */
function grantMinutes(g: Grant): number {
  return g.minutes ?? Math.round(((g.until ?? g.createdAt) - g.createdAt) / 60_000);
}

/**
 * Options of a pause covering these groups: the strictest rules of all of them apply. With
 * `running`, the options of extending that break instead: it is still one break, so no break is
 * counted and no reason asked again, but it costs the same and lasts at most as long as a break can.
 */
function optionsFor(
  groups: Group[],
  url: string | undefined,
  site: string | null,
  incognito: boolean | null,
  t: number,
  running?: Grant,
): PauseOptions {
  const extend = running && {
    grantId: running.id,
    scope: running.scope,
    minutes: grantMinutes(running),
  };
  const none = (reason: string) => ({ ...unavailable(reason, url, incognito), extend });
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
  // Extending a break does not take another one.
  const remCount = running ? null : (count?.n ?? null);
  const remMinutes = mins?.n ?? null;
  if (remCount === 0) return { ...none('pause.unavailable.noneLeft'), remainingCount: 0 };
  if (remMinutes !== null && remMinutes <= 0)
    return { ...none('pause.unavailable.noMinutesLeft'), remainingMinutes: 0 };

  const main = groups[0];
  const scopes = running
    ? [running.scope]
    : main.pause.scopes.filter(
        (s) =>
          groups.every((g) => g.pause.scopes.includes(s)) && (s !== 'page' || url) && (s !== 'site' || site),
      );
  const duration = { ...main.pause.duration };
  for (const g of groups) duration.minutes = Math.min(duration.minutes, g.pause.duration.minutes);
  if (running) {
    duration.minutes -= grantMinutes(running);
    if (duration.minutes <= 0) return none('pause.unavailable.longest');
  }
  if (remMinutes !== null) duration.minutes = Math.min(duration.minutes, remMinutes);
  if (duration.choices) duration.choices = duration.choices.filter((m) => m <= duration.minutes);
  // No choice is short enough for what is left: what is left is the only length.
  if (duration.mode === 'choices' && !duration.choices?.length) {
    duration.mode = 'fixed';
    delete duration.choices;
  }
  return {
    available: scopes.length > 0,
    reason: scopes.length ? undefined : 'pause.unavailable.notAllowed',
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    scopes,
    duration,
    costs: groupCosts(groups),
    reasonMode: running
      ? 'none'
      : groups.some((g) => g.pause.reason === 'required')
        ? 'required'
        : groups.some((g) => g.pause.reason === 'optional')
          ? 'optional'
          : 'none',
    remainingCount: remCount,
    remainingMinutes: remMinutes,
    countPeriod: running ? null : (count?.period ?? null),
    minutesPeriod: mins?.period ?? null,
    metered: groups.some((g) => g.pause.metered),
    site,
    url: url ?? null,
    incognito,
    extend,
  };
}

/** Groups a pause of everything covers. */
function pausableGroups(): Group[] {
  return store.config.groups.filter((g) => isGroupActive(g) && g.pause.allowed);
}

/** Options of extending a running break, following the rules of the groups it covers. */
function extendOptions(grant: Grant, url: string | undefined, incognito: boolean | null, t: number) {
  const groups =
    grant.groups === '*'
      ? pausableGroups()
      : store.config.groups.filter((g) => grant.groups.includes(g.id) && isGroupActive(g) && g.pause.allowed);
  if (!groups.length)
    return {
      ...unavailable('pause.unavailable.notAllowed', url, incognito),
      extend: { grantId: grant.id, scope: grant.scope, minutes: grantMinutes(grant) },
    };
  return optionsFor(groups, url, grant.site ?? null, incognito, t, grant);
}

/** A running break of a group or all groups, by id. */
function runningPause(grantId: string, t: number): Grant | undefined {
  const g = store.state.grants.find((x) => x.id === grantId && x.kind === 'pause');
  return g && grantActive(ctx(t), g) ? g : undefined;
}

/**
 * What pause the user can take now for a URL or a group. A pause of everything also covers groups
 * that are not on the page: its options (`all`) take the rules of every group into account.
 */
export function pauseOptions(url?: string, groupId?: string, incognito: boolean | null = null): PauseOptions {
  const c = ctx();
  const none = (reason: string) => unavailable(reason, url, incognito);

  let groups: Group[] = [];
  let site: string | null = null;
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
    // A break already lets the page through: it can be extended, not taken again.
    if (pausable.every((r) => r.pause)) return extendOptions(pausable[0].pause!, url, incognito, c.now);
    groups = pausable.map((r) => r.group);
    site = pausable[0].site;
  } else if (groupId) {
    const g = store.config.groups.find((x) => x.id === groupId);
    if (!g?.pause.allowed) return none('pause.unavailable.notAllowed');
    groups = [g];
  } else {
    groups = pausableGroups();
    if (!groups.length) return none('pause.unavailable.notAllowed');
    return optionsFor(groups, url, site, incognito, c.now);
  }

  const opts = optionsFor(groups, url, site, incognito, c.now);
  if (opts.scopes.includes('all')) {
    const all = optionsFor(pausableGroups(), undefined, null, incognito, c.now);
    if (all.available && all.scopes.includes('all')) opts.all = { ...all, scopes: ['all'] };
    else opts.scopes = opts.scopes.filter((s) => s !== 'all');
    // Only "all" was possible: tell why it is not (e.g. another group has no pauses left).
    if (!opts.scopes.length)
      return all.available ? none('pause.unavailable.notAllowed') : { ...all, url: url ?? null };
  }
  return opts;
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
  let opts: PauseOptions;
  let running: Grant | undefined;
  if (req.extend) {
    running = runningPause(req.extend, now());
    if (!running) return { ticket: null, error: 'pause.error.ended' };
    opts = extendOptions(running, req.url, req.incognito ?? null, now());
  } else {
    const page = pauseOptions(req.url, req.groupId, req.incognito ?? null);
    // A pause of everything follows the rules of every group it covers.
    opts = req.scope === 'all' && page.all ? page.all : page;
  }
  if (!opts.available) return { ticket: null, error: opts.reason ?? 'pause.unavailable.notAllowed' };
  if (!opts.scopes.includes(req.scope)) return { ticket: null, error: 'pause.error.scope' };
  const max = opts.duration.minutes;
  let minutes = req.minutes;
  if (opts.duration.mode === 'fixed') minutes = max;
  if (!(minutes > 0) || minutes > max) return { ticket: null, error: 'pause.error.duration' };
  const steps: Step[] = [];
  if (opts.reasonMode !== 'none') steps.push({ type: 'reason', required: opts.reasonMode === 'required' });
  const covered = store.config.groups.filter((g) => opts.groups.some((x) => x.id === g.id));
  for (const cost of opts.costs)
    steps.push(
      ...(cost.type === 'password'
        ? breakPasswordSteps(covered.filter((g) => g.pause.cost.type === 'password'))
        : costSteps(cost)),
    );
  // The codes of the partners of the rules covered, unless a rule's breaks do not need it.
  steps.push(...partnerSteps(covered.filter((g) => partnerOf(g)?.breaks)));
  const groups = running ? running.groups : req.scope === 'all' ? '*' : opts.groups.map((g) => g.id);
  const purpose = {
    kind: 'pause' as const,
    groups: groups as string[] | '*',
    scope: req.scope,
    minutes,
    url: running ? running.url : req.url ? pageKey(req.url) : undefined,
    site: running ? running.site : (opts.site ?? undefined),
    metered: running ? running.remaining !== undefined : opts.metered,
    // Extending lets no intervention page through: the break already did.
    shown: running ? undefined : shownPage(req.url, sender),
    extend: running?.id,
  };
  // A reason typed in the dialog before starting counts as the reason step.
  let reason: string | undefined;
  if (req.reason !== undefined && steps[0]?.type === 'reason') {
    if (steps[0].required && !req.reason.trim())
      return { ticket: null, error: 'ticket.error.reasonRequired' };
    steps.shift();
    reason = req.reason.trim().slice(0, MAX_REASON_CHARS) || undefined;
  }
  const { view } = await createTicket(purpose, steps, { reason });
  return { ticket: view };
}

/** Adds minutes to a running break; the cost has been paid, the limits are checked again. */
async function extendPause(grantId: string, requested: number) {
  const t0 = now();
  const grant = runningPause(grantId, t0);
  if (!grant) throw new Error('pause.error.ended');
  const opts = extendOptions(grant, undefined, null, t0);
  if (!opts.available) throw new Error(opts.reason ?? 'pause.unavailable.notAllowed');
  const minutes = Math.min(requested, opts.duration.minutes);
  if (grant.remaining !== undefined) grant.remaining += minutes * 60;
  else grant.until = (grant.until ?? t0) + minutes * 60_000;
  grant.minutes = grantMinutes(grant) + minutes;
  const rec = store.state.pauses.find((r) => r.grantId === grant.id);
  if (rec) rec.minutes += minutes;
  const ids = grant.groups === '*' ? store.config.groups.map((g) => g.id) : grant.groups;
  for (const id of ids) store.usage.count(`pauseMin:${id}`, t0, store.cc.cal, minutes);
  store.scheduleUsage();
  await store.saveState();
  await reconcile('pause');
  return { grantId: grant.id };
}

registerExecutor('pause', async (ticket) => {
  if (ticket.purpose.kind !== 'pause') return;
  const p = ticket.purpose;
  if (p.extend) return extendPause(p.extend, p.minutes);
  const t0 = now();
  const reason = ticket.collected.reason;
  const grant: Grant = {
    id: crypto.randomUUID(),
    kind: 'pause',
    groups: p.groups,
    scope: p.scope,
    url: p.scope === 'page' ? p.url : undefined,
    site: p.scope === 'site' ? p.site : undefined,
    createdAt: t0,
    severity: 99,
    reason,
    minutes: p.minutes,
  };
  if (p.metered) grant.remaining = p.minutes * 60;
  else grant.until = t0 + p.minutes * 60_000;
  store.state.grants.push(grant);
  store.state.pauses.push({
    at: t0,
    groups: p.groups,
    scope: p.scope,
    minutes: p.minutes,
    reason,
    grantId: grant.id,
    site: grant.site,
    url: grant.url,
  });
  store.state.pauses = store.state.pauses.slice(-MAX_BREAK_RECORDS);
  // An intervention page that the break lets through is not an impulse resisted (Insights).
  if (p.shown) {
    const info = interventionTabs.get(p.shown.tabId);
    if (!info?.proceeded) store.usage.count(`pausedIn:${p.shown.groupId}`, t0, store.cc.cal);
    if (info) interventionTabs.set(p.shown.tabId, { ...info, proceeded: true });
  }
  const ids = p.groups === '*' ? store.config.groups.map((g) => g.id) : p.groups;
  for (const id of ids) {
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
    if (rec)
      rec.used =
        g.remaining !== undefined
          ? Math.round((rec.minutes * 60 - g.remaining) / 60)
          : Math.round((t0 - g.createdAt) / 60_000);
  }
  store.state.grants = store.state.grants.filter((g) => !(g.kind === 'pause' && (all || g.id === grantId)));
  await store.saveState();
  await reconcile('pause-cancel');
}

export function activePauses(): Grant[] {
  const c = ctx();
  return store.state.grants.filter((g) => g.kind === 'pause' && grantActive(c, g));
}
