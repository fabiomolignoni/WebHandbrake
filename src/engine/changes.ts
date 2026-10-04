/**
 * Configuration changes as small units, automatically classified as strengthening, neutral or
 * weakening (PRO-02). Strengthening units are always applied immediately; weakening units go
 * through the protection rules (cost, cooling-off, lock).
 *
 * The classifier is deliberately conservative: when it cannot prove that a change is stricter
 * it treats it as weakening.
 */

import { compileTargets } from './compile';
import { SEVERITY, severityOf } from './decide';
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
  ProtectionLevel,
  Schedule,
  SharedList,
  Target,
  TimeWindow,
} from './types';

export type Owner = { kind: 'group'; id: string } | { kind: 'list'; id: string } | { kind: 'allowlist' };

export type GroupField =
  | 'meta'
  | 'note'
  | 'message'
  | 'enabled'
  | 'archived'
  | 'policies'
  | 'pause'
  | 'protection'
  | 'protectionUntil'
  | 'options';

export type ChangeUnit =
  | { kind: 'group.add'; group: Group }
  | { kind: 'group.remove'; groupId: string; name: string; base: Group }
  | { kind: 'group.field'; groupId: string; name: string; field: GroupField; value: unknown; base: unknown }
  | {
      kind: 'group.link';
      groupId: string;
      name: string;
      listId: string;
      listName: string;
      link: boolean;
      /**
       * Entries of the list as they will be once the unit applies (the proposed list for a link,
       * the current one for an unlink): a list created or edited in the same save must be judged
       * by its new content.
       */
      targets?: Target[];
    }
  | { kind: 'target.add'; owner: Owner; ownerName: string; target: Target }
  | { kind: 'target.remove'; owner: Owner; ownerName: string; target: Target }
  | { kind: 'target.note'; owner: Owner; ownerName: string; target: Target; base: string | undefined }
  | { kind: 'list.add'; list: SharedList }
  | { kind: 'list.remove'; listId: string; name: string; base: SharedList }
  | { kind: 'list.name'; listId: string; value: string; base: string }
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

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export const LEVEL_RANK: Record<ProtectionLevel, number> = { soft: 0, balanced: 1, strict: 2, locked: 3 };

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

const WEEK_MINUTES = 7 * 1440;

/** Week bitmap (minute resolution) of when a schedule is active, assuming midnight day start. */
export function scheduleBitmap(s: Schedule): Uint8Array {
  const bits = new Uint8Array(WEEK_MINUTES);
  if (s.mode === 'always') return bits.fill(1);
  const mark = (w: TimeWindow) => {
    for (const day of w.days) {
      const start = day * 1440 + w.start;
      const full = (w.start === 0 && w.end >= 1440) || w.start === w.end;
      let len = full ? 1440 : (w.end % 1440) - w.start;
      if (!full && len <= 0) len += 1440;
      for (let i = 0; i < len; i++) bits[(start + i) % WEEK_MINUTES] = 1;
    }
  };
  s.windows.forEach(mark);
  if (s.mode === 'outside') for (let i = 0; i < bits.length; i++) bits[i] = bits[i] ? 0 : 1;
  return bits;
}

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

/** Coverage of the new schedule relative to the old one. */
export function compareSchedules(oldS: Schedule, newS: Schedule): Coverage {
  return compareSets(scheduleBitmap(oldS), scheduleBitmap(newS));
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
      return fromDirs([
        cmpNum(oldB.count, n.count, false),
        cmpLimit(oldB.maxVisitMinutes, n.maxVisitMinutes),
      ]);
    }
    case 'session': {
      const n = newB as typeof oldB;
      return fromDirs([
        cmpNum(oldB.maxMinutes, n.maxMinutes, false),
        cmpNum(oldB.cooldownMinutes, n.cooldownMinutes, true),
      ]);
    }
  }
}

function compareConditions(oldP: Policy, newP: Policy): Coverage {
  const s = compareSchedules(oldP.schedule, newP.schedule);
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

/** Direction of the change from intervention a to b. */
export function compareInterventions(a: Intervention, b: Intervention): Direction {
  const sa = severityOf(a);
  const sb = severityOf(b);
  if (sa !== sb) return sb > sa ? 'strengthen' : 'weaken';
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
      if (a.kind !== n.kind || a.charset !== n.charset || (a.kind === 'phrase' && a.phrase !== n.phrase)) {
        return 'weaken';
      }
      return combine([cmpNum(a.length, n.length, true), compareGrant(a.grant, n.grant)]);
    }
    case 'ask': {
      const n = b as typeof a;
      return combine([
        cmpNum(a.maxMinutes, n.maxMinutes, false),
        cmpNum(Math.max(0, ...a.choices), Math.max(0, ...n.choices), false),
        cmpBool(a.requireIntention, n.requireIntention, true),
        cmpNum(a.cooldownMinutes, n.cooldownMinutes, true),
      ]);
    }
    case 'filter': {
      const n = b as typeof a;
      if (a.filter !== n.filter || a.css !== n.css) return 'weaken';
      return combine([cmpNum(a.intensity ?? 100, n.intensity ?? 100, true), cmpBool(a.mute, n.mute, true)]);
    }
    default:
      return 'neutral';
  }
}

// ---------------------------------------------------------------------------
// Policies (first match wins)
// ---------------------------------------------------------------------------

export function comparePolicies(oldList: Policy[], newList: Policy[]): Direction {
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
    const laterMax = Math.max(SEVERITY.track, ...newList.slice(i + 1).map((q) => severityOf(q.intervention)));
    const old = oldById.get(p.id);
    if (!old) {
      dirs.push(severityOf(p.intervention) >= laterMax ? 'strengthen' : 'weaken');
      return;
    }
    if (deepEqual(old, p)) return;
    const icmp = compareInterventions(old.intervention, p.intervention);
    const cov = compareConditions(old, p);
    if (cov === 'equal') dirs.push(icmp);
    else if (cov === 'superset' && icmp !== 'weaken' && severityOf(p.intervention) >= laterMax)
      dirs.push('strengthen');
    else if (cov === 'subset' && severityOf(old.intervention) <= SEVERITY.track && icmp !== 'weaken')
      dirs.push('strengthen');
    else dirs.push('weaken');
  });
  return combine(dirs);
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

const REASON_RANK = { none: 0, optional: 1, required: 2 } as const;

export function comparePause(a: PausePolicy, b: PausePolicy): Direction {
  if (deepEqual(a, b)) return 'neutral';
  if (!a.allowed && !b.allowed) return 'neutral';
  if (a.allowed !== b.allowed) return b.allowed ? 'weaken' : 'strengthen';
  const dirs: Direction[] = [cmpBool(a.duringSessions, b.duringSessions, false)];
  const scopesA = new Set(a.scopes);
  const scopesB = new Set(b.scopes);
  if ([...scopesB].some((s) => !scopesA.has(s))) dirs.push('weaken');
  else if ([...scopesA].some((s) => !scopesB.has(s))) dirs.push('strengthen');
  const maxA = Math.max(
    a.duration.minutes,
    ...(a.duration.mode === 'choices' ? (a.duration.choices ?? []) : []),
  );
  const maxB = Math.max(
    b.duration.minutes,
    ...(b.duration.mode === 'choices' ? (b.duration.choices ?? []) : []),
  );
  dirs.push(cmpNum(maxA, maxB, false));
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
  dirs.push(cmpNum(REASON_RANK[a.reason], REASON_RANK[b.reason], true));
  dirs.push(cmpBool(a.metered, b.metered, false));
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
  'accent',
  'hour12',
  'dateFormat',
  'advanced',
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
  'interventions.alternatives',
  'interventions.autoReopen',
  'later.',
  'diagnostics.',
  'onboarded',
  'protection.confirmHours',
];

function windowsCoverage(a: TimeWindow[], b: TimeWindow[]): Coverage {
  return compareSchedules({ mode: 'during', windows: a }, { mode: 'during', windows: b });
}

export function classifySetting(path: string, base: unknown, value: unknown): Direction {
  if (deepEqual(base, value)) return 'neutral';
  if (NEUTRAL_SETTINGS.some((p) => (p.endsWith('.') ? path.startsWith(p) : path === p))) return 'neutral';
  const n = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const b = (v: unknown) => Boolean(v);
  switch (path) {
    case 'tracking.idleSeconds':
    case 'tracking.visitGapMinutes':
    case 'interventions.graceSeconds':
      return cmpNum(n(base), n(value), false);
    case 'tracking.idleEnabled':
      return cmpBool(b(base), b(value), false);
    case 'tracking.countAudio':
    case 'tracking.countInactive':
    case 'clock.useDateHeaders':
      return cmpBool(b(base), b(value), true);
    case 'protection.coolingOffHours':
    case 'protection.emergencyHours':
    case 'protection.balancedDelaySeconds':
    case 'protection.challengeLength':
    case 'protection.access.codeLength':
      return cmpNum(n(base), n(value), true);
    case 'protection.internalPagesFollowPause':
      return cmpBool(b(base), b(value), false);
    case 'protection.internalPages': {
      const rank = { never: 0, auto: 1, always: 2 } as Record<string, number>;
      return cmpNum(rank[String(base)], rank[String(value)], true);
    }
    case 'protection.level':
    case 'protection.fallback':
      return cmpNum(LEVEL_RANK[base as ProtectionLevel], LEVEL_RANK[value as ProtectionLevel], true);
    case 'protection.lockedUntil':
      return cmpNum(n(base) ?? 0, n(value) ?? 0, true);
    case 'protection.access.passwordHash':
      if (!base && value) return 'strengthen';
      if (base && !value) return 'weaken';
      return 'neutral';
    case 'protection.access.lockWindows': {
      const c = windowsCoverage((base as TimeWindow[]) ?? [], (value as TimeWindow[]) ?? []);
      return c === 'superset' ? 'strengthen' : c === 'equal' ? 'neutral' : 'weaken';
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
const ATOMIC_SETTINGS = new Set([
  'pauseLimit',
  'protection.access.lockWindows',
  'interventions.alternatives',
]);

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
    } else if ((n.note ?? '') !== (t.note ?? '')) {
      units.push({ kind: 'target.note', owner, ownerName, target: n, base: t.note });
    }
  }
  for (const t of b) if (!oldById.has(t.id)) units.push({ kind: 'target.add', owner, ownerName, target: t });
}

export function diffConfig(a: Config, b: Config): ChangeUnit[] {
  const units: ChangeUnit[] = [];
  const oldGroups = new Map(a.groups.map((g) => [g.id, g]));
  const newGroups = new Map(b.groups.map((g) => [g.id, g]));
  const listName = (c: Config, id: string) => c.lists.find((l) => l.id === id)?.name ?? '';

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
    field('protectionUntil', o.protectionUntil ?? null, n.protectionUntil ?? null);
    field('options', o.options, n.options);
    diffTargets({ kind: 'group', id: n.id }, n.name, o.targets, n.targets, units);
    for (const id of o.lists) {
      if (!n.lists.includes(id)) {
        units.push({
          kind: 'group.link',
          groupId: n.id,
          name: n.name,
          listId: id,
          listName: listName(a, id),
          link: false,
          targets: clone(a.lists.find((l) => l.id === id)?.targets ?? []),
        });
      }
    }
    for (const id of n.lists) {
      if (!o.lists.includes(id)) {
        units.push({
          kind: 'group.link',
          groupId: n.id,
          name: n.name,
          listId: id,
          listName: listName(b, id),
          link: true,
          targets: clone(b.lists.find((l) => l.id === id)?.targets ?? []),
        });
      }
    }
  }

  const oldLists = new Map(a.lists.map((l) => [l.id, l]));
  const newLists = new Map(b.lists.map((l) => [l.id, l]));
  for (const l of a.lists)
    if (!newLists.has(l.id)) units.push({ kind: 'list.remove', listId: l.id, name: l.name, base: l });
  for (const l of b.lists) {
    const o = oldLists.get(l.id);
    if (!o) {
      units.push({ kind: 'list.add', list: l });
      continue;
    }
    if (o.name !== l.name) units.push({ kind: 'list.name', listId: l.id, value: l.name, base: o.name });
    diffTargets({ kind: 'list', id: l.id }, l.name, o.targets, l.targets, units);
  }

  diffTargets({ kind: 'allowlist' }, '', a.allowlist, b.allowlist, units);

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
  return Boolean(g?.enabled && !g.archived);
}

function listIsUsed(c: Config, listId: string): boolean {
  return c.groups.some((g) => g.enabled && !g.archived && g.lists.includes(listId));
}

function ownerActive(c: Config, owner: Owner): boolean {
  if (owner.kind === 'group') return groupIsActive(c, owner.id);
  if (owner.kind === 'list') return listIsUsed(c, owner.id);
  return true;
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
        case 'policies':
          return active ? comparePolicies(unit.base as Policy[], unit.value as Policy[]) : 'neutral';
        case 'pause':
          return active ? comparePause(unit.base as PausePolicy, unit.value as PausePolicy) : 'neutral';
        case 'protection': {
          const global = config.settings.protection.level;
          const a = (unit.base as ProtectionLevel | null) ?? global;
          const b = (unit.value as ProtectionLevel | null) ?? global;
          return cmpNum(LEVEL_RANK[a], LEVEL_RANK[b], true);
        }
        case 'protectionUntil':
          return cmpNum((unit.base as number | null) ?? 0, (unit.value as number | null) ?? 0, true);
        case 'options':
          return active ? compareOptions(unit.base as GroupOptions, unit.value as GroupOptions) : 'neutral';
      }
      return 'weaken';
    }
    case 'group.link': {
      if (!groupIsActive(config, unit.groupId)) return 'neutral';
      const targets = unit.targets ?? config.lists.find((l) => l.id === unit.listId)?.targets ?? [];
      const hasBlocks = targets.some((t) => !t.allow);
      const hasAllows = targets.some((t) => t.allow);
      if (unit.link) return hasAllows ? 'weaken' : hasBlocks ? 'strengthen' : 'neutral';
      return hasBlocks ? 'weaken' : hasAllows ? 'strengthen' : 'neutral';
    }
    case 'target.add':
      if (unit.owner.kind === 'allowlist') return 'weaken';
      if (!ownerActive(config, unit.owner)) return 'neutral';
      return unit.target.allow ? 'weaken' : 'strengthen';
    case 'target.remove':
      if (unit.owner.kind === 'allowlist') return 'strengthen';
      if (!ownerActive(config, unit.owner)) return 'neutral';
      return unit.target.allow ? 'strengthen' : 'weaken';
    case 'target.note':
    case 'list.add':
    case 'list.name':
    case 'order':
      return 'neutral';
    case 'list.remove':
      return listIsUsed(config, unit.listId) && unit.base.targets.some((t) => !t.allow)
        ? 'weaken'
        : 'neutral';
    case 'setting':
      return classifySetting(unit.path, unit.base, unit.value);
  }
}

/** Groups whose protection level governs a unit (empty: the global level). */
export function unitGroups(unit: ChangeUnit, config: Config): string[] {
  switch (unit.kind) {
    case 'group.remove':
    case 'group.field':
    case 'group.link':
      return [unit.groupId];
    case 'target.add':
    case 'target.remove':
    case 'target.note':
      if (unit.owner.kind === 'group') return [unit.owner.id];
      if (unit.owner.kind === 'list') {
        const id = unit.owner.id;
        return config.groups.filter((g) => g.lists.includes(id)).map((g) => g.id);
      }
      return [];
    case 'list.remove':
      return config.groups.filter((g) => g.lists.includes(unit.listId)).map((g) => g.id);
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
      if (!g) return true;
      const current =
        unit.field === 'meta'
          ? { name: g.name, color: g.color, icon: g.icon }
          : (g as unknown as Record<string, unknown>)[unit.field];
      return !deepEqual(current, unit.base);
    }
    case 'group.link': {
      const g = group(unit.groupId);
      return !g || g.lists.includes(unit.listId) === unit.link;
    }
    case 'target.add':
    case 'target.remove':
    case 'target.note': {
      const list = ownerTargets(config, unit.owner);
      if (!list) return true;
      const exists = list.some((t) => t.id === unit.target.id);
      return unit.kind === 'target.add' ? exists : !exists;
    }
    case 'list.add':
      return config.lists.some((l) => l.id === unit.list.id);
    case 'list.remove':
    case 'list.name':
      return !config.lists.some((l) => l.id === unit.listId);
    case 'order':
      return false;
    case 'setting':
      return !deepEqual(getPath(config.settings, unit.path), unit.base);
  }
}

function ownerTargets(config: Config, owner: Owner): Target[] | null {
  if (owner.kind === 'allowlist') return config.allowlist;
  if (owner.kind === 'group') return config.groups.find((g) => g.id === owner.id)?.targets ?? null;
  return config.lists.find((l) => l.id === owner.id)?.targets ?? null;
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
      case 'group.link': {
        const g = c.groups.find((x) => x.id === unit.groupId);
        if (!g) break;
        g.lists = unit.link
          ? [...new Set([...g.lists, unit.listId])]
          : g.lists.filter((id) => id !== unit.listId);
        touchGroup(g);
        break;
      }
      case 'target.add':
      case 'target.remove':
      case 'target.note': {
        const list = ownerTargets(c, unit.owner);
        if (!list) break;
        const i = list.findIndex((t) => t.id === unit.target.id);
        if (unit.kind === 'target.add' && i === -1) list.push(clone(unit.target));
        if (unit.kind === 'target.remove' && i !== -1) list.splice(i, 1);
        if (unit.kind === 'target.note' && i !== -1) list[i] = clone(unit.target);
        if (unit.owner.kind === 'group') {
          const g = c.groups.find((x) => x.id === (unit.owner as { id: string }).id);
          if (g) touchGroup(g);
        } else if (unit.owner.kind === 'list') {
          const l = c.lists.find((x) => x.id === (unit.owner as { id: string }).id);
          if (l) {
            l.rev += 1;
            l.updatedAt = now;
          }
        }
        break;
      }
      case 'list.add':
        if (!c.lists.some((l) => l.id === unit.list.id)) c.lists.push(clone(unit.list));
        break;
      case 'list.remove':
        c.lists = c.lists.filter((l) => l.id !== unit.listId);
        for (const g of c.groups) g.lists = g.lists.filter((id) => id !== unit.listId);
        c.tombstones.push({ id: unit.listId, kind: 'list', deletedAt: now });
        break;
      case 'list.name': {
        const l = c.lists.find((x) => x.id === unit.listId);
        if (l) {
          l.name = unit.value;
          l.rev += 1;
          l.updatedAt = now;
        }
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
    if (!t.allow || t.type === 'regex') return false;
    const host = t.value.split(/[/?#]/)[0].replace(/\*\./g, 'x.');
    return !index.all.some(
      (cp) => !cp.host || host === cp.host || host.endsWith(`.${cp.host}`) || cp.host.endsWith(`.${host}`),
    );
  });
}
