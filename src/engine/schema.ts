/**
 * Validation and normalisation of stored and imported configurations.
 * Normalisation fills missing fields with defaults and drops invalid entries, but never removes
 * unknown fields (forward compatibility with newer versions and future sync).
 */

import {
  canHaveBreaks,
  defaultConfig,
  defaultOptions,
  defaultPause,
  defaultSettings,
  GROUP_COLORS,
  newId,
} from './defaults';
import { clone, isObj } from './json';
import { MAX_WAIT_SECONDS, MIN_WAIT_SECONDS, PBKDF2_MAX_ITERATIONS, PBKDF2_MIN_ITERATIONS } from './limits';
import { checkRegex, compilePattern, mayOverlap } from './patterns';
import {
  type Config,
  type Cost,
  type Group,
  type Intervention,
  type PartnerCode,
  type PausePolicy,
  type Period,
  type Policy,
  type Protection,
  type ProtectionKind,
  SCHEMA_VERSION,
  type Settings,
  type Target,
  type TimeWindow,
} from './types';

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
  const type = oneOf(
    raw.type,
    ['domain', 'host', 'path', 'page', 'homepage', 'wildcard', 'regex'] as const,
    'domain',
  );
  const value = str(raw.value, '', 2000).trim();
  if (!value) return null;
  if (type === 'regex' && checkRegex(value)) return null;
  const t: Target = { ...raw, id: str(raw.id) || newId(), type, value };
  if (raw.allow) t.allow = true;
  else delete t.allow;
  // Sites no longer have notes: those of earlier versions are dropped.
  delete (t as { note?: unknown }).note;
  if (!compilePattern(t)) return null;
  return t;
}

function normalizeTargets(raw: unknown, errors: string[], where: string): Target[] {
  if (!Array.isArray(raw)) return [];
  const out: Target[] = [];
  for (const r of raw) {
    const t = normalizeTarget(r);
    if (t) out.push(t);
    else
      errors.push(
        `${where}: an entry that could not be read was left out: ${JSON.stringify(r).slice(0, 80)}`,
      );
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
    // The reminder of earlier versions (#17) kept the page and counted its time: Only count time
    // keeps both, where the fallback below would block.
    case 'remind':
      return { type: 'track' };
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
 * "no limit" into the default limit. A break of earlier versions could last a fixed time or one
 * of a few lengths, cover less than the rule, ask for a reason or count only the time on the site:
 * it now lasts up to the longest of its lengths and covers the rule.
 */
export function normalizePause(raw: unknown): PausePolicy {
  const def = defaultPause();
  if (!isObj(raw)) return def;
  const d = isObj(raw.duration) ? raw.duration : {};
  const l = isObj(raw.limit) ? raw.limit : {};
  const choices: unknown[] = d.mode === 'choices' && Array.isArray(d.choices) ? d.choices : [];
  const lengths = [raw.maxMinutes, d.minutes, ...choices].filter(
    (m): m is number => typeof m === 'number' && Number.isFinite(m),
  );
  const pause = {
    ...raw,
    allowed: bool(raw.allowed, def.allowed),
    duringSessions: bool(raw.duringSessions, def.duringSessions),
    maxMinutes: lengths.length ? num(Math.max(...lengths), def.maxMinutes, 1, 1440) : def.maxMinutes,
    limit: {
      ...(typeof l.count === 'number' ? { count: Math.round(num(l.count, 0, 0, 1000)) } : {}),
      ...(typeof l.minutes === 'number' ? { minutes: num(l.minutes, 0, 0, 100_000) } : {}),
      period: normalizePeriod(l.period),
    },
    cost: normalizeCost(raw.cost),
  } as PausePolicy & Record<string, unknown>;
  for (const old of ['duration', 'scopes', 'reason', 'metered']) delete pause[old];
  return pause;
}

const KINDS = ['reminder', 'wait', 'password', 'partner', 'locked', 'permanent'] as const;
/** The protection levels of earlier versions, turned into protections. */
const LEVELS = ['soft', 'balanced', 'strict', 'locked', 'permanent'] as const;

/** A password hash as `hashPassword()` writes it: "pbkdf2-sha256$iterations$salt$hash". */
const PASSWORD_HASH = /^pbkdf2-sha256\$(\d{1,9})\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/;

/** A well-formed hash whose iterations are within the accepted range. */
export function isPasswordHash(value: unknown): value is string {
  const m = typeof value === 'string' ? PASSWORD_HASH.exec(value) : null;
  const n = m ? Number(m[1]) : 0;
  return n >= PBKDF2_MIN_ITERATIONS && n <= PBKDF2_MAX_ITERATIONS;
}

/** A TOTP secret in base32 without padding, from 80 to 640 bits. */
const PARTNER_SECRET = /^[A-Z2-7]{16,128}$/;

/** The partner code, or null when its secret is missing or not valid. */
export function normalizePartner(raw: unknown): PartnerCode | null {
  if (!isObj(raw)) return null;
  const secret = str(raw.secret).toUpperCase();
  if (!PARTNER_SECRET.test(secret)) return null;
  return { kind: 'partner', secret, breaks: bool(raw.breaks, true) };
}

/**
 * What a rule of an earlier version takes over from the configuration around it: before #12 a rule
 * could follow the level of the whole configuration, with its Locked date, and the settings
 * password and the partner code protected every rule; the Balanced wait and the Strict cooling-off
 * were settings.
 */
interface Legacy {
  level: (typeof LEVELS)[number];
  lockedUntil: number | null;
  passwordHash: string | null;
  partner: PartnerCode | null;
  balancedSeconds: number;
  coolingOffSeconds: number;
}

const NO_LEGACY: Legacy = {
  level: 'balanced',
  lockedUntil: null,
  passwordHash: null,
  partner: null,
  balancedSeconds: 30,
  coolingOffSeconds: 24 * 3600,
};

function legacyProtection(settings: unknown): Legacy {
  const p = isObj(settings) && isObj(settings.protection) ? settings.protection : {};
  const access = isObj(p.access) ? p.access : {};
  return {
    level: oneOf(p.level, LEVELS, NO_LEGACY.level),
    lockedUntil: typeof p.lockedUntil === 'number' ? p.lockedUntil : null,
    passwordHash: isPasswordHash(access.passwordHash) ? access.passwordHash : null,
    partner: normalizePartner(access.partner),
    balancedSeconds: num(p.balancedDelaySeconds, 30, MIN_WAIT_SECONDS, MAX_WAIT_SECONDS),
    coolingOffSeconds: num(p.coolingOffHours, 24, 1, 168) * 3600,
  };
}

/**
 * What loosening a rule takes. A password or a partner code without its secret (an export
 * without secrets) takes the secret of `current`, the rule it replaces, when that has the
 * same kind; otherwise the rule asks only for a reminder, and replacing a firmer rule with it is a
 * loosening like any other.
 *
 * A rule of an earlier version had a level and could have a password and a partner code; it takes
 * the firmest of them: Locked (Permanent without a date), then the partner code, then the
 * password, then a wait as long as its level's (Strict: the cooling-off; Balanced: the wait).
 */
function normalizeProtection(raw: Record<string, any>, legacy: Legacy, current?: Protection): Protection {
  const p = raw.protection;
  if (isObj(p) && (KINDS as readonly string[]).includes(p.kind)) {
    switch (p.kind as ProtectionKind) {
      case 'reminder':
        return { kind: 'reminder' };
      case 'permanent':
        return { kind: 'permanent' };
      case 'wait':
        return { kind: 'wait', seconds: Math.round(num(p.seconds, 30, MIN_WAIT_SECONDS, MAX_WAIT_SECONDS)) };
      case 'locked':
        return typeof p.until === 'number' ? { kind: 'locked', until: p.until } : { kind: 'permanent' };
      case 'password':
        if (isPasswordHash(p.hash)) return { kind: 'password', hash: p.hash };
        return current?.kind === 'password' ? { ...current } : { kind: 'reminder' };
      case 'partner': {
        const partner = normalizePartner(p);
        if (partner) return partner;
        return current?.kind === 'partner'
          ? { ...current, breaks: bool(p.breaks, current.breaks) }
          : { kind: 'reminder' };
      }
    }
  }
  const level = p === null || p === undefined ? legacy.level : oneOf(p, LEVELS, NO_LEGACY.level);
  if (level === 'locked' || level === 'permanent') {
    const until =
      typeof raw.protectionUntil === 'number'
        ? raw.protectionUntil
        : p === null || p === undefined
          ? legacy.lockedUntil
          : null;
    return level === 'locked' && until !== null ? { kind: 'locked', until } : { kind: 'permanent' };
  }
  const partner = normalizePartner(raw.partner) ?? legacy.partner;
  if (partner) return partner;
  const hash = isPasswordHash(raw.passwordHash) ? raw.passwordHash : legacy.passwordHash;
  if (hash) return { kind: 'password', hash };
  if (level === 'strict') return { kind: 'wait', seconds: legacy.coolingOffSeconds };
  if (level === 'balanced') return { kind: 'wait', seconds: legacy.balancedSeconds };
  return { kind: 'reminder' };
}

export function normalizeGroup(
  raw: unknown,
  errors: string[],
  now = Date.now(),
  legacy: Legacy = NO_LEGACY,
  current?: Protection,
): Group | null {
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
    targets: normalizeTargets(raw.targets, errors, `Rule “${name}”`),
    policies: Array.isArray(raw.policies)
      ? (raw.policies.map(normalizePolicy).filter(Boolean) as Policy[])
      : [],
    pause,
    protection: normalizeProtection(raw, legacy, current),
    options: mergeDefaults(defaultOptions(), raw.options),
  };
  // Breaks lift a block only: a rule without a condition that blocks has none.
  if (!canHaveBreaks(g)) g.pause.allowed = false;
  // The fields of earlier versions that the protection has taken over.
  const old = g as Group & Record<string, unknown>;
  delete old.protectionUntil;
  delete old.passwordHash;
  delete old.partner;
  return g;
}

/**
 * Settings of earlier versions that were removed: the accent colour (#22), the alternatives (#16),
 * the global protection level with its Locked date (#12), the access requirements of the whole
 * configuration, whose password and partner code rules have taken over, and the
 * settings of the levels, which became the protections of the rules.
 */
const OBSOLETE_SETTINGS = [
  'accent',
  // Advanced mode: the rule editor has advanced options in each part instead.
  'advanced',
  'interventions.alternatives',
  'protection.level',
  'protection.lockedUntil',
  'protection.access',
  'protection.fallback',
  'protection.coolingOffHours',
  'protection.balancedDelaySeconds',
  'protection.challengeLength',
];

export function normalizeSettings(raw: unknown): Settings {
  const s = mergeDefaults(defaultSettings(), raw);
  s.dayStart = num(s.dayStart, 0, 0, 720);
  s.weekStart = Math.round(num(s.weekStart, 1, 0, 6));
  s.tracking.idleSeconds = num(s.tracking.idleSeconds, 120, 15, 3600);
  s.tracking.visitGapMinutes = num(s.tracking.visitGapMinutes, 5, 1, 240);
  s.tracking.retentionDays = num(s.tracking.retentionDays, 730, 7, 3650);
  s.interventions.graceSeconds = num(s.interventions.graceSeconds, 45, 0, 300);
  s.protection.emergencyHours = num(s.protection.emergencyHours, 24, 4, 168);
  s.protection.confirmHours = num(s.protection.confirmHours, 48, 1, 168);
  s.pauseLimit = { ...s.pauseLimit, period: normalizePeriod(s.pauseLimit?.period) };
  // Settings that no longer exist are dropped rather than kept as unknown fields: an import that
  // still carries one would otherwise count as a change the classifier does not know.
  for (const path of OBSOLETE_SETTINGS) {
    const keys = path.split('.');
    const last = keys.pop()!;
    let at: unknown = s;
    for (const k of keys) at = isObj(at) ? at[k] : undefined;
    if (isObj(at)) delete at[last];
  }
  return s;
}

/**
 * Returns a valid configuration and the list of problems found (empty when everything was fine).
 * `secretsFrom` is the configuration an import replaces: its rules lend their secrets to the rules
 * of an export without secrets.
 */
export function normalizeConfig(
  input: unknown,
  now = Date.now(),
  opts: { secretsFrom?: Config } = {},
): { config: Config; errors: string[] } {
  const errors: string[] = [];
  // Imports and restored backups may come from an earlier schema.
  const raw = migrate(input).data;
  if (!isObj(raw)) return { config: defaultConfig(), errors: ['not an object'] };
  const groups: Group[] = [];
  const ids = new Set<string>();
  const legacy = legacyProtection(raw.settings);
  for (const g of Array.isArray(raw.groups) ? raw.groups : []) {
    const id = isObj(g) ? str(g.id) : '';
    const current = id ? opts.secretsFrom?.groups.find((x) => x.id === id)?.protection : undefined;
    const n = normalizeGroup(g, errors, now, legacy, current);
    if (!n) {
      errors.push('A rule that could not be read was left out.');
      continue;
    }
    if (ids.has(n.id)) n.id = newId();
    ids.add(n.id);
    groups.push(n);
  }
  return {
    config: {
      ...raw,
      schema: SCHEMA_VERSION,
      groups,
      settings: normalizeSettings(raw.settings),
      tombstones: Array.isArray(raw.tombstones) ? raw.tombstones.filter(isObj) : [],
    } as Config,
    errors,
  };
}

/** Structural check used to detect corrupted storage. */
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

/** Checksum of a stored configuration, whatever the order of its keys. */
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
// Migrations
// ---------------------------------------------------------------------------

type Migration = (raw: Record<string, any>) => Record<string, any>;

const targetKey = (t: Record<string, any>) => `${t.type}|${t.value}|${Boolean(t.allow)}`;

/** migrations[n] upgrades schema n to n + 1. */
const MIGRATIONS: Record<number, Migration> = {
  /**
   * Shared lists and Always allowed are gone. A rule takes the sites of the lists it used, and as
   * exceptions the Always allowed entries that may open some of its sites.
   */
  1: (raw) => {
    const lists = new Map<unknown, unknown[]>();
    for (const l of Array.isArray(raw.lists) ? raw.lists : [])
      if (isObj(l) && Array.isArray(l.targets)) lists.set(l.id, l.targets);
    const allowed = (Array.isArray(raw.allowlist) ? raw.allowlist : [])
      .map((t: unknown) => normalizeTarget(isObj(t) ? { ...t, allow: true } : t))
      .filter((t: Target | null): t is Target => t !== null);
    for (const g of Array.isArray(raw.groups) ? raw.groups : []) {
      if (!isObj(g)) continue;
      const own: unknown[] = Array.isArray(g.targets) ? g.targets : [];
      const shared = (Array.isArray(g.lists) ? g.lists : []).flatMap((id: unknown) => lists.get(id) ?? []);
      const restricted = [...own, ...shared]
        .map((t) => normalizeTarget(t))
        .flatMap((t) => (t && !t.allow ? [compilePattern(t)!] : []));
      const opening = allowed.filter((entry) =>
        restricted.some((cp) => mayOverlap(compilePattern(entry)!, cp)),
      );
      // The copies get ids of their own: a list's sites were in several rules.
      const seen = new Set(own.filter(isObj).map(targetKey));
      for (const t of [...shared, ...opening]) {
        if (!isObj(t) || seen.has(targetKey(t))) continue;
        seen.add(targetKey(t));
        own.push({ ...t, id: newId() });
      }
      g.targets = own;
      delete g.lists;
    }
    if (Array.isArray(raw.tombstones)) raw.tombstones = raw.tombstones.filter((t) => t?.kind !== 'list');
    delete raw.lists;
    delete raw.allowlist;
    return raw;
  },
};

export function migrate(raw: unknown): { data: unknown; from: number; migrated: boolean } {
  if (!isObj(raw)) return { data: raw, from: 0, migrated: false };
  const from = typeof raw.schema === 'number' ? raw.schema : 1;
  if (from > SCHEMA_VERSION) {
    // Written by a newer version: keep everything, unknown fields are preserved by normalisation.
    return { data: raw, from, migrated: false };
  }
  let data: Record<string, any> = clone(raw);
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`missing migration from schema ${v}`);
    data = m(data);
    data.schema = v + 1;
  }
  return { data, from, migrated: from !== SCHEMA_VERSION };
}
