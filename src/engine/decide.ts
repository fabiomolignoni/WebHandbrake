/**
 * Normative evaluation semantics: what happens to a URL at a given instant.
 *
 * - Inside a group the most specific entry decides (exceptions), then the first policy
 *   whose condition is true applies.
 * - Across groups the most severe intervention wins; group order never matters. Every
 *   group still applies: an access lifts only its own group, so the next one shows, and
 *   the filters of all of them add up (`pageFilters`).
 * - Exceptions only affect their own group.
 */

import {
  type CompiledConfig,
  type CompiledGroup,
  compileTargets,
  redirectDestination,
  redirectKey,
} from './compile';
import { breaksLift } from './defaults';
import { type CompiledPattern, siteKeyFor } from './patterns';
import { isNav, PASSABLE, SEVERITY } from './severity';
import { periodRange, scheduleActive } from './time';
import type { Budget, FocusSession, Grant, Group, Intervention, Policy, RuntimeState } from './types';
import { isExtensionUrl, type ParsedUrl, pageKey, parseUrl } from './url';
import { type Usage, usageKeys } from './usage';

export interface EngineContext {
  cc: CompiledConfig;
  state: RuntimeState;
  usage: Usage;
  now: number;
}

export interface UrlContext {
  /** null when unknown (DNR compilation): groups limited to normal or private windows are skipped. */
  incognito: boolean | null;
}

export type Source = 'policy' | 'session' | 'none';

export interface BudgetStatus {
  policyId: string;
  budget: Budget;
  key: string;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  forfeited: boolean;
  inVisit: boolean;
  periodStart: number;
  periodEnd: number;
  /** When the budget becomes available again (null when unknown). */
  refillAt: number | null;
}

export interface PolicyEval {
  index: number;
  policy: Policy;
  scheduleActive: boolean;
  budget: BudgetStatus | null;
  active: boolean;
}

export interface GroupResult {
  group: Group;
  entry: CompiledPattern;
  site: string;
  policies: PolicyEval[];
  /** Index of the policy that applies, -1 when none. */
  policyIndex: number;
  /** Intervention before pauses and passes. */
  base: Intervention;
  /** Effective intervention. */
  intervention: Intervention;
  source: Source;
  session?: FocusSession;
  pause?: Grant;
  pass?: Grant;
  /** Whether a pause would be allowed now. */
  pausable: boolean;
}

export interface Decision {
  url: string;
  parsed: ParsedUrl | null;
  severity: number;
  intervention: Intervention;
  source: Source;
  /** Group whose intervention applies (null for list sessions or when nothing applies). */
  primary: GroupResult | null;
  /** Blocklist or allowlist focus session that blocks the URL. */
  session: FocusSession | null;
  /** Groups for which the URL is a target. */
  groups: GroupResult[];
  /** Groups where an exception matched the URL. */
  excepted: { group: Group; entry: CompiledPattern }[];
  /** True for URLs that are never evaluated (extension pages, redirect destinations). */
  exempt: boolean;
}

const TRACK: Intervention = { type: 'track' };
const ALLOW: Intervention = { type: 'allow' };
const BLOCK: Intervention = { type: 'block' };

export function activeSessions(state: RuntimeState, now: number): FocusSession[] {
  return state.sessions.filter((s) => s.startAt <= now && now < s.endAt);
}

export function policyKey(policyId: string, site: string | null): string {
  return site ? `${policyId}:${site}` : policyId;
}

function visitGapMs(ctx: EngineContext): number {
  return ctx.cc.config.settings.tracking.visitGapMinutes * 60_000;
}

export function budgetStatus(
  ctx: EngineContext,
  group: Group,
  policy: Policy,
  budget: Budget,
  site: string,
): BudgetStatus {
  const { now, state, usage, cc } = ctx;
  const key = budget.perSite ? usageKeys.site(group.id, site) : usageKeys.group(group.id);
  const pk = policyKey(policy.id, budget.perSite ? site : null);
  const act = state.activity[key];
  const inVisit = Boolean(act && now - act.last <= visitGapMs(ctx));
  // A forfeit of the whole policy also covers every site of a per-site budget.
  const forfeitUntil = Math.max(state.forfeits[pk] ?? 0, state.forfeits[policy.id] ?? 0);
  const forfeited = now < forfeitUntil;
  const range = periodRange(budget.period, now, cc.cal);
  const visits = budget.type === 'visits';
  const used = usage.sum(key, range, visits ? 1 : 0);
  const limit = visits ? budget.count : Math.round(budget.minutes * 60);
  // A visit under way goes on to its end: the visits allowed are used up by the next one.
  const exhausted = (visits ? used >= limit && !inVisit : used >= limit) || forfeited;
  return {
    policyId: policy.id,
    budget,
    key,
    inVisit,
    forfeited,
    used,
    limit,
    remaining: forfeited ? 0 : Math.max(0, limit - used),
    exhausted,
    periodStart: range.start,
    periodEnd: range.end,
    refillAt: forfeited ? Math.max(range.end, forfeitUntil) : range.end,
  };
}

export function grantActive(ctx: EngineContext, g: Grant, groupId?: string, site?: string): boolean {
  const { now, state } = ctx;
  if (g.until !== undefined && now >= g.until) return false;
  if (g.visit) {
    const key =
      g.scope === 'site' && site && groupId
        ? usageKeys.site(groupId, site)
        : groupId
          ? usageKeys.group(groupId)
          : '';
    const last = Math.max(state.activity[key]?.last ?? 0, g.createdAt);
    if (now - last > visitGapMs(ctx)) return false;
  }
  return true;
}

export function grantCovers(g: Grant, group: Group, site: string, url: ParsedUrl): boolean {
  if (g.groups !== '*' && !g.groups.includes(group.id)) return false;
  // A break of everything, from an earlier version, covers the rules that allow breaks.
  if (g.groups === '*' && !group.pause.allowed) return false;
  switch (g.scope) {
    case 'page':
      return g.url === pageKey(url.href);
    case 'site':
      return g.site === site;
    default:
      return true;
  }
}

/** A rule that only counts at certain times leaves the other times alone: nothing is counted (#21). */
function countsAtTimes(g: Group): boolean {
  const [p] = g.policies;
  return Boolean(p && p.intervention.type === 'track' && p.schedule.mode === 'during' && !p.budget);
}

/** Evaluates a group whose (block) entry matched the URL. */
export function evaluateGroup(
  ctx: EngineContext,
  cg: CompiledGroup,
  entry: CompiledPattern,
  url: ParsedUrl,
): GroupResult {
  const { now, state, cc } = ctx;
  const group = cg.group;
  const site = siteKeyFor(entry, url);

  const policies: PolicyEval[] = [];
  let policyIndex = -1;
  group.policies.forEach((policy, index) => {
    const sched = scheduleActive(policy.schedule, now, cc.cal);
    const budget = policy.budget ? budgetStatus(ctx, group, policy, policy.budget, site) : null;
    const active = sched && (budget ? budget.exhausted : true);
    policies.push({ index, policy, scheduleActive: sched, budget, active });
    if (active && policyIndex === -1) policyIndex = index;
  });

  let base: Intervention =
    policyIndex >= 0 ? group.policies[policyIndex].intervention : countsAtTimes(group) ? ALLOW : TRACK;
  let source: Source = policyIndex >= 0 ? 'policy' : 'none';

  const sessions = activeSessions(state, now).filter(
    (s) => s.kind === 'groups' && s.groups.includes(group.id),
  );
  const session = sessions[0];
  if (session && SEVERITY.block >= SEVERITY[base.type]) {
    base = BLOCK;
    source = 'session';
  }

  // The focus session decides whether the rule's breaks are allowed during it.
  const sessionBlocksPauses = sessions.some((s) => s.noPauses);
  // A break lifts a block only, whether the rule's, a cool-down's or a session's.
  const pausable = group.pause.allowed && breaksLift(base) && !sessionBlocksPauses;

  let intervention = base;
  let pause: Grant | undefined;
  let pass: Grant | undefined;
  if (pausable) {
    pause = state.grants.find(
      (g) => g.kind === 'pause' && grantCovers(g, group, site, url) && grantActive(ctx, g, group.id, site),
    );
  }
  if (pause) {
    intervention = TRACK;
  } else if (source === 'policy' && PASSABLE.includes(base.type)) {
    pass = state.grants.find(
      (g) =>
        g.kind === 'pass' &&
        g.severity >= SEVERITY[base.type] &&
        grantCovers(g, group, site, url) &&
        grantActive(ctx, g, group.id, site),
    );
    if (pass) intervention = TRACK;
  }

  return {
    group,
    entry,
    site,
    policies,
    policyIndex,
    base,
    intervention,
    source,
    session,
    pause,
    pass,
    pausable,
  };
}

function strength(i: Intervention): number {
  switch (i.type) {
    case 'delay':
      return i.seconds;
    case 'challenge':
      return i.length ?? 0;
    case 'block':
      return 1;
    default:
      return 0;
  }
}

/** Deterministic order of equally severe results (never depends on group order unless all else ties). */
function better(a: GroupResult, b: GroupResult, cc: CompiledConfig): boolean {
  const sa = SEVERITY[a.intervention.type];
  const sb = SEVERITY[b.intervention.type];
  if (sa !== sb) return sa > sb;
  const ta = strength(a.intervention);
  const tb = strength(b.intervention);
  if (ta !== tb) return ta > tb;
  return (cc.byId.get(a.group.id)?.order ?? 0) < (cc.byId.get(b.group.id)?.order ?? 0);
}

const sessionIndexCache = new WeakMap<FocusSession, ReturnType<typeof compileTargets>>();

/** Whether a list session blocks a URL: one of its sites (not an exception), or any but those allowed. */
function sessionBlocks(s: FocusSession, url: ParsedUrl): boolean {
  if (s.kind === 'groups') return false;
  let index = sessionIndexCache.get(s);
  if (!index) {
    index = compileTargets(
      s.kind === 'allowlist' ? s.allow.map((t) => ({ ...t, allow: true })) : (s.block ?? []),
    );
    sessionIndexCache.set(s, index);
  }
  if (s.kind === 'allowlist') return index.match(url).length === 0;
  const { winner } = index.winner(url);
  return Boolean(winner && !winner.allow);
}

function exemptDecision(url: string, parsed: ParsedUrl | null): Decision {
  return {
    url,
    parsed,
    severity: 0,
    intervention: ALLOW,
    source: 'none',
    primary: null,
    session: null,
    groups: [],
    excepted: [],
    exempt: true,
  };
}

/** Whether a rule's result sends the tab to this very page. */
function redirectsHere(r: GroupResult, key: string): boolean {
  return r.intervention.type === 'redirect' && redirectKey(r.intervention.url) === key;
}

export function decide(ctx: EngineContext, url: string, uctx: UrlContext = { incognito: null }): Decision {
  const d = decideOnce(ctx, url, uctx);
  // A redirect whose destination is restricted by another rule or a focus session would
  // land on an intervention or start a chain of redirects: the rule blocks instead.
  if (d.intervention.type === 'redirect') {
    const there = decideOnce(ctx, redirectDestination(d.intervention.url), uctx);
    if (isNav(there)) {
      d.intervention = BLOCK;
      d.severity = SEVERITY.block;
    }
  }
  return d;
}

function decideOnce(ctx: EngineContext, url: string, uctx: UrlContext): Decision {
  const parsed = parseUrl(url);
  if (!parsed || isExtensionUrl(url)) return exemptDecision(url, parsed);
  let key: string | null = null;

  const decision: Decision = {
    url,
    parsed,
    severity: SEVERITY.allow,
    intervention: ALLOW,
    source: 'none',
    primary: null,
    session: null,
    groups: [],
    excepted: [],
    exempt: false,
  };

  for (const cg of ctx.cc.groups) {
    const privacy = cg.group.options.privacy;
    if (privacy !== 'all') {
      if (uctx.incognito === null) continue;
      if (privacy === 'private' && !uctx.incognito) continue;
      if (privacy === 'normal' && uctx.incognito) continue;
    }
    const { winner } = cg.index.winner(parsed);
    if (!winner) continue;
    if (winner.allow) {
      decision.excepted.push({ group: cg.group, entry: winner });
      continue;
    }
    const r = evaluateGroup(ctx, cg, winner, parsed);
    // A rule never intervenes on the page it redirects to, which may be inside its own
    // sites; the other rules and focus sessions still apply there.
    if (r.intervention.type === 'redirect' && redirectsHere(r, (key ??= redirectKey(url)))) continue;
    decision.groups.push(r);
    if (!decision.primary || better(r, decision.primary, ctx.cc)) decision.primary = r;
  }

  if (decision.primary) {
    decision.intervention = decision.primary.intervention;
    decision.severity = SEVERITY[decision.intervention.type];
    decision.source = decision.primary.source;
  }

  // Blocklist sessions block the web pages of their sites, allowlist sessions every web page not
  // explicitly allowed.
  if (parsed.web && decision.severity < SEVERITY.block) {
    const s = activeSessions(ctx.state, ctx.now).find((x) => sessionBlocks(x, parsed));
    if (s) {
      decision.session = s;
      decision.intervention = BLOCK;
      decision.severity = SEVERITY.block;
      decision.source = 'session';
      decision.primary = null;
    }
  }

  // Rules that match but restrict nothing count the time, unless they allow without
  // counting.
  if (decision.severity === 0 && decision.groups.some((g) => g.intervention.type !== 'allow')) {
    decision.intervention = TRACK;
    decision.severity = SEVERITY.track;
  }
  return decision;
}

export type FilterIntervention = Extract<Intervention, { type: 'filter' }>;

/**
 * The filters of every rule on the page apply together, whatever else applies: of two of
 * the same kind, the stronger one. A page that is replaced shows none.
 */
export function pageFilters(d: Decision): FilterIntervention[] {
  if (isNav(d)) return [];
  const byKind = new Map<string, FilterIntervention>();
  for (const r of d.groups) {
    const i = r.intervention;
    if (i.type !== 'filter') continue;
    const prev = byKind.get(i.filter);
    if (!prev || (i.intensity ?? 100) > (prev.intensity ?? 100)) byKind.set(i.filter, i);
  }
  return [...byKind.values()];
}
