/** Glue between the pure engine and the background state: contexts, protections, view models. */

import { ruleProtection } from '../engine/changes';
import type { CompiledGroup } from '../engine/compile';
import {
  activeSessions,
  type Decision,
  decide,
  type EngineContext,
  evaluateGroup,
  type GroupResult,
  type UrlContext,
} from '../engine/decide';
import { candidateTimes, nextRestriction, untilFor } from '../engine/next';
import { representativeUrl, siteKeyFor } from '../engine/patterns';
import { NAV_SEVERITY, SEVERITY } from '../engine/severity';
import type { Group, Protection, Target } from '../engine/types';
import { displayHost, type ParsedUrl, parseUrl } from '../engine/url';
import type { BudgetView, DecisionView, GroupDecisionView, GroupStatus } from '../shared/models';
import { now } from './clock';
import { store } from './store';

export function ctx(at?: number): EngineContext {
  return { cc: store.cc, state: store.state, usage: store.usage, now: at ?? now() };
}

export function decideUrl(url: string, incognito: boolean | null, at?: number): Decision {
  return decide(ctx(at), url, { incognito });
}

// ---------------------------------------------------------------------------
// Protections
// ---------------------------------------------------------------------------

/** The protection of a rule now; after its date, Locked asks only for a reminder. */
export function groupProtection(g: Group, t = now()): Protection {
  return ruleProtection(g, t);
}

export { firmProtection } from '../engine/defaults';

/** A group is "active" when it currently restricts navigation. */
export function groupActiveNow(g: Group, c = ctx()): boolean {
  const cg = c.cc.byId.get(g.id);
  if (!cg) return false;
  if (activeSessions(c.state, c.now).some((s) => s.kind === 'allowlist' || s.groups.includes(g.id)))
    return true;
  return evaluateSites(cg, c).some(({ result }) => SEVERITY[result.base.type] >= NAV_SEVERITY);
}

/** Loosening this rule is refused now (Locked before its date, or Permanent). */
export function lockedNow(g: Group, t = now()): boolean {
  const kind = groupProtection(g, t).kind;
  return kind === 'locked' || kind === 'permanent';
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

function entryView(t: Target) {
  return { type: t.type, value: t.value, allow: Boolean(t.allow) };
}

export function groupResultView(r: GroupResult): GroupDecisionView {
  return {
    groupId: r.group.id,
    name: r.group.name,
    color: r.group.color,
    icon: r.group.icon,
    note: r.group.note,
    message: r.group.message,
    entry: entryView(r.entry.target),
    site: r.site,
    policyIndex: r.policyIndex,
    base: r.base,
    intervention: r.intervention,
    source: r.source,
    policies: r.policies.map((p) => ({
      index: p.index,
      id: p.policy.id,
      scheduleActive: p.scheduleActive,
      active: p.active,
      intervention: p.policy.intervention,
      budget: p.budget ? budgetView(p.budget) : null,
    })),
    pause: r.pause ? { id: r.pause.id, until: r.pause.until, scope: r.pause.scope } : null,
    pass: r.pass
      ? {
          id: r.pass.id,
          until: r.pass.until,
          visit: r.pass.visit,
          intention: r.pass.intention,
          scope: r.pass.scope,
        }
      : null,
    pausable: r.pausable,
    cooldownUntil: r.cooldown?.until ?? null,
  };
}

export function budgetView(b: NonNullable<GroupResult['policies'][number]['budget']>): BudgetView {
  return {
    policyId: b.policyId,
    type: b.budget.type,
    used: b.used,
    limit: b.limit,
    remaining: b.remaining,
    exhausted: b.exhausted,
    periodEnd: b.periodEnd,
    refillAt: b.refillAt,
    perSite: Boolean(b.budget.perSite),
    periodKind: 'period' in b.budget ? b.budget.period.kind : undefined,
  };
}

export function decisionView(d: Decision, uctx: UrlContext, c = ctx()): DecisionView {
  const until = d.severity > SEVERITY.track ? untilFor(c, d.url, uctx, d) : { until: null, next: null };
  const restriction = d.exempt ? null : nextRestriction(c, d.url, uctx, d);
  return {
    url: d.url,
    host: displayHost(d.url),
    exempt: d.exempt,
    severity: d.severity,
    intervention: d.intervention,
    source: d.source,
    primary: d.primary ? groupResultView(d.primary) : null,
    session: d.session
      ? { id: d.session.id, kind: d.session.kind, endAt: d.session.endAt, locked: d.session.locked }
      : null,
    groups: d.groups.map(groupResultView),
    excepted: d.excepted.map((e) => ({
      groupId: e.group.id,
      name: e.group.name,
      entry: entryView(e.entry.target),
    })),
    until: until.until,
    next: until.next,
    restriction,
  };
}

/**
 * Evaluates a group on a representative URL of each blocking entry, once per site: a break, an
 * access, a cool-down or a limit per site applies to one site only, so the first entry alone
 * does not tell what the rule does. The strictest result comes first; among equally strict
 * ones, the earliest entry.
 */
export function evaluateSites(cg: CompiledGroup, c = ctx()): { result: GroupResult; url: ParsedUrl }[] {
  const out: { result: GroupResult; url: ParsedUrl }[] = [];
  const seen = new Set<string>();
  const differ = sitesMayDiffer(cg, c);
  for (const cp of cg.index.all) {
    if (out.length && !differ) break;
    if (cp.allow) continue;
    const rep = representativeUrl(cp);
    const parsed = rep ? parseUrl(rep) : null;
    if (!parsed) continue;
    const site = siteKeyFor(cp, parsed);
    if (seen.has(site)) continue;
    seen.add(site);
    out.push({ result: evaluateGroup(c, cg, cp, parsed), url: parsed });
  }
  // A stable sort: the earliest entry first among equally strict results.
  return out.sort((a, b) => SEVERITY[b.result.intervention.type] - SEVERITY[a.result.intervention.type]);
}

/** Whether something applies to some sites of a group only: otherwise every site has the same result. */
function sitesMayDiffer(cg: CompiledGroup, c: EngineContext): boolean {
  const id = cg.group.id;
  return (
    cg.group.policies.some((p) => p.budget?.perSite) ||
    c.state.grants.some(
      (g) =>
        g.kind !== 'recheck' &&
        g.scope !== 'group' &&
        g.scope !== 'all' &&
        (g.groups === '*' || g.groups.includes(id)),
    ) ||
    Object.values(c.state.cooldowns).some((cd) => cd.group === id && cd.site)
  );
}

export function groupStatus(g: Group, c = ctx()): GroupStatus {
  const cg = c.cc.byId.get(g.id);
  const base: GroupStatus = {
    id: g.id,
    name: g.name,
    color: g.color,
    icon: g.icon,
    enabled: g.enabled,
    archived: g.archived,
    siteCount: g.targets.filter((t) => !t.allow).length,
    intervention: null,
    source: 'none',
    until: null,
    next: null,
    budgets: [],
    pause: null,
    protection: groupProtection(g, c.now),
    lockedNow: lockedNow(g, c.now),
    nextChange: null,
  };
  if (!cg) return base;
  const strictest = evaluateSites(cg, c)[0];
  if (!strictest) return base;
  const r = strictest.result;
  base.intervention = r.intervention;
  base.source = r.source;
  base.budgets = r.policies.filter((p) => p.budget).map((p) => budgetView(p.budget!));
  const pause = r.pause;
  if (pause) base.pause = { until: pause.until };
  // Next change for this group alone, on the site that it restricts most now.
  for (const t of candidateTimes(c, [cg])) {
    const later = evaluateGroup({ ...c, now: t }, cg, r.entry, strictest.url);
    if (later.intervention.type !== r.intervention.type) {
      base.nextChange = { at: t, intervention: later.intervention };
      if (SEVERITY[later.intervention.type] < SEVERITY[r.intervention.type]) {
        base.until = t;
        base.next = later.intervention;
      }
      break;
    }
  }
  return base;
}
