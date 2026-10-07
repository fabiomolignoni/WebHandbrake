/**
 * Validation and normalisation of stored and imported configurations (SEC-04, DAT-07).
 * Normalisation fills missing fields with defaults and drops invalid entries, but never removes
 * unknown fields (forward compatibility with newer versions and future sync).
 */

import {
  DEFAULT_ACCENT,
  defaultConfig,
  defaultOptions,
  defaultSettings,
  GROUP_COLORS,
  LEGACY_ACCENT,
  newId,
  pausePolicyFor,
} from './defaults';
import { checkRegex, compilePattern } from './patterns';
import {
  type Config,
  type Cost,
  type Group,
  type Intervention,
  type PausePolicy,
  type Period,
  type Policy,
  SCHEMA_VERSION,
  type Settings,
  type SharedList,
  type Target,
  type TimeWindow,
} from './types';

const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, def: number, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const str = (v: unknown, def = '', maxLen = 10_000) => (typeof v === 'string' ? v.slice(0, maxLen) : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const oneOf = <T extends string>(v: unknown, values: readonly T[], def: T): T =>
  values.includes(v as T) ? (v as T) : def;

/** Deep merge of defaults with stored values, keeping unknown keys of the stored object. */
function mergeDefaults<T>(def: T, raw: unknown): T {
  if (!isObj(def) || !isObj(raw))
    return (raw === undefined ? def : typeof raw === typeof def ? raw : def) as T;
  const out: Record<string, unknown> = { ...raw };
  for (const [k, v] of Object.entries(def as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = Array.isArray(raw[k]) ? raw[k] : v;
    else if (isObj(v)) out[k] = mergeDefaults(v, raw[k]);
    else if (v === null) out[k] = raw[k] === undefined ? null : raw[k];
    else out[k] = typeof raw[k] === typeof v ? raw[k] : v;
  }
  return out as T;
}

export function normalizeTarget(raw: unknown): Target | null {
  if (!isObj(raw)) return null;
  const type = oneOf(raw.type, ['domain', 'host', 'path', 'page', 'homepage', 'regex'] as const, 'domain');
  const value = str(raw.value, '', 2000).trim();
  if (!value) return null;
  if (type === 'regex' && checkRegex(value)) return null;
  const t: Target = { ...raw, id: str(raw.id) || newId(), type, value };
  if (raw.allow) t.allow = true;
  else delete t.allow;
  if (typeof raw.note === 'string' && raw.note) t.note = raw.note.slice(0, 500);
  else delete t.note;
  if (!compilePattern(t)) return null;
  return t;
}

function normalizeTargets(raw: unknown, errors: string[], where: string): Target[] {
  if (!Array.isArray(raw)) return [];
  const out: Target[] = [];
  for (const r of raw) {
    const t = normalizeTarget(r);
    if (t) out.push(t);
    else errors.push(`${where}: invalid entry ${JSON.stringify(r).slice(0, 80)}`);
  }
  return out;
}

export function normalizeWindows(raw: unknown): TimeWindow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((w) => ({
    days: Array.isArray(w.days)
      ? ([
          ...new Set(
            w.days.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6),
          ),
        ] as number[])
      : [],
    start: num(w.start, 0, 0, 1440),
    end: num(w.end, 1440, 0, 1440),
  }));
}

export function normalizePeriod(raw: unknown): Period {
  if (!isObj(raw)) return { kind: 'day' };
  const kind = oneOf(
    raw.kind,
    ['hour', 'day', 'week', 'month', 'minutes', 'days', 'rolling'] as const,
    'day',
  );
  const p: Period = { kind };
  if (kind === 'minutes' || kind === 'rolling') p.n = num(raw.n, 60, 5, 1440);
  if (kind === 'days') p.n = num(raw.n, 1, 1, 90);
  if ((kind === 'minutes' || kind === 'days') && typeof raw.offset === 'number')
    p.offset = num(raw.offset, 0, 0, 1440);
  return p;
}

function normalizeGrantSpec(raw: unknown) {
  const r = isObj(raw) ? raw : {};
  return {
    scope: oneOf(r.scope, ['page', 'site', 'group'] as const, 'site'),
    mode: oneOf(r.mode, ['visit', 'minutes'] as const, 'visit'),
    ...(typeof r.minutes === 'number' ? { minutes: num(r.minutes, 10, 1, 1440) } : {}),
  };
}

export function normalizeIntervention(raw: unknown): Intervention {
  if (!isObj(raw)) return { type: 'block' };
  switch (raw.type) {
    case 'allow':
    case 'track':
    case 'block':
    case 'close':
      return { type: raw.type };
    case 'remind':
      return { type: 'remind', ...(raw.message ? { message: str(raw.message, '', 1000) } : {}) };
    case 'filter':
      return {
        type: 'filter',
        filter: oneOf(
          raw.filter,
          ['grayscale', 'blur', 'fade', 'invert', 'sepia', 'custom', 'none'] as const,
          'grayscale',
        ),
        intensity: num(raw.intensity, 100, 0, 100),
        ...(raw.css ? { css: str(raw.css, '', 200) } : {}),
        mute: bool(raw.mute, false),
      };
    case 'ask': {
      const maxMinutes = num(raw.maxMinutes, 15, 1, 1440);
      const given: number[] = Array.isArray(raw.choices)
        ? raw.choices.filter((c: unknown) => typeof c === 'number' && c > 0 && c <= 1440).slice(0, 6)
        : [];
      // Only durations that can be granted: a choice above the maximum could never be picked.
      const choices = (given.length ? given : [5, 10, 15]).filter((c) => c <= maxMinutes);
      return {
        type: 'ask',
        seconds: num(raw.seconds, 0, 0, 600),
        choices: choices.length ? choices : [maxMinutes],
        maxMinutes,
        requireIntention: bool(raw.requireIntention, false),
        ...(typeof raw.cooldownMinutes === 'number' && raw.cooldownMinutes > 0
          ? { cooldownMinutes: num(raw.cooldownMinutes, 0, 1, 1440) }
          : {}),
      };
    }
    case 'delay':
      return {
        type: 'delay',
        seconds: num(raw.seconds, 30, 1, 3600),
        ...(typeof raw.randomTo === 'number' && raw.randomTo > 0
          ? { randomTo: num(raw.randomTo, 0, 1, 3600) }
          : {}),
        ...(typeof raw.increase === 'number' && raw.increase > 0
          ? { increase: num(raw.increase, 0, 1, 600) }
          : {}),
        autoContinue: bool(raw.autoContinue, false),
        onBlur: oneOf(raw.onBlur, ['pause', 'restart', 'ignore'] as const, 'pause'),
        hideCountdown: bool(raw.hideCountdown, false),
        grant: normalizeGrantSpec(raw.grant),
      };
    case 'challenge':
      return {
        type: 'challenge',
        kind: oneOf(raw.kind, ['random', 'phrase', 'math'] as const, 'random'),
        length: num(raw.length, 24, 4, 500),
        charset: oneOf(raw.charset, ['alnum', 'letters', 'digits', 'symbols'] as const, 'alnum'),
        ...(raw.phrase ? { phrase: str(raw.phrase, '', 500) } : {}),
        grant: normalizeGrantSpec(raw.grant),
      };
    case 'redirect':
      return { type: 'redirect', url: str(raw.url, 'about:blank', 2000) };
    default:
      return { type: 'block' };
  }
}

function normalizeBudget(raw: unknown): Policy['budget'] {
  if (!isObj(raw)) return undefined;
  switch (raw.type) {
    case 'time':
      return {
        type: 'time',
        minutes: num(raw.minutes, 30, 0.1, 90 * 1440),
        period: normalizePeriod(raw.period),
        perSite: bool(raw.perSite, false),
      };
    case 'visits':
      return {
        type: 'visits',
        count: Math.round(num(raw.count, 3, 0, 10_000)),
        period: normalizePeriod(raw.period),
        perSite: bool(raw.perSite, false),
        ...(typeof raw.maxVisitMinutes === 'number' && raw.maxVisitMinutes > 0
          ? { maxVisitMinutes: num(raw.maxVisitMinutes, 10, 0.5, 1440) }
          : {}),
      };
    case 'session':
      return {
        type: 'session',
        maxMinutes: num(raw.maxMinutes, 10, 0.5, 1440),
        cooldownMinutes: num(raw.cooldownMinutes, 30, 1, 10_080),
        perSite: bool(raw.perSite, false),
      };
    default:
      return undefined;
  }
}

export function normalizePolicy(raw: unknown): Policy | null {
  if (!isObj(raw)) return null;
  const sched = isObj(raw.schedule) ? raw.schedule : {};
  const p: Policy = {
    id: str(raw.id) || newId(),
    schedule: {
      mode: oneOf(sched.mode, ['always', 'during', 'outside'] as const, 'always'),
      windows: normalizeWindows(sched.windows),
    },
    intervention: normalizeIntervention(raw.intervention),
  };
  const budget = normalizeBudget(raw.budget);
  if (budget) p.budget = budget;
  return p;
}

const COST_TYPES = ['none', 'confirm', 'delay', 'challenge', 'password'] as const;
const PAUSE_SCOPES = ['page', 'site', 'group', 'all'] as const;

function normalizeCost(raw: unknown): Cost {
  const r = isObj(raw) ? raw : {};
  switch (oneOf(r.type, COST_TYPES, 'confirm')) {
    case 'none':
      return { type: 'none' };
    case 'delay':
      return { type: 'delay', seconds: num(r.seconds, 30, 1, 3600) };
    case 'challenge':
      return {
        type: 'challenge',
        kind: oneOf(r.kind, ['random', 'phrase', 'math'] as const, 'random'),
        length: num(r.length, 24, 4, 500),
        ...(typeof r.phrase === 'string' && r.phrase ? { phrase: r.phrase.slice(0, 500) } : {}),
      };
    case 'password':
      return { type: 'password' };
    default:
      return { type: 'confirm' };
  }
}

/**
 * Pause policy. Optional limits stay absent when absent: merging with the defaults would turn
 * "no limit" into the default limit.
 */
export function normalizePause(raw: unknown): PausePolicy {
  if (!isObj(raw)) return pausePolicyFor('balanced');
  const def = pausePolicyFor('balanced');
  const d = isObj(raw.duration) ? raw.duration : {};
  const l = isObj(raw.limit) ? raw.limit : {};
  const choices = Array.isArray(d.choices)
    ? d.choices.filter((c: unknown) => typeof c === 'number' && c > 0 && c <= 1440).slice(0, 6)
    : undefined;
  const scopes = Array.isArray(raw.scopes)
    ? [...new Set(raw.scopes.filter((x: unknown) => PAUSE_SCOPES.includes(x as never)))]
    : def.scopes;
  return {
    ...raw,
    allowed: bool(raw.allowed, def.allowed),
    duringSessions: bool(raw.duringSessions, def.duringSessions),
    scopes: scopes as PausePolicy['scopes'],
    duration: {
      mode: oneOf(d.mode, ['fixed', 'upTo', 'choices'] as const, def.duration.mode),
      minutes: num(d.minutes, def.duration.minutes, 1, 1440),
      ...(choices?.length ? { choices } : {}),
    },
    limit: {
      ...(typeof l.count === 'number' ? { count: Math.round(num(l.count, 0, 0, 1000)) } : {}),
      ...(typeof l.minutes === 'number' ? { minutes: num(l.minutes, 0, 0, 100_000) } : {}),
      period: normalizePeriod(l.period),
    },
    cost: normalizeCost(raw.cost),
    reason: oneOf(raw.reason, ['none', 'optional', 'required'] as const, def.reason),
    metered: bool(raw.metered, def.metered),
  } as PausePolicy;
}

export function normalizeGroup(raw: unknown, errors: string[], now = Date.now()): Group | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name, '', 200);
  const pause = normalizePause(raw.pause);
  const g: Group = {
    ...raw,
    id: str(raw.id) || newId(),
    rev: num(raw.rev, 1, 1),
    updatedAt: num(raw.updatedAt, now),
    name: name || 'Group',
    color: /^#[0-9a-f]{6}$/i.test(str(raw.color)) ? raw.color : GROUP_COLORS[0],
    icon: str(raw.icon, 'circle', 40),
    note: str(raw.note, '', 2000),
    message: str(raw.message, '', 5000),
    enabled: bool(raw.enabled, true),
    archived: bool(raw.archived, false),
    targets: normalizeTargets(raw.targets, errors, `group "${name}"`),
    lists: Array.isArray(raw.lists) ? raw.lists.filter((x: unknown) => typeof x === 'string') : [],
    policies: Array.isArray(raw.policies)
      ? (raw.policies.map(normalizePolicy).filter(Boolean) as Policy[])
      : [],
    pause,
    protection:
      raw.protection === null || raw.protection === undefined
        ? null
        : oneOf(raw.protection, ['soft', 'balanced', 'strict', 'locked'] as const, 'balanced'),
    options: mergeDefaults(defaultOptions(), raw.options),
  };
  return g;
}

function normalizeList(raw: unknown, errors: string[], now: number): SharedList | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name, 'List', 200);
  return {
    ...raw,
    id: str(raw.id) || newId(),
    rev: num(raw.rev, 1, 1),
    updatedAt: num(raw.updatedAt, now),
    name,
    targets: normalizeTargets(raw.targets, errors, `list "${name}"`),
  };
}

export function normalizeSettings(raw: unknown): Settings {
  const s = mergeDefaults(defaultSettings(), raw);
  s.dayStart = num(s.dayStart, 0, 0, 720);
  s.weekStart = Math.round(num(s.weekStart, 1, 0, 6));
  s.tracking.idleSeconds = num(s.tracking.idleSeconds, 120, 15, 3600);
  s.tracking.visitGapMinutes = num(s.tracking.visitGapMinutes, 5, 1, 240);
  s.tracking.retentionDays = num(s.tracking.retentionDays, 730, 7, 3650);
  s.interventions.graceSeconds = num(s.interventions.graceSeconds, 45, 0, 300);
  s.interventions.alternatives = Array.isArray(s.interventions.alternatives)
    ? s.interventions.alternatives.filter(isObj).map((a) => ({
        id: str(a.id) || newId(),
        label: str(a.label, '', 200),
        ...(a.url ? { url: str(a.url, '', 2000) } : {}),
      }))
    : [];
  s.protection.coolingOffHours = num(s.protection.coolingOffHours, 24, 1, 168);
  s.protection.emergencyHours = num(s.protection.emergencyHours, 24, 4, 168);
  s.protection.confirmHours = num(s.protection.confirmHours, 48, 1, 168);
  s.protection.access.lockWindows = normalizeWindows(s.protection.access.lockWindows);
  s.pauseLimit = { ...s.pauseLimit, period: normalizePeriod(s.pauseLimit?.period) };
  if (typeof s.accent !== 'string' || s.accent.toLowerCase() === LEGACY_ACCENT) s.accent = DEFAULT_ACCENT;
  return s;
}

/** Returns a valid configuration and the list of problems found (empty when everything was fine). */
export function normalizeConfig(raw: unknown, now = Date.now()): { config: Config; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { config: defaultConfig(), errors: ['not an object'] };
  const groups: Group[] = [];
  const ids = new Set<string>();
  for (const g of Array.isArray(raw.groups) ? raw.groups : []) {
    const n = normalizeGroup(g, errors, now);
    if (!n) {
      errors.push('invalid group');
      continue;
    }
    if (ids.has(n.id)) n.id = newId();
    ids.add(n.id);
    groups.push(n);
  }
  const lists = (Array.isArray(raw.lists) ? raw.lists : [])
    .map((l: unknown) => normalizeList(l, errors, now))
    .filter(Boolean) as SharedList[];
  const listIds = new Set(lists.map((l) => l.id));
  for (const g of groups) g.lists = g.lists.filter((id) => listIds.has(id));
  return {
    config: {
      ...raw,
      schema: SCHEMA_VERSION,
      groups,
      lists,
      allowlist: normalizeTargets(raw.allowlist, errors, 'allowlist'),
      settings: normalizeSettings(raw.settings),
      tombstones: Array.isArray(raw.tombstones) ? raw.tombstones.filter(isObj) : [],
    } as Config,
    errors,
  };
}

/** Structural check used to detect corrupted storage (DAT-03). */
export function looksLikeConfig(raw: unknown): boolean {
  return isObj(raw) && Array.isArray(raw.groups) && isObj(raw.settings) && typeof raw.schema === 'number';
}

/**
 * JSON with the keys of every object in alphabetical order. Chrome's storage returns objects with
 * sorted keys while Firefox keeps their order: a checksum must not depend on it.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

/** Checksum of a stored configuration (DAT-03), whatever the order of its keys. */
export function configChecksum(config: unknown): string {
  return checksum(canonicalJson(config));
}

/** Version of the checksum of the stored configuration: 2 = canonical JSON (configChecksum). */
export const CHECKSUM_VERSION = 2;

/**
 * Whether a stored configuration is intact. Checksums of version 2 cover canonical JSON. Earlier
 * ones covered the keys in the order they were written: checkable only where the storage keeps
 * that order (Firefox); in Chrome, which sorts the keys, they could never be checked.
 */
export function storedConfigIntact(
  stored: { data: unknown; sum?: unknown; v?: unknown },
  storageKeepsKeyOrder: boolean,
): boolean {
  if (stored.v === CHECKSUM_VERSION) return stored.sum === configChecksum(stored.data);
  if (stored.sum === checksum(JSON.stringify(stored.data))) return true;
  return !storageKeepsKeyOrder && typeof stored.sum === 'string';
}

/** FNV-1a checksum of a JSON string (integrity, not security). */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Migrations (DAT-07)
// ---------------------------------------------------------------------------

type Migration = (raw: Record<string, any>) => Record<string, any>;

/** migrations[n] upgrades schema n to n + 1. */
const MIGRATIONS: Record<number, Migration> = {};

export function migrate(raw: unknown): { data: unknown; from: number; migrated: boolean } {
  if (!isObj(raw)) return { data: raw, from: 0, migrated: false };
  const from = typeof raw.schema === 'number' ? raw.schema : 1;
  if (from > SCHEMA_VERSION) {
    // Written by a newer version: keep everything, unknown fields are preserved by normalisation.
    return { data: raw, from, migrated: false };
  }
  let data: Record<string, any> = JSON.parse(JSON.stringify(raw));
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`missing migration from schema ${v}`);
    data = m(data);
    data.schema = v + 1;
  }
  return { data, from, migrated: from !== SCHEMA_VERSION };
}
