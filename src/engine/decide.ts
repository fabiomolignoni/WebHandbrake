/**
 * Normative evaluation semantics: what happens to a URL at a given instant.
 *
 * - SEM-02: inside a group the most specific entry decides (exceptions), then the first policy
 *   whose condition is true applies.
 * - SEM-03: across groups the most severe intervention wins; group order never matters.
 * - SEM-04: exceptions only affect their own group.
 * - SEM-05: the global "Always allowed" list prevails over everything.
 */

import { type CompiledConfig, type CompiledGroup, compileTargets, redirectKey } from './compile';
import { type CompiledPattern, siteKeyFor } from './patterns';
import { periodRange, scheduleActive } from './time';
import type {
  Budget,
  Cooldown,
  FocusSession,
  Grant,
  Group,
  Intervention,
  InterventionType,
  Policy,
  RuntimeState,
} from './types';
import { isExtensionUrl, type ParsedUrl, pageKey, parseUrl } from './url';
import { type Usage, usageKeys } from './usage';

export const SEVERITY: Record<InterventionType, number> = {
  allow: 0,
  track: 1,
  remind: 2,
  filter: 3,
  ask: 4,
  delay: 5,
  challenge: 6,
  block: 7,
  redirect: 7,
  close: 8,
};

/** Interventions from this severity up replace the page (navigation interventions). */
export const NAV_SEVERITY = SEVERITY.ask;

export const PASSABLE: InterventionType[] = ['ask', 'delay', 'challenge'];

export function severityOf(i: Intervention): number {
  return SEVERITY[i.type];
}

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

export type Source = 'policy' | 'session' | 'cooldown' | 'none';

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
  cooldown?: Cooldown;
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
  /** Group whose intervention applies (null for allowlist sessions or when nothing applies). */
  primary: GroupResult | null;
  /** Allowlist focus session that blocks the URL. */
  session: FocusSession | null;
  /** Groups for which the URL is a target. */
  groups: GroupResult[];
  /** Groups where an exception matched the URL. */
  excepted: { group: Group; entry: CompiledPattern }[];
  /** Entry of the global allowlist that matched. */
  allowlisted: CompiledPattern | null;
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
  // LIM-11: a forfeit of the whole policy also covers every site of a per-site budget.
  const forfeitUntil = Math.max(state.forfeits[pk] ?? 0, state.forfeits[policy.id] ?? 0);
  const forfeited = now < forfeitUntil;
  const base = { policyId: policy.id, budget, key, inVisit, forfeited };
  switch (budget.type) {
    case 'time': {
      const range = periodRange(budget.period, now, cc.cal);
      const used = usage.sum(key, range, 0);
      const limit = Math.round(budget.minutes * 60);
      const exhausted = used >= limit || forfeited;
      let refillAt: number | null = range.end;
      if (budget.period.kind === 'rolling') {
        refillAt = usage.rollingRefill(key, budget.period.n ?? 60, limit, 0, now);
      }
      if (forfeited) refillAt = Math.max(refillAt ?? 0, forfeitUntil);
      return {
        ...base,
        used,
        limit,
        remaining: forfeited ? 0 : Math.max(0, limit - used),
        exhausted,
        periodStart: range.start,
        periodEnd: range.end,
        refillAt,
      };
    }
    case 'visits': {
      const range = periodRange(budget.period, now, cc.cal);
      const used = usage.sum(key, range, 1);
      const tooLong = Boolean(
        budget.maxVisitMinutes && inVisit && act && act.visitSeconds >= budget.maxVisitMinutes * 60,
      );
      const exhausted = (used >= budget.count && !inVisit) || tooLong || forfeited;
      let refillAt: number | null = range.end;
      if (budget.period.kind === 'rolling') {
        refillAt = usage.rollingRefill(key, budget.period.n ?? 60, budget.count, 1, now);
      }
      if (tooLong && act) refillAt = Math.min(refillAt ?? Infinity, act.last + visitGapMs(ctx));
      if (forfeited) refillAt = Math.max(refillAt ?? 0, forfeitUntil);
      return {
        ...base,
        used,
        limit: budget.count,
        remaining: forfeited ? 0 : Math.max(0, budget.count - used),
        exhausted,
        periodStart: range.start,
        periodEnd: range.end,
        refillAt,
      };
    }
    case 'session': {
      // The cool-down of this site, or one started for the whole policy (LIM-11).
      const cd = [state.cooldowns[`session:${pk}`], state.cooldowns[`session:${policy.id}`]]
        .filter((x): x is Cooldown => Boolean(x && x.until > now))
        .sort((a, b) => b.until - a.until)[0];
      const cooling = Boolean(cd);
      const run = inVisit && act ? act.run : 0;
      const limit = Math.round(budget.maxMinutes * 60);
      const exhausted = cooling || run >= limit || forfeited;
      return {
        ...base,
        used: run,
        limit,
        remaining: cooling ? 0 : Math.max(0, limit - run),
        exhausted,
        periodStart: act?.visitStart ?? now,
        periodEnd: cooling && cd ? cd.until : now,
        refillAt: cooling && cd ? cd.until : null,
      };
    }
  }
}

export function grantActive(ctx: EngineContext, g: Grant, groupId?: string, site?: string): boolean {
  const { now, state } = ctx;
  if (g.until !== undefined && now >= g.until) return false;
  if (g.remaining !== undefined && g.remaining <= 0) return false;
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

function grantCovers(g: Grant, group: Group, site: string, url: ParsedUrl): boolean {
  if (g.groups !== '*' && !g.groups.includes(group.id)) return false;
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

  let base: Intervention = policyIndex >= 0 ? group.policies[policyIndex].intervention : TRACK;
  let source: Source = policyIndex >= 0 ? 'policy' : 'none';

  // LIM-06: cool-down after the time chosen at the entry question.
  let cooldown: Cooldown | undefined;
  for (const cd of Object.values(state.cooldowns)) {
    if (cd.kind === 'ask' && cd.group === group.id && cd.until > now && (!cd.site || cd.site === site)) {
      cooldown = cd;
    }
  }
  if (cooldown && SEVERITY.block > SEVERITY[base.type]) {
    base = BLOCK;
    source = 'cooldown';
  }

  const sessions = activeSessions(state, now).filter(
    (s) => s.kind === 'groups' && s.groups.includes(group.id),
  );
  const session = sessions[0];
  if (session && SEVERITY.block >= SEVERITY[base.type]) {
    base = BLOCK;
    source = 'session';
  }

  const sessionBlocksPauses =
    sessions.length > 0 && (!group.pause.duringSessions || sessions.some((s) => s.noPauses));
  const pausable = group.pause.allowed && !sessionBlocksPauses;

  let intervention = base;
  let pause: Grant | undefined;
  let pass: Grant | undefined;
  if (pausable) {
    pause = state.grants.find(
      (g) => g.kind === 'pause' && grantCovers(g, group, site, url) && grantActive(ctx, g, group.id, site),
    );
  }
  if (pause && base.type !== 'allow') {
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
    cooldown,
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

function sessionAllows(s: FocusSession, url: ParsedUrl): boolean {
  let index = sessionIndexCache.get(s);
  if (!index) {
    index = compileTargets(s.allow.map((t) => ({ ...t, allow: true })));
    sessionIndexCache.set(s, index);
  }
  return index.match(url).length > 0;
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
    allowlisted: null,
    exempt: true,
  };
}

export function isRedirectTarget(cc: CompiledConfig, url: string): boolean {
  // Exactly the destination page (any query): never the rest of its site.
  return cc.redirectTargets.size > 0 && cc.redirectTargets.has(redirectKey(url));
}

export function decide(ctx: EngineContext, url: string, uctx: UrlContext = { incognito: null }): Decision {
  const parsed = parseUrl(url);
  if (!parsed || isExtensionUrl(url)) return exemptDecision(url, parsed);
  if (isRedirectTarget(ctx.cc, url)) return exemptDecision(url, parsed);

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
    allowlisted: null,
    exempt: false,
  };

  const allowed = ctx.cc.allowlist.match(parsed);
  if (allowed.length) {
    decision.allowlisted = allowed.reduce((a, b) => (b.spec > a.spec ? b : a));
    return decision;
  }

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
    decision.groups.push(r);
    if (!decision.primary || better(r, decision.primary, ctx.cc)) decision.primary = r;
  }

  if (decision.primary) {
    decision.intervention = decision.primary.intervention;
    decision.severity = SEVERITY[decision.intervention.type];
    decision.source = decision.primary.source;
  }

  // FOC-02: allowlist sessions block every web page not explicitly allowed.
  if (parsed.web && decision.severity < SEVERITY.block) {
    const s = activeSessions(ctx.state, ctx.now).find(
      (x) => x.kind === 'allowlist' && !sessionAllows(x, parsed),
    );
    if (s) {
      decision.session = s;
      decision.intervention = BLOCK;
      decision.severity = SEVERITY.block;
      decision.source = 'session';
      decision.primary = null;
    }
  }

  if (decision.severity === 0 && decision.groups.length) {
    decision.intervention = TRACK;
    decision.severity = SEVERITY.track;
  }
  return decision;
}

export function isNav(d: { severity: number }): boolean {
  return d.severity >= NAV_SEVERITY;
}
