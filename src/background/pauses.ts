/** Pauses / overrides (BRK-01…BRK-10). */

import { costRank } from '../engine/changes';
import { activeSessions, decide, grantActive } from '../engine/decide';
import { periodRange } from '../engine/time';
import type { Cost, Grant, Group, PausePolicy, Period } from '../engine/types';
import { pageKey } from '../engine/url';
import type { PauseOptions, PauseRequest, TicketView } from '../shared/models';
import { now } from './clock';
import { ctx } from './engine';
import { reconcile } from './reconcile';
import { store } from './store';
import { costSteps, createTicket, registerExecutor, type Step } from './tickets';

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

function remaining(limit: PausePolicy['limit'], groupId: string | null, t: number) {
  const used = usedInPeriod(limit.period, groupId, t);
  return {
    count: limit.count === undefined ? null : Math.max(0, limit.count - used.count),
    minutes: limit.minutes === undefined ? null : Math.max(0, limit.minutes - used.minutes),
  };
}

const minNull = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

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
    metered: false,
    site: null,
    url: url ?? null,
    incognito,
  };
}

/** Options of a pause covering these groups: the strictest rules of all of them apply. */
function optionsFor(
  groups: Group[],
  url: string | undefined,
  site: string | null,
  incognito: boolean | null,
  t: number,
): PauseOptions {
  const none = (reason: string) => unavailable(reason, url, incognito);
  let remCount: number | null = null;
  let remMinutes: number | null = null;
  for (const g of groups) {
    const r = remaining(g.pause.limit, g.id, t);
    remCount = minNull(remCount, r.count);
    remMinutes = minNull(remMinutes, r.minutes);
  }
  const global = remaining(store.config.settings.pauseLimit, null, t);
  remCount = minNull(remCount, global.count);
  remMinutes = minNull(remMinutes, global.minutes);
  if (remCount === 0) return { ...none('pause.unavailable.noneLeft'), remainingCount: 0 };
  if (remMinutes !== null && remMinutes <= 0)
    return { ...none('pause.unavailable.noMinutesLeft'), remainingMinutes: 0 };

  const main = groups[0];
  const scopes = main.pause.scopes.filter(
    (s) => groups.every((g) => g.pause.scopes.includes(s)) && (s !== 'page' || url) && (s !== 'site' || site),
  );
  const duration = { ...main.pause.duration };
  for (const g of groups) duration.minutes = Math.min(duration.minutes, g.pause.duration.minutes);
  if (remMinutes !== null) duration.minutes = Math.min(duration.minutes, remMinutes);
  if (duration.choices) duration.choices = duration.choices.filter((m) => m <= duration.minutes);
  return {
    available: scopes.length > 0,
    reason: scopes.length ? undefined : 'pause.unavailable.notAllowed',
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    scopes,
    duration,
    costs: groupCosts(groups),
    reasonMode: groups.some((g) => g.pause.reason === 'required')
      ? 'required'
      : groups.some((g) => g.pause.reason === 'optional')
        ? 'optional'
        : 'none',
    remainingCount: remCount,
    remainingMinutes: remMinutes,
    metered: groups.some((g) => g.pause.metered),
    site,
    url: url ?? null,
    incognito,
  };
}

/** Groups a pause of everything covers (BRK-03 "all"). */
function pausableGroups(): Group[] {
  return store.config.groups.filter((g) => g.enabled && !g.archived && g.pause.allowed);
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

export async function startPause(req: PauseRequest): Promise<{ ticket: TicketView | null; error?: string }> {
  await store.ready();
  const page = pauseOptions(req.url, req.groupId, req.incognito ?? null);
  // A pause of everything follows the rules of every group it covers.
  const opts = req.scope === 'all' && page.all ? page.all : page;
  if (!opts.available) return { ticket: null, error: opts.reason ?? 'pause.unavailable.notAllowed' };
  if (!opts.scopes.includes(req.scope)) return { ticket: null, error: 'pause.error.scope' };
  const max = opts.duration.minutes;
  let minutes = req.minutes;
  if (opts.duration.mode === 'fixed') minutes = max;
  if (!(minutes > 0) || minutes > max) return { ticket: null, error: 'pause.error.duration' };
  const steps: Step[] = [];
  if (opts.reasonMode !== 'none') steps.push({ type: 'reason', required: opts.reasonMode === 'required' });
  for (const cost of opts.costs) steps.push(...costSteps(cost));
  const groups = req.scope === 'all' ? '*' : opts.groups.map((g) => g.id);
  const purpose = {
    kind: 'pause' as const,
    groups: groups as string[] | '*',
    scope: req.scope,
    minutes,
    url: req.url ? pageKey(req.url) : undefined,
    site: opts.site ?? undefined,
    metered: opts.metered,
  };
  // A reason typed in the dialog before starting counts as the reason step.
  if (req.reason !== undefined && steps[0]?.type === 'reason') {
    if (steps[0].required && !req.reason.trim())
      return { ticket: null, error: 'ticket.error.reasonRequired' };
    steps.shift();
    pendingReasons.set(JSON.stringify(purpose), req.reason.trim());
  }
  const { view } = await createTicket(purpose, steps);
  return { ticket: view };
}

const pendingReasons = new Map<string, string>();

registerExecutor('pause', async (ticket) => {
  if (ticket.purpose.kind !== 'pause') return;
  const p = ticket.purpose;
  const t0 = now();
  const reason = ticket.collected.reason ?? pendingReasons.get(JSON.stringify(p));
  pendingReasons.delete(JSON.stringify(p));
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
  });
  store.state.pauses = store.state.pauses.slice(-1000);
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

/** BRK-09: ending a pause early is a strengthening, always immediate. */
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
