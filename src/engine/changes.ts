/**
 * Configuration changes as small units, automatically classified as strengthening, neutral or
 * weakening. Strengthening units are always applied immediately; weakening units go
 * through the protection rules (cost, cooling-off, lock).
 *
 * The classifier is deliberately conservative: when it cannot prove that a change is stricter
 * it treats it as weakening.
 */

import { compileTargets, isGroupActive, redirectDestination, redirectKey } from './compile';
import { ASK_WAIT_SECONDS } from './defaults';
import { clone } from './json';
import { SEVERITY, severityOf } from './severity';
import { scheduleBitmap } from './time';
import type {
  Budget,
  Config,
  Cost,
  Group,
  GroupOptions,
  Intervention,
  PausePolicy,
  Period,
  Policy,
  Protection,
  Schedule,
  Target,
} from './types';
import { parseUrl } from './url';

/** The rule whose sites a unit changes. */
export type Owner = { kind: 'group'; id: string };

/** The fields a unit of this version can change: a pending unit of an earlier version may not. */
const GROUP_FIELDS = [
  'meta',
  'note',
  'message',
  'enabled',
  'archived',
  'policies',
  'pause',
  'protection',
  'options',
] as const;

export type GroupField = (typeof GROUP_FIELDS)[number];

export type ChangeUnit =
  | { kind: 'group.add'; group: Group }
  | { kind: 'group.remove'; groupId: string; name: string; base: Group }
  | { kind: 'group.field'; groupId: string; name: string; field: GroupField; value: unknown; base: unknown }
  | { kind: 'target.add'; owner: Owner; ownerName: string; target: Target }
  | { kind: 'target.remove'; owner: Owner; ownerName: string; target: Target }
  | { kind: 'order'; ids: string[] }
  | { kind: 'setting'; path: string; value: unknown; base: unknown };

export type Direction = 'strengthen' | 'neutral' | 'weaken';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    // Treat undefined and missing as equal.
    return (a === undefined || a === null) && (b === undefined || b === null);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

/** The protection of a rule at a time; after its date, Locked asks only for a reminder. */
export function ruleProtection(g: Group, t: number): Protection {
  const p = g.protection;
  return p.kind === 'locked' && t >= p.until ? { kind: 'reminder' } : p;
}

/**
 * A protection compared with the one it replaces. Permanent is the firmest, then Locked (a
 * later date is firmer), and a reminder the gentlest; a longer wait is firmer, and so is asking the
 * same partner's code for breaks. Another password or partner, or a change between a wait, a
 * password and a partner code, cannot be proven firmer: it is a loosening.
 */
export function compareProtection(a: Protection, b: Protection): Direction {
  if (deepEqual(a, b)) return 'neutral';
  if (b.kind === 'permanent') return 'strengthen';
  if (a.kind === 'permanent') return 'weaken';
  if (b.kind === 'locked') return a.kind === 'locked' ? cmpNum(a.until, b.until, true) : 'strengthen';
  if (a.kind === 'locked') return 'weaken';
  if (a.kind === 'reminder') return 'strengthen';
  if (b.kind === 'reminder') return 'weaken';
  if (a.kind === 'wait' && b.kind === 'wait') return cmpNum(a.seconds, b.seconds, true);
  if (a.kind === 'partner' && b.kind === 'partner' && a.secret === b.secret)
    return cmpBool(a.breaks, b.breaks, true);
  return 'weaken';
}

function combine(dirs: Direction[]): Direction {
  if (dirs.includes('weaken')) return 'weaken';
  if (dirs.includes('strengthen')) return 'strengthen';
  return 'neutral';
}

function cmpNum(oldV: number | undefined, newV: number | undefined, higherIsStronger: boolean): Direction {
  const a = oldV ?? 0;
  const b = newV ?? 0;
  if (a === b) return 'neutral';
  return b > a === higherIsStronger ? 'strengthen' : 'weaken';
}

function cmpBool(oldV: boolean | undefined, newV: boolean | undefined, trueIsStronger: boolean): Direction {
  if (Boolean(oldV) === Boolean(newV)) return 'neutral';
  return Boolean(newV) === trueIsStronger ? 'strengthen' : 'weaken';
}

/** Optional limit: undefined means unlimited. A smaller limit is stronger. */
function cmpLimit(oldV: number | undefined, newV: number | undefined): Direction {
  if (oldV === newV) return 'neutral';
  if (oldV === undefined) return 'strengthen';
  if (newV === undefined) return 'weaken';
  return newV < oldV ? 'strengthen' : 'weaken';
}

// ---------------------------------------------------------------------------
// Schedules and conditions
// ---------------------------------------------------------------------------

export type Coverage = 'equal' | 'superset' | 'subset' | 'other';

function compareSets(a: Uint8Array, b: Uint8Array): Coverage {
  let aOnly = false;
  let bOnly = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && !b[i]) aOnly = true;
    else if (b[i] && !a[i]) bOnly = true;
    if (aOnly && bOnly) return 'other';
  }
  if (!aOnly && !bOnly) return 'equal';
  return bOnly ? 'superset' : 'subset';
}

/** Coverage of the new schedule relative to the old one, with logical days starting at `dayStart`. */
export function compareSchedules(oldS: Schedule, newS: Schedule, dayStart = 0): Coverage {
  return compareSets(scheduleBitmap(oldS, dayStart), scheduleBitmap(newS, dayStart));
}

function samePeriod(a: Period, b: Period): boolean {
  return a.kind === b.kind && (a.n ?? 0) === (b.n ?? 0) && (a.offset ?? 0) === (b.offset ?? 0);
}

/** Coverage of "budget exhausted" for the new budget relative to the old one. */
function compareBudgets(oldB: Budget | undefined, newB: Budget | undefined): Coverage {
  if (!oldB && !newB) return 'equal';
  if (!newB) return 'superset'; // always true ⊇ exhausted
  if (!oldB) return 'subset';
  if (oldB.type !== newB.type || Boolean(oldB.perSite) !== Boolean(newB.perSite)) return 'other';
  const fromDirs = (dirs: Direction[]): Coverage => {
    const c = combine(dirs);
    if (dirs.includes('strengthen') && dirs.includes('weaken')) return 'other';
    return c === 'neutral' ? 'equal' : c === 'strengthen' ? 'superset' : 'subset';
  };
  switch (oldB.type) {
    case 'time': {
      const n = newB as typeof oldB;
      if (!samePeriod(oldB.period, n.period)) return 'other';
      return fromDirs([cmpNum(oldB.minutes, n.minutes, false)]);
    }
    case 'visits': {
      const n = newB as typeof oldB;
      if (!samePeriod(oldB.period, n.period)) return 'other';
      return fromDirs([cmpNum(oldB.count, n.count, false)]);
    }
  }
}

function compareConditions(oldP: Policy, newP: Policy, dayStart: number): Coverage {
  const s = compareSchedules(oldP.schedule, newP.schedule, dayStart);
  const b = compareBudgets(oldP.budget, newP.budget);
  if (s === 'other' || b === 'other') return 'other';
  if (s === 'equal') return b;
  if (b === 'equal') return s;
  return s === b ? s : 'other';
}

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

const SCOPE_RANK = { page: 0, site: 1, group: 2 } as const;

function compareGrant(
  a: { scope: 'page' | 'site' | 'group'; mode: 'visit' | 'minutes'; minutes?: number },
  b: typeof a,
): Direction {
  const dirs: Direction[] = [cmpNum(SCOPE_RANK[a.scope], SCOPE_RANK[b.scope], false)];
  if (a.mode !== b.mode) dirs.push('weaken');
  else if (a.mode === 'minutes') dirs.push(cmpNum(a.minutes, b.minutes, false));
  return combine(dirs);
}

const BLUR_RANK = { ignore: 0, pause: 1, restart: 2 } as const;

type Access = { scope: 'page' | 'site' | 'group'; mode: 'visit' | 'minutes'; minutes?: number };

/** The access that passing an intervention gives: an answer gives its site for at most its minutes. */
function passAccess(i: Intervention): Access | null {
  if (i.type === 'ask') return { scope: 'site', mode: 'minutes', minutes: i.maxMinutes };
  if (i.type === 'delay' || i.type === 'challenge') return i.grant;
  return null;
}

/** Seconds to wait before passing, for the interventions that make one wait. */
function passWait(i: Intervention): number | null {
  if (i.type === 'ask') return ASK_WAIT_SECONDS;
  if (i.type === 'delay') return i.seconds;
  return null;
}

/** Whether b opens more than a: a wider scope, or more minutes. */
function broaderAccess(a: Access, b: Access): boolean {
  if (SCOPE_RANK[b.scope] > SCOPE_RANK[a.scope]) return true;
  return a.mode === 'minutes' && b.mode === 'minutes' && (b.minutes ?? 0) > (a.minutes ?? 0);
}

/** Direction of the change from intervention a to b. */
export function compareInterventions(a: Intervention, b: Intervention): Direction {
  const sa = severityOf(a);
  const sb = severityOf(b);
  if (sa !== sb) {
    if (sb < sa) return 'weaken';
    // A stronger kind is stricter only when passing it opens no more and, between a question and
    // a wait, makes one wait no less: what cannot be shown to be stricter is a loosening.
    const ga = passAccess(a);
    const gb = passAccess(b);
    if (ga && gb && broaderAccess(ga, gb)) return 'weaken';
    const wa = passWait(a);
    const wb = passWait(b);
    if (wa !== null && wb !== null && wb < wa) return 'weaken';
    return 'strengthen';
  }
  if (a.type !== b.type) return a.type === 'redirect' || b.type === 'redirect' ? 'neutral' : 'weaken';
  switch (a.type) {
    case 'delay': {
      const n = b as typeof a;
      return combine([
        cmpNum(a.seconds, n.seconds, true),
        cmpNum(a.randomTo ?? a.seconds, n.randomTo ?? n.seconds, true),
        cmpNum(a.increase, n.increase, true),
        cmpBool(a.autoContinue, n.autoContinue, false),
        cmpNum(BLUR_RANK[a.onBlur ?? 'ignore'], BLUR_RANK[n.onBlur ?? 'ignore'], true),
        compareGrant(a.grant, n.grant),
      ]);
    }
    case 'challenge': {
      const n = b as typeof a;
      if (a.kind !== n.kind || (a.kind === 'phrase' && a.phrase !== n.phrase)) {
        return 'weaken';
      }
      return combine([cmpNum(a.length, n.length, true), compareGrant(a.grant, n.grant)]);
    }
    case 'ask': {
      const n = b as typeof a;
      return combine([
        cmpNum(a.maxMinutes, n.maxMinutes, false),
        cmpNum(a.minReasonLength, n.minReasonLength, true),
      ]);
    }
    case 'filter': {
      const n = b as typeof a;
      if (a.filter !== n.filter) return 'weaken';
      return cmpNum(a.intensity ?? 100, n.intensity ?? 100, true);
    }
    default:
      return 'neutral';
  }
}

// ---------------------------------------------------------------------------
// Policies (first match wins)
// ---------------------------------------------------------------------------

/**
 * Whether policy p, applied in place of any of the `later` policies (or of plain tracking when
 * none applies), is never weaker. Equal severities are compared parameter by parameter: a short
 * delay placed before a long one is a weakening.
 */
function dominates(p: Policy, later: Policy[]): boolean {
  if (severityOf(p.intervention) < SEVERITY.track) return false;
  return later.every((q) => compareInterventions(q.intervention, p.intervention) !== 'weaken');
}

/** `dayStart`: minutes after midnight at which the logical days of the schedules begin. */
export function comparePolicies(oldList: Policy[], newList: Policy[], dayStart = 0): Direction {
  if (deepEqual(oldList, newList)) return 'neutral';
  const oldById = new Map(oldList.map((p) => [p.id, p]));
  const newIds = new Set(newList.map((p) => p.id));
  // Relative order of the policies kept must not change.
  const keptOld = oldList.filter((p) => newIds.has(p.id)).map((p) => p.id);
  const keptNew = newList.filter((p) => oldById.has(p.id)).map((p) => p.id);
  if (!deepEqual(keptOld, keptNew)) return 'weaken';

  const dirs: Direction[] = [];
  for (const p of oldList) {
    if (!newIds.has(p.id)) dirs.push(severityOf(p.intervention) <= SEVERITY.track ? 'strengthen' : 'weaken');
  }
  newList.forEach((p, i) => {
    const later = newList.slice(i + 1);
    const old = oldById.get(p.id);
    if (!old) {
      dirs.push(dominates(p, later) ? 'strengthen' : 'weaken');
      return;
    }
    if (deepEqual(old, p)) return;
    const icmp = compareInterventions(old.intervention, p.intervention);
    const cov = compareConditions(old, p, dayStart);
    if (cov === 'equal') dirs.push(icmp);
    else if (cov === 'superset' && icmp !== 'weaken' && dominates(p, later)) dirs.push('strengthen');
    else if (cov === 'subset' && severityOf(old.intervention) <= SEVERITY.track && icmp !== 'weaken')
      dirs.push('strengthen');
    else dirs.push('weaken');
  });
  return combine(dirs);
}

/**
 * A rule never restricts the page it redirects to. A condition that now redirects to a
 * page inside the rule's own sites therefore lets that page through, whatever the ladder says.
 */
function redirectsIntoOwnSites(config: Config, groupId: string, base: Policy[], value: Policy[]): boolean {
  const g = config.groups.find((x) => x.id === groupId);
  if (!g) return false;
  const oldById = new Map(base.map((p) => [p.id, p]));
  let index: ReturnType<typeof compileTargets> | null = null;
  return value.some((p) => {
    if (p.intervention.type !== 'redirect') return false;
    const old = oldById.get(p.id)?.intervention;
    if (old?.type === 'redirect' && redirectKey(old.url) === redirectKey(p.intervention.url)) return false;
    const url = parseUrl(redirectDestination(p.intervention.url));
    index ??= compileTargets(g.targets);
    const { winner } = url ? index.winner(url) : { winner: null };
    return Boolean(winner && !winner.allow);
  });
}

// ---------------------------------------------------------------------------
// Pauses, options, costs
// ---------------------------------------------------------------------------

export function costRank(c: Cost): number {
  switch (c.type) {
    case 'none':
      return 0;
    case 'confirm':
      return 1;
    case 'delay':
      return 2 + Math.min(c.seconds, 3600) / 10_000;
    case 'challenge':
      return 3 + Math.min(c.length ?? 0, 1000) / 10_000;
    case 'password':
      return 4;
  }
}

export function comparePause(a: PausePolicy, b: PausePolicy): Direction {
  if (deepEqual(a, b)) return 'neutral';
  if (!a.allowed && !b.allowed) return 'neutral';
  if (a.allowed !== b.allowed) return b.allowed ? 'weaken' : 'strengthen';
  const dirs: Direction[] = [cmpNum(a.maxMinutes, b.maxMinutes, false)];
  if (
    !samePeriod(a.limit.period, b.limit.period) &&
    (a.limit.count !== undefined || a.limit.minutes !== undefined)
  ) {
    dirs.push('weaken');
  }
  dirs.push(cmpLimit(a.limit.count, b.limit.count), cmpLimit(a.limit.minutes, b.limit.minutes));
  dirs.push(cmpNum(costRank(a.cost), costRank(b.cost), true));
  if (a.cost.type === 'challenge' && b.cost.type === 'challenge' && a.cost.kind !== b.cost.kind)
    dirs.push('weaken');
  return combine(dirs);
}

export function compareOptions(a: GroupOptions, b: GroupOptions): Direction {
  const dirs: Direction[] = [];
  if (a.privacy !== b.privacy) dirs.push(b.privacy === 'all' ? 'strengthen' : 'weaken');
  dirs.push(cmpBool(a.embeds, b.embeds, true));
  if (a.tabs !== b.tabs) dirs.push(b.tabs === 'all' ? 'strengthen' : 'weaken');
  return combine(dirs);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const NEUTRAL_SETTINGS = [
  'language',
  'theme',
  'highContrast',
  'hour12',
  'dateFormat',
  'timer.',
  'badge.',
  'contextMenu',
  'notifications.',
  'warningSeconds',
  'sound',
  'tracking.retentionDays',
  'tracking.allSites',
  'interventions.hideUrl',
  'interventions.customCss',
  'interventions.autoReopen',
  'later.',
  'diagnostics.',
  'onboarded',
  'protection.confirmHours',
];

/**
 * Settings of the protection itself (the browser's pages, the emergency exit, the clock check):
 * loosening one waits as long as the emergency exit, whatever the protections of the rules.
 */
export const GUARD_SETTINGS: readonly string[] = [
  'protection.internalPages',
  'protection.internalPagesFollowPause',
  'protection.emergencyHours',
  'clock.useDateHeaders',
];

export function classifySetting(path: string, base: unknown, value: unknown): Direction {
  if (deepEqual(base, value)) return 'neutral';
  if (NEUTRAL_SETTINGS.some((p) => (p.endsWith('.') ? path.startsWith(p) : path === p))) return 'neutral';
  const n = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const b = (v: unknown) => Boolean(v);
  switch (path) {
    // Time stops counting after this much inactivity: a shorter delay counts less.
    case 'tracking.idleSeconds':
      return cmpNum(n(base), n(value), true);
    case 'tracking.visitGapMinutes':
    case 'interventions.graceSeconds':
      return cmpNum(n(base), n(value), false);
    case 'tracking.idleEnabled':
      return cmpBool(b(base), b(value), false);
    case 'tracking.countAudio':
    case 'tracking.countInactive':
    case 'clock.useDateHeaders':
      return cmpBool(b(base), b(value), true);
    case 'protection.emergencyHours':
      return cmpNum(n(base), n(value), true);
    case 'protection.internalPagesFollowPause':
      return cmpBool(b(base), b(value), false);
    case 'protection.internalPages': {
      const rank = { never: 0, auto: 1, always: 2 } as Record<string, number>;
      return cmpNum(rank[String(base)], rank[String(value)], true);
    }
    case 'pauseLimit': {
      const a = base as PausePolicy['limit'];
      const c = value as PausePolicy['limit'];
      const dirs = [cmpLimit(a?.count, c?.count), cmpLimit(a?.minutes, c?.minutes)];
      if (a && c && !samePeriod(a.period, c.period)) dirs.push('weaken');
      return combine(dirs);
    }
    default:
      return 'weaken';
  }
}

/** Setting paths compared as a whole rather than leaf by leaf. */
const ATOMIC_SETTINGS = new Set(['pauseLimit']);

function flattenSettings(
  obj: unknown,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj) && !ATOMIC_SETTINGS.has(prefix.slice(0, -1))) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>))
      flattenSettings(v, `${prefix}${k}.`, out);
  } else {
    out[prefix.slice(0, -1)] = obj;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function diffTargets(owner: Owner, ownerName: string, a: Target[], b: Target[], units: ChangeUnit[]) {
  const oldById = new Map(a.map((t) => [t.id, t]));
  const newById = new Map(b.map((t) => [t.id, t]));
  for (const t of a) {
    const n = newById.get(t.id);
    if (!n) units.push({ kind: 'target.remove', owner, ownerName, target: t });
    else if (n.type !== t.type || n.value !== t.value || Boolean(n.allow) !== Boolean(t.allow)) {
      units.push({ kind: 'target.remove', owner, ownerName, target: t });
      units.push({ kind: 'target.add', owner, ownerName, target: n });
    }
  }
  for (const t of b) if (!oldById.has(t.id)) units.push({ kind: 'target.add', owner, ownerName, target: t });
}

export function diffConfig(a: Config, b: Config): ChangeUnit[] {
  const units: ChangeUnit[] = [];
  const oldGroups = new Map(a.groups.map((g) => [g.id, g]));
  const newGroups = new Map(b.groups.map((g) => [g.id, g]));

  for (const g of a.groups) {
    if (!newGroups.has(g.id)) units.push({ kind: 'group.remove', groupId: g.id, name: g.name, base: g });
  }
  for (const n of b.groups) {
    const o = oldGroups.get(n.id);
    if (!o) {
      units.push({ kind: 'group.add', group: n });
      continue;
    }
    const field = (f: GroupField, ov: unknown, nv: unknown) => {
      if (!deepEqual(ov, nv)) {
        units.push({
          kind: 'group.field',
          groupId: n.id,
          name: n.name,
          field: f,
          value: clone(nv),
          base: clone(ov),
        });
      }
    };
    field(
      'meta',
      { name: o.name, color: o.color, icon: o.icon },
      { name: n.name, color: n.color, icon: n.icon },
    );
    field('note', o.note, n.note);
    field('message', o.message, n.message);
    field('enabled', o.enabled, n.enabled);
    field('archived', o.archived, n.archived);
    field('policies', o.policies, n.policies);
    field('pause', o.pause, n.pause);
    field('protection', o.protection, n.protection);
    field('options', o.options, n.options);
    diffTargets({ kind: 'group', id: n.id }, n.name, o.targets, n.targets, units);
  }

  const oldOrder = a.groups.map((g) => g.id).filter((id) => newGroups.has(id));
  const newOrder = b.groups.map((g) => g.id).filter((id) => oldGroups.has(id));
  if (!deepEqual(oldOrder, newOrder)) units.push({ kind: 'order', ids: b.groups.map((g) => g.id) });

  const fa = flattenSettings(a.settings);
  const fb = flattenSettings(b.settings);
  for (const path of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (!deepEqual(fa[path], fb[path]))
      units.push({ kind: 'setting', path, value: clone(fb[path]), base: clone(fa[path]) });
  }
  return units;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function groupIsActive(c: Config, id: string): boolean {
  const g = c.groups.find((x) => x.id === id);
  return Boolean(g && isGroupActive(g));
}

/** Classifies a unit against the configuration it applies to. */
export function classify(unit: ChangeUnit, config: Config): Direction {
  switch (unit.kind) {
    case 'group.add':
      return 'strengthen';
    case 'group.remove':
      return groupIsActive(config, unit.groupId) ? 'weaken' : 'neutral';
    case 'group.field': {
      const active = groupIsActive(config, unit.groupId);
      switch (unit.field) {
        case 'meta':
        case 'note':
        case 'message':
          return 'neutral';
        case 'enabled': {
          const g = config.groups.find((x) => x.id === unit.groupId);
          if (g?.archived) return 'neutral';
          return cmpBool(unit.base as boolean, unit.value as boolean, true);
        }
        case 'archived': {
          const g = config.groups.find((x) => x.id === unit.groupId);
          if (g && !g.enabled) return 'neutral';
          return cmpBool(unit.base as boolean, unit.value as boolean, false);
        }
        case 'policies': {
          if (!active) return 'neutral';
          const dir = comparePolicies(
            unit.base as Policy[],
            unit.value as Policy[],
            config.settings.dayStart,
          );
          return dir !== 'weaken' &&
            redirectsIntoOwnSites(config, unit.groupId, unit.base as Policy[], unit.value as Policy[])
            ? 'weaken'
            : dir;
        }
        case 'pause':
          return active ? comparePause(unit.base as PausePolicy, unit.value as PausePolicy) : 'neutral';
        case 'protection':
          return active ? compareProtection(unit.base as Protection, unit.value as Protection) : 'neutral';
        case 'options':
          return active ? compareOptions(unit.base as GroupOptions, unit.value as GroupOptions) : 'neutral';
      }
      return 'weaken';
    }
    case 'target.add':
      if (!groupIsActive(config, unit.owner.id)) return 'neutral';
      return unit.target.allow ? 'weaken' : 'strengthen';
    case 'target.remove':
      if (!groupIsActive(config, unit.owner.id)) return 'neutral';
      return unit.target.allow ? 'strengthen' : 'weaken';
    case 'order':
      return 'neutral';
    case 'setting':
      return classifySetting(unit.path, unit.base, unit.value);
  }
}

/**
 * The rules a unit changes, whose protection governs it: its own rule, or every active rule for
 * a setting. A unit that changes no rule has no protection to follow.
 */
export function unitGroups(unit: ChangeUnit, config: Config): string[] {
  switch (unit.kind) {
    case 'group.remove':
    case 'group.field':
      return [unit.groupId];
    case 'target.add':
    case 'target.remove':
      return [unit.owner.id];
    case 'setting':
      return config.groups.filter(isGroupActive).map((g) => g.id);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

function setPath(obj: Record<string, any>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = clone(value);
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const p of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Whether a unit (e.g. a pending change) no longer applies to the current configuration. */
export function isStale(unit: ChangeUnit, config: Config): boolean {
  const group = (id: string) => config.groups.find((g) => g.id === id);
  switch (unit.kind) {
    case 'group.add':
      return Boolean(group(unit.group.id));
    case 'group.remove':
      return !group(unit.groupId);
    case 'group.field': {
      const g = group(unit.groupId);
      if (!g || !(GROUP_FIELDS as readonly string[]).includes(unit.field)) return true;
      const current =
        unit.field === 'meta'
          ? { name: g.name, color: g.color, icon: g.icon }
          : (g as unknown as Record<string, unknown>)[unit.field];
      return !deepEqual(current, unit.base);
    }
    case 'target.add':
    case 'target.remove': {
      // A pending unit of an earlier version may change a shared list or Always allowed.
      const list = unit.owner.kind === 'group' ? group(unit.owner.id)?.targets : undefined;
      if (!list) return true;
      const exists = list.some((t) => t.id === unit.target.id);
      return unit.kind === 'target.add' ? exists : !exists;
    }
    case 'order':
      return false;
    case 'setting':
      return !deepEqual(getPath(config.settings, unit.path), unit.base);
    default:
      // The kinds of earlier versions: shared lists, their links to rules and notes of sites.
      return true;
  }
}

/** Applies units to a copy of the configuration. Entity revisions are bumped. */
export function applyUnits(config: Config, units: ChangeUnit[], now: number): Config {
  const c: Config = clone(config);
  const touchGroup = (g: Group) => {
    g.rev += 1;
    g.updatedAt = now;
  };
  for (const unit of units) {
    switch (unit.kind) {
      case 'group.add':
        if (!c.groups.some((g) => g.id === unit.group.id))
          c.groups.push({ ...clone(unit.group), updatedAt: now });
        c.tombstones = c.tombstones.filter((t) => t.id !== unit.group.id);
        break;
      case 'group.remove':
        c.groups = c.groups.filter((g) => g.id !== unit.groupId);
        c.tombstones.push({ id: unit.groupId, kind: 'group', deletedAt: now });
        break;
      case 'group.field': {
        const g = c.groups.find((x) => x.id === unit.groupId);
        if (!g) break;
        if (unit.field === 'meta') Object.assign(g, clone(unit.value));
        else (g as unknown as Record<string, unknown>)[unit.field] = clone(unit.value);
        touchGroup(g);
        break;
      }
      case 'target.add':
      case 'target.remove': {
        const g = c.groups.find((x) => x.id === unit.owner.id);
        if (!g) break;
        const i = g.targets.findIndex((t) => t.id === unit.target.id);
        if (unit.kind === 'target.add' && i === -1) g.targets.push(clone(unit.target));
        if (unit.kind === 'target.remove' && i !== -1) g.targets.splice(i, 1);
        touchGroup(g);
        break;
      }
      case 'order': {
        const pos = new Map(unit.ids.map((id, i) => [id, i]));
        c.groups.sort((x, y) => (pos.get(x.id) ?? 1e9) - (pos.get(y.id) ?? 1e9));
        break;
      }
      case 'setting':
        setPath(c.settings as unknown as Record<string, any>, unit.path, unit.value);
        break;
    }
  }
  return c;
}

/** Quick check used by editors: does an entry list contain exceptions that are never used? */
export function unusedExceptions(targets: Target[]): Target[] {
  const blocks = targets.filter((t) => !t.allow);
  if (!blocks.length) return targets.filter((t) => t.allow);
  const index = compileTargets(blocks);
  return targets.filter((t) => {
    if (!t.allow || t.type === 'regex' || t.type === 'wildcard') return false;
    const host = t.value.split(/[/?#]/)[0].replace(/\*\./g, 'x.');
    return !index.all.some(
      (cp) => !cp.host || host === cp.host || host.endsWith(`.${cp.host}`) || cp.host.endsWith(`.${host}`),
    );
  });
}
