/**
 * SEM-07: when does the situation change? Computed over all policies of all applicable groups,
 * plus grants, sessions and cool-downs. Also used to schedule the background alarm.
 */

import type { CompiledGroup } from './compile';
import {
  budgetStatus,
  type Decision,
  decide,
  type EngineContext,
  grantActive,
  SEVERITY,
  severityOf,
  type UrlContext,
} from './decide';
import { DAY, periodRange, scheduleBoundaries } from './time';
import type { Intervention } from './types';
import { usageKeys } from './usage';

const HORIZON_DAYS = 8;

/** Instants after `now` at which decisions for the given groups may change (sorted, unique). */
export function candidateTimes(ctx: EngineContext, groups: CompiledGroup[]): number[] {
  const { now, state, cc } = ctx;
  const out = new Set<number>();
  const add = (t: number | null | undefined) => {
    if (t && t > now && t <= now + HORIZON_DAYS * DAY) out.add(t);
  };
  const gap = cc.config.settings.tracking.visitGapMinutes * 60_000;
  for (const cg of groups) {
    for (const p of cg.group.policies) {
      for (const t of scheduleBoundaries(p.schedule, now, cc.cal, HORIZON_DAYS)) add(t);
      if (p.budget && p.budget.type !== 'session') {
        add(periodRange(p.budget.period, now, cc.cal).end);
        const key = usageKeys.group(cg.group.id);
        const act = state.activity[key];
        if (act) add(act.last + gap + 1);
        if (p.budget.period.kind === 'rolling') {
          const st = budgetStatus(ctx, cg.group, p, p.budget, '');
          add(st.refillAt);
        }
      }
    }
  }
  for (const cd of Object.values(state.cooldowns)) add(cd.until);
  for (const f of Object.values(state.forfeits)) add(f);
  for (const s of state.sessions) {
    add(s.startAt);
    add(s.endAt);
  }
  for (const g of state.grants) {
    add(g.until);
    if (g.visit) {
      const keys = Object.keys(state.activity).filter((k) => k.startsWith('g:') || k.startsWith('s:'));
      let last = g.createdAt;
      for (const k of keys) last = Math.max(last, state.activity[k].last);
      add(last + gap + 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function relevantGroups(ctx: EngineContext, d: Decision): CompiledGroup[] {
  const ids = new Set(d.groups.map((g) => g.group.id));
  for (const e of d.excepted) ids.add(e.group.id);
  return ctx.cc.groups.filter((g) => ids.has(g.group.id));
}

export interface Until {
  /** Instant at which the current intervention ends (null: no change planned). */
  until: number | null;
  /** The intervention after the change. */
  next: Intervention | null;
}

/** When the current intervention on the URL ends, considering every policy and group (SEM-07). */
export function untilFor(ctx: EngineContext, url: string, uctx: UrlContext, current?: Decision): Until {
  const d0 = current ?? decide(ctx, url, uctx);
  if (d0.exempt) return { until: null, next: null };
  const groups = relevantGroups(ctx, d0);
  for (const t of candidateTimes(ctx, groups)) {
    const dt = decide({ ...ctx, now: t }, url, uctx);
    if (dt.severity < d0.severity || dt.intervention.type !== d0.intervention.type) {
      return { until: t, next: dt.intervention };
    }
  }
  return { until: null, next: null };
}

export interface Restriction {
  /** Instant at which a stricter intervention will apply if the user keeps using the site. */
  at: number;
  kind: 'budget' | 'schedule' | 'grant' | 'session';
  intervention: Intervention;
  groupId: string | null;
}

/**
 * The next restriction for a URL that is currently allowed (or only filtered/reminded), assuming
 * continuous use: budget running out, a window starting, a pause or pass ending.
 * Drives the overlay timer (NOT-01), the badge (NOT-02) and warnings (NOT-03).
 */
export function nextRestriction(
  ctx: EngineContext,
  url: string,
  uctx: UrlContext,
  current?: Decision,
): Restriction | null {
  const d0 = current ?? decide(ctx, url, uctx);
  if (d0.exempt) return null;
  let best: Restriction | null = null;
  const consider = (r: Restriction) => {
    if (!best || r.at < best.at) best = r;
  };

  for (const r of d0.groups) {
    // Pauses and passes ending.
    const grant = r.pause ?? r.pass;
    if (grant) {
      if (grant.until !== undefined) {
        consider({ at: grant.until, kind: 'grant', intervention: r.base, groupId: r.group.id });
      } else if (grant.remaining !== undefined) {
        consider({
          at: ctx.now + grant.remaining * 1000,
          kind: 'grant',
          intervention: r.base,
          groupId: r.group.id,
        });
      }
      continue;
    }
    // Budgets running out with continuous use.
    const currentSeverity = SEVERITY[r.intervention.type];
    for (const pe of r.policies) {
      if (!pe.budget || pe.budget.exhausted || !pe.scheduleActive) continue;
      if (r.policyIndex !== -1 && r.policyIndex < pe.index) break;
      if (severityOf(pe.policy.intervention) <= currentSeverity) continue;
      if (pe.budget.budget.type === 'visits') {
        const b = pe.budget.budget;
        if (b.maxVisitMinutes && pe.budget.inVisit) {
          const act = ctx.state.activity[pe.budget.key];
          const left = b.maxVisitMinutes * 60 - (act?.visitSeconds ?? 0);
          consider({
            at: ctx.now + left * 1000,
            kind: 'budget',
            intervention: pe.policy.intervention,
            groupId: r.group.id,
          });
        }
        continue;
      }
      consider({
        at: ctx.now + pe.budget.remaining * 1000,
        kind: 'budget',
        intervention: pe.policy.intervention,
        groupId: r.group.id,
      });
    }
  }

  // Schedules and sessions starting.
  const groups = relevantGroups(ctx, d0);
  for (const t of candidateTimes(ctx, groups)) {
    if (best && t >= (best as Restriction).at) break;
    const dt = decide({ ...ctx, now: t }, url, uctx);
    if (dt.severity > d0.severity) {
      consider({
        at: t,
        kind: dt.source === 'session' ? 'session' : 'schedule',
        intervention: dt.intervention,
        groupId: dt.primary?.group.id ?? null,
      });
      break;
    }
  }
  return best;
}

/** Earliest instant at which any decision or timed state may change (background alarm). */
export function nextGlobalChange(ctx: EngineContext): number | null {
  const times = candidateTimes(ctx, ctx.cc.groups);
  const { now, state } = ctx;
  const extra: number[] = [];
  for (const p of state.pending) {
    extra.push(p.readyAt, p.expiresAt);
  }
  if (state.emergency) extra.push(state.emergency.readyAt);
  for (const g of state.grants) {
    if (g.until) extra.push(g.until);
  }
  const all = [...times, ...extra.filter((t) => t > now)].sort((a, b) => a - b);
  return all[0] ?? null;
}

/** Grants that are no longer active and can be removed. */
export function expiredGrants(ctx: EngineContext) {
  return ctx.state.grants.filter((g) => {
    if (g.kind === 'recheck') return g.until !== undefined && ctx.now >= g.until;
    if (g.groups === '*') return !grantActive(ctx, g);
    // A grant is expired when it is inactive for every group it covers.
    return g.groups.every((id) => !grantActive(ctx, g, id, g.site));
  });
}
