/** Glue between the pure engine and the background state: contexts, levels, view models. */

import type { CompiledGroup } from '../engine/compile';
import {
  type Decision,
  decide,
  type EngineContext,
  evaluateGroup,
  type GroupResult,
  NAV_SEVERITY,
  SEVERITY,
  type UrlContext,
} from '../engine/decide';
import { candidateTimes, nextRestriction, untilFor } from '../engine/next';
import { representativeUrl } from '../engine/patterns';
import { inWindows } from '../engine/time';
import type { Group, ProtectionLevel, Target } from '../engine/types';
import { displayHost, parseUrl } from '../engine/url';
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
// Protection levels (PRO-01, PRO-16)
// ---------------------------------------------------------------------------

export function globalLevel(t = now()): ProtectionLevel {
  const p = store.config.settings.protection;
  if (p.level === 'locked' && p.lockedUntil && t >= p.lockedUntil) return p.fallback;
  return p.level;
}

export function groupLevel(g: Group, t = now()): ProtectionLevel {
  if (g.protection === 'locked') {
    if (g.protectionUntil && t >= g.protectionUntil) return store.config.settings.protection.fallback;
    return 'locked';
  }
  return g.protection ?? globalLevel(t);
}

export function lockedUntilFor(g: Group | null): number | null {
  if (g && g.protection === 'locked') return g.protectionUntil ?? null;
  return store.config.settings.protection.lockedUntil;
}

/** A group is "active" when it currently restricts navigation (PRO-04). */
export function groupActiveNow(g: Group, c = ctx()): boolean {
  const cg = c.cc.byId.get(g.id);
  if (!cg) return false;
  if (
    c.state.sessions.some(
      (s) => s.startAt <= c.now && c.now < s.endAt && (s.kind === 'allowlist' || s.groups.includes(g.id)),
    )
  ) {
    return true;
  }
  const r = evaluateRepresentative(cg, c);
  return Boolean(r && SEVERITY[r.base.type] >= NAV_SEVERITY);
}

export function anyGroupActive(c = ctx()): boolean {
  return store.config.groups.some((g) => g.enabled && !g.archived && groupActiveNow(g, c));
}

/** PRO-04: weakening refused now for this group (Strict level while active, or access windows). */
export function lockedNow(g: Group | null, c = ctx()): boolean {
  const level = g ? groupLevel(g, c.now) : globalLevel(c.now);
  if (level === 'locked') return true;
  if (level !== 'strict') return false;
  return g ? groupActiveNow(g, c) : anyGroupActive(c);
}

export function inAccessWindow(t = now()): boolean {
  const w = store.config.settings.protection.access.lockWindows;
  return w.length > 0 && inWindows(w, t, store.cc.cal);
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
    pause: r.pause
      ? { id: r.pause.id, until: r.pause.until, remaining: r.pause.remaining, scope: r.pause.scope }
      : null,
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
    allowlisted: d.allowlisted
      ? { type: d.allowlisted.target.type, value: d.allowlisted.target.value }
      : null,
    until: until.until,
    next: until.next,
    restriction,
  };
}

/** Evaluates a group on a representative URL of its first blocking entry. */
export function evaluateRepresentative(cg: CompiledGroup, c = ctx()): GroupResult | null {
  for (const cp of cg.index.all) {
    if (cp.allow) continue;
    const rep = representativeUrl(cp);
    const parsed = rep ? parseUrl(rep) : null;
    if (!parsed) continue;
    return evaluateGroup(c, cg, cp, parsed);
  }
  return null;
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
    level: groupLevel(g, c.now),
    lockedNow: lockedNow(g, c),
    nextChange: null,
  };
  if (!cg) return base;
  const r = evaluateRepresentative(cg, c);
  if (!r) return base;
  base.intervention = r.intervention;
  base.source = r.source;
  base.budgets = r.policies.filter((p) => p.budget).map((p) => budgetView(p.budget!));
  const pause = r.pause;
  if (pause) base.pause = { until: pause.until, remaining: pause.remaining };
  // Next change for this group alone.
  for (const t of candidateTimes(c, [cg])) {
    const later = evaluateRepresentative(cg, { ...c, now: t });
    if (later && later.intervention.type !== r.intervention.type) {
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
