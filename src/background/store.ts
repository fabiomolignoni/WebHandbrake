/**
 * Persistent store. Storage is the source of truth; memory is a cache rebuilt whenever
 * the service worker / event page wakes up.
 *
 * - config: written with a checksum, and the same under config:last; every write keeps the previous
 *   version as a snapshot (the last RECENT_SNAPSHOTS plus one per day for DAILY_SNAPSHOTS days),
 *   each under its own key with a small index. A snapshot keeps its rules apart, each under a key
 *   named after its content, so that the snapshots share the rules that did not change: a rule
 *   with a list of thousands of sites is stored once, not once per snapshot. A corrupted config is
 *   restored at start-up from config:last, or else from the latest valid snapshot.
 * - state: written immediately on meaningful changes; activity counters are batched. A key whose
 *   content has not changed since it was last read or written is not written again.
 * - usage: one key per logical day plus minute buckets, flushed at most every USAGE_FLUSH_MS, and
 *   the list of the stored days, so that finding them never reads the whole storage.
 *
 * The caps and retention periods live in src/engine/limits.ts.
 */

import { type CompiledConfig, compileConfig } from '../engine/compile';
import { defaultConfig, defaultFocusLists, defaultState } from '../engine/defaults';
import { isObj } from '../engine/json';
import {
  DAILY_SNAPSHOTS,
  MAX_INTENTIONS,
  MAX_PROTECTION_EVENTS,
  RECENT_SNAPSHOTS,
  USAGE_FLUSH_MS,
} from '../engine/limits';
import {
  CHECKSUM_VERSION,
  canonicalJson,
  configChecksum,
  looksLikeConfig,
  migrate,
  normalizeConfig,
  normalizeFocusLists,
  storedConfigIntact,
} from '../engine/schema';
import { addDays, dayKey, logicalDayOf } from '../engine/time';
import type {
  Config,
  DayRecord,
  FocusLists,
  Grant,
  Group,
  LaterItem,
  MinuteBuckets,
  RuntimeState,
  TamperEvent,
} from '../engine/types';
import { Usage } from '../engine/usage';
import { api, isFirefox, quiet } from '../platform/api';

export interface SnapshotMeta {
  at: number;
  reason: string;
  groups: number;
  /**
   * Storage key of the snapshot data ("bk:…"), the configuration without its rules; recent and
   * daily entries can share it.
   */
  key: string;
  /**
   * Storage keys of its rules, in order ("bk:r:…", see ruleKey), which snapshots share. Absent in
   * the snapshots of earlier builds, which keep the whole configuration under `key`.
   */
  rules?: string[];
}

export interface Snapshot extends SnapshotMeta {
  data: Config;
}

/** Small index kept apart from the snapshots, so a write only adds one snapshot. */
export interface BackupIndex {
  recent: SnapshotMeta[];
  daily: SnapshotMeta[];
}

const INDEX_KEY = 'backups:index';
/** A second copy of the latest configuration, so that a restore does not lose the last change. */
const LAST_KEY = 'config:last';
/** The days stored under u:<day>, sorted. */
const DAYS_KEY = 'u:index';
const DAY_KEY = /^u:\d{4}-\d{2}-\d{2}$/;

export interface Meta {
  installedAt: number;
  version: string;
  lastDaily: string;
  restored: { at: number; snapshotAt: number | null } | null;
  /** Time of the latest protection event whose warning was dismissed. */
  tamperSeen?: number;
  selftest: { at: number; ok: boolean } | null;
  lastFlush: number;
  lastAddGroup?: string;
  incognitoAllowed?: boolean;
}

export interface IntentionRecord {
  at: number;
  groupId: string;
  text: string;
  minutes: number;
}

const USAGE_DAYS_IN_MEMORY = 95;

function snapshotKey(at: number): string {
  return `bk:${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Storage key of a rule in the snapshots, named after its content (128 bits of its SHA-256). */
async function ruleKey(group: Group): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(group)));
  const hex = [...new Uint8Array(hash, 0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `bk:r:${hex}`;
}

/** The storage keys that an index refers to: its snapshots and their rules. */
function indexKeys(index: BackupIndex): Set<string> {
  const keys = new Set<string>();
  for (const m of [...index.recent, ...index.daily]) {
    keys.add(m.key);
    if (Array.isArray(m.rules)) for (const r of m.rules) keys.add(r);
  }
  return keys;
}

/**
 * A snapshot of a configuration to add to the index `before`: its data, and the rules that no
 * snapshot of that index has.
 */
async function snapshotOf(config: Config, at: number, reason: string, before: BackupIndex) {
  const { groups, ...rest } = config;
  const key = snapshotKey(at);
  const stored = indexKeys(before);
  const items: Record<string, unknown> = { [key]: rest };
  const rules: string[] = [];
  for (const g of groups) {
    const rk = await ruleKey(g);
    rules.push(rk);
    if (!stored.has(rk)) items[rk] = g;
  }
  const meta: SnapshotMeta = { at, reason, groups: groups.length, key, rules };
  return { meta, items };
}

/** How a configuration is stored under config and config:last. */
function storedConfig(config: Config, savedAt: number) {
  return { data: config, sum: configChecksum(config), v: CHECKSUM_VERSION, savedAt };
}

/** A stored configuration whose checksum matches. */
function intact(stored: unknown): stored is { data: unknown; v?: unknown; savedAt?: unknown } {
  // Firefox keeps the order of the keys; Chrome returns them sorted.
  return (
    isObj(stored) &&
    looksLikeConfig(stored.data) &&
    storedConfigIntact(stored as { data: unknown }, isFirefox)
  );
}

export class Store {
  config: Config = defaultConfig();
  cc: CompiledConfig = compileConfig(this.config);
  state: RuntimeState = defaultState();
  usage: Usage = new Usage();
  later: LaterItem[] = [];
  focus: FocusLists = defaultFocusLists();
  intentions: IntentionRecord[] = [];
  meta: Meta = { installedAt: 0, version: '', lastDaily: '', restored: null, selftest: null, lastFlush: 0 };
  firstRun = false;

  private loading: Promise<void> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private usageTimer: ReturnType<typeof setTimeout> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  /** The stored content of the state keys, as canonical JSON (Chrome returns the keys sorted). */
  private stored: { state?: string; activity?: string } = {};
  /** The days stored under u:<day>, as listed under DAYS_KEY. */
  private storedDays = new Set<string>();

  ready(): Promise<void> {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  /** Serialises mutations so that concurrent events never interleave. */
  mutate<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async load() {
    const raw = await api.storage.local.get([
      'config',
      'state',
      'activity',
      'later',
      'focus',
      'meta',
      'u:min',
      'intentions',
      DAYS_KEY,
    ]);
    this.meta = { ...this.meta, ...(isObj(raw.meta) ? raw.meta : {}) };
    if (raw.config === undefined) {
      this.firstRun = true;
      this.config = defaultConfig();
    } else {
      this.config = await this.loadConfig(raw.config);
    }
    this.cc = compileConfig(this.config);

    // The background starts again at every alarm once it has been idle: what it read is what the
    // storage holds.
    this.stored = { state: canonicalJson(raw.state), activity: canonicalJson(raw.activity) };
    const st = isObj(raw.state) ? raw.state : {};
    this.state = {
      ...defaultState(),
      ...st,
      activity: isObj(raw.activity) ? raw.activity : {},
    } as RuntimeState;
    for (const k of ['grants', 'sessions', 'pending', 'pauses', 'tamper'] as const)
      if (!Array.isArray(this.state[k])) this.state[k] = [];
    for (const k of ['forfeits', 'partnerSteps'] as const) if (!isObj(this.state[k])) this.state[k] = {};
    // The cool-downs of continuous use, which earlier versions had, are gone.
    delete (this.state as RuntimeState & { cooldowns?: unknown }).cooldowns;
    if (!isObj(this.state.secretFailures)) this.state.secretFailures = { count: 0, lockedUntil: 0 };
    // A break of an earlier version could count only the time on the site: it now ends by the clock.
    for (const g of this.state.grants as (Grant & { remaining?: number })[]) {
      if (g.remaining === undefined) continue;
      g.until = Date.now() + Math.max(0, g.remaining) * 1000;
      delete g.remaining;
    }

    this.later = Array.isArray(raw.later) ? raw.later : [];
    this.focus = normalizeFocusLists(raw.focus);
    this.intentions = Array.isArray(raw.intentions) ? raw.intentions : [];

    // The days up to today by the trusted clock (clock.ts: the highest time seen, corrected by the
    // Date headers), so that a system clock set back a day does not leave out today's time and the
    // limits it used up.
    const trusted = Math.max(Date.now() + (this.state.clockOffset || 0), this.state.lastWall || 0);
    const today = logicalDayOf(trusted, this.cc.cal);
    const keys: string[] = [];
    for (let i = 0; i < USAGE_DAYS_IN_MEMORY; i++) keys.push(`u:${dayKey(addDays(today, -i))}`);
    const days = await api.storage.local.get(keys);
    const map: Record<string, DayRecord> = {};
    for (const [k, v] of Object.entries(days)) if (isObj(v)) map[k.slice(2)] = v as DayRecord;
    this.usage = new Usage(map, isObj(raw['u:min']) ? (raw['u:min'] as MinuteBuckets) : {});
    this.usage.fillHours(this.cc.cal);
    const listed = raw[DAYS_KEY];
    this.storedDays = Array.isArray(listed)
      ? new Set(listed.filter((d): d is string => typeof d === 'string'))
      : await this.listDays();
  }

  /** Earlier builds kept no list of the stored days: it is made once, from the keys of the storage. */
  private async listDays(): Promise<Set<string>> {
    const keys =
      (await quiet(api.storage.local.getKeys?.())) ?? Object.keys(await api.storage.local.get(null));
    const days = new Set(keys.filter((k) => DAY_KEY.test(k)).map((k) => k.slice(2)));
    // Made again at the next start if it cannot be written.
    await quiet(api.storage.local.set({ [DAYS_KEY]: [...days].sort() }));
    return days;
  }

  private async loadConfig(stored: unknown): Promise<Config> {
    try {
      if (!intact(stored)) throw new Error('damaged');
      const { data, migrated, from } = migrate(stored.data);
      const { config } = normalizeConfig(data);
      if (migrated) {
        // Keep the pre-migration copy until the next successful write (for a rollback).
        await api.storage.local.set({ 'config:pre-migration': { from, data: stored.data } });
        await this.writeConfigRaw(config);
      } else if (stored.v !== CHECKSUM_VERSION) {
        // Written by an earlier version: from now on the checksum can be checked in every browser.
        await this.writeConfigRaw(config);
      }
      return config;
    } catch {
      return this.restoreFromBackup();
    }
  }

  /** Restore the copy of the latest configuration, or else the most recent valid snapshot. */
  private async restoreFromBackup(): Promise<Config> {
    const last = (await api.storage.local.get(LAST_KEY))[LAST_KEY];
    if (intact(last)) {
      try {
        return await this.restore(last.data, typeof last.savedAt === 'number' ? last.savedAt : Date.now());
      } catch {
        // the snapshots, then
      }
    }
    const index = await this.getBackupIndex();
    const metas = [...index.recent, ...index.daily].sort((a, b) => b.at - a.at);
    for (const meta of metas) {
      try {
        const snap = await this.loadSnapshot(meta);
        if (!snap || !looksLikeConfig(snap.data)) continue;
        return await this.restore(snap.data, snap.at);
      } catch {
        // try the next one
      }
    }
    this.meta.restored = { at: Date.now(), snapshotAt: null };
    this.pendingTamper.push({ at: Date.now(), kind: 'state-restored', detail: 'defaults' });
    const config = defaultConfig();
    config.settings.onboarded = true;
    await this.writeConfigRaw(config);
    await this.saveMeta();
    return config;
  }

  /** Puts back a copy saved at `at`. */
  private async restore(saved: unknown, at: number): Promise<Config> {
    const { data } = migrate(saved);
    const { config } = normalizeConfig(data);
    this.meta.restored = { at: Date.now(), snapshotAt: at };
    await this.writeConfigRaw(config);
    await this.saveMeta();
    this.pendingTamper.push({ at: Date.now(), kind: 'state-restored', detail: String(at) });
    return config;
  }

  /** Tamper events detected before the state was loaded. */
  pendingTamper: TamperEvent[] = [];

  private async writeConfigRaw(config: Config) {
    const stored = storedConfig(config, Date.now());
    await api.storage.local.set({ config: stored, [LAST_KEY]: stored });
  }

  /** Index of the snapshots; converts the single-key format of earlier builds. */
  async getBackupIndex(): Promise<BackupIndex> {
    const r = await api.storage.local.get([INDEX_KEY, 'backups']);
    const idx = r[INDEX_KEY];
    if (isObj(idx) && Array.isArray(idx.recent) && Array.isArray(idx.daily)) return idx as BackupIndex;
    const legacy = r.backups;
    const index: BackupIndex = { recent: [], daily: [] };
    if (isObj(legacy) && Array.isArray(legacy.recent) && Array.isArray(legacy.daily)) {
      const items: Record<string, unknown> = {};
      for (const list of ['recent', 'daily'] as const) {
        for (const snap of legacy[list] as { at: number; reason: string; data: Config }[]) {
          const key = snapshotKey(snap.at);
          items[key] = snap.data;
          index[list].push({ at: snap.at, reason: snap.reason, groups: snap.data?.groups?.length ?? 0, key });
        }
      }
      await api.storage.local.set({ ...items, [INDEX_KEY]: index });
      await api.storage.local.remove('backups');
    }
    return index;
  }

  /** A snapshot with its rules; null when its data or one of its rules is missing. */
  async loadSnapshot(meta: SnapshotMeta): Promise<Snapshot | null> {
    const rules = meta.rules;
    const r = await api.storage.local.get([meta.key, ...(Array.isArray(rules) ? rules : [])]);
    const data = r[meta.key];
    if (!isObj(data)) return null;
    // A snapshot of an earlier build: the whole configuration.
    if (rules === undefined) return { ...meta, data: data as unknown as Config };
    if (!Array.isArray(rules)) return null;
    const groups = rules.map((k) => r[k]);
    if (!groups.every(isObj)) return null;
    return { ...meta, data: { ...data, groups } as unknown as Config };
  }

  /** Saves the index (plus new snapshots) and removes the snapshots and rules no longer referenced. */
  private async saveIndex(before: BackupIndex, after: BackupIndex, items: Record<string, unknown>) {
    const kept = indexKeys(after);
    const removed = [...indexKeys(before)].filter((k) => !kept.has(k));
    await api.storage.local.set({ ...items, [INDEX_KEY]: after });
    if (removed.length) await api.storage.local.remove(removed);
  }

  private today(at: number): string {
    return dayKey(logicalDayOf(at, this.cc.cal));
  }

  /** Writes a new configuration, keeping the previous one as a snapshot. */
  async writeConfig(next: Config, reason: string) {
    const prev = this.config;
    const before = await this.getBackupIndex();
    const now = Date.now();
    const { meta, items } = await snapshotOf(prev, now, reason, before);
    const after: BackupIndex = {
      recent: [meta, ...before.recent].slice(0, RECENT_SNAPSHOTS),
      daily: before.daily,
    };
    if (!before.daily.length || this.today(before.daily[0].at) !== this.today(now)) {
      after.daily = [{ ...meta, reason: 'daily' }, ...before.daily].slice(0, DAILY_SNAPSHOTS);
    }
    this.config = next;
    this.cc = compileConfig(next);
    const stored = storedConfig(next, now);
    await this.saveIndex(before, after, { ...items, config: stored, [LAST_KEY]: stored });
    await api.storage.local.remove('config:pre-migration');
  }

  /** One snapshot per day even when nothing changes, without touching the recent ones. */
  async snapshotDaily() {
    const before = await this.getBackupIndex();
    const now = Date.now();
    if (before.daily.length && this.today(before.daily[0].at) === this.today(now)) return;
    const { meta, items } = await snapshotOf(this.config, now, 'daily', before);
    const after: BackupIndex = {
      recent: before.recent,
      daily: [meta, ...before.daily].slice(0, DAILY_SNAPSHOTS),
    };
    await this.saveIndex(before, after, items);
  }

  /**
   * Persists the runtime state, with the frequently changing activity counters under a key of
   * their own. Only the keys whose content changed are written: the periodic alarm saves every
   * minute. Compared by content, not with a flag, since now() moves lastWall without saying so.
   */
  async saveState() {
    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }
    this.state.tamper = this.state.tamper.slice(-MAX_PROTECTION_EVENTS);
    const { activity, ...rest } = this.state;
    const next = { state: canonicalJson(rest), activity: canonicalJson(activity) };
    const items: Record<string, unknown> = {};
    if (next.state !== this.stored.state) items.state = rest;
    if (next.activity !== this.stored.activity) items.activity = activity;
    if (!Object.keys(items).length) return;
    await api.storage.local.set(items);
    this.stored = next;
  }

  /** Batched state write for counters (metered pauses, activity). */
  scheduleState() {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      void this.saveState();
    }, USAGE_FLUSH_MS);
  }

  scheduleUsage() {
    if (this.usageTimer) return;
    this.usageTimer = setTimeout(() => {
      this.usageTimer = null;
      void this.flushUsage();
    }, USAGE_FLUSH_MS);
  }

  async flushUsage() {
    if (this.usageTimer) {
      clearTimeout(this.usageTimer);
      this.usageTimer = null;
    }
    const items: Record<string, unknown> = {};
    const added: string[] = [];
    for (const dk of this.usage.dirtyDays) {
      const rec = this.usage.days.get(dk);
      if (!rec) continue;
      items[`u:${dk}`] = rec;
      if (!this.storedDays.has(dk)) added.push(dk);
    }
    // A new day is listed in the same write as its record.
    for (const dk of added) this.storedDays.add(dk);
    if (added.length) items[DAYS_KEY] = [...this.storedDays].sort();
    this.usage.dirtyDays.clear();
    if (this.usage.dirtyMinutes) {
      items['u:min'] = this.usage.minutes;
      this.usage.dirtyMinutes = false;
    }
    if (!Object.keys(items).length) return;
    try {
      await api.storage.local.set(items);
    } catch (e) {
      // Not stored: the next write of these days lists them.
      for (const dk of added) this.storedDays.delete(dk);
      throw e;
    }
  }

  async flushAll() {
    await Promise.all([this.flushUsage(), this.saveState()]);
  }

  async saveLater() {
    await api.storage.local.set({ later: this.later });
  }

  async saveFocus() {
    await api.storage.local.set({ focus: this.focus });
  }

  async saveIntentions() {
    this.intentions = this.intentions.slice(-MAX_INTENTIONS);
    await api.storage.local.set({ intentions: this.intentions });
  }

  async saveMeta() {
    await api.storage.local.set({ meta: this.meta });
  }

  addTamper(e: TamperEvent) {
    this.state.tamper.push(e);
    this.state.tamper = this.state.tamper.slice(-MAX_PROTECTION_EVENTS);
  }

  /** Loads day records outside the in-memory window (statistics). */
  async loadDays(keys: string[]): Promise<Map<string, DayRecord>> {
    const out = new Map<string, DayRecord>();
    const missing: string[] = [];
    for (const k of keys) {
      const d = this.usage.days.get(k);
      if (d) out.set(k, d);
      else missing.push(`u:${k}`);
    }
    if (missing.length) {
      const r = await api.storage.local.get(missing);
      for (const [k, v] of Object.entries(r)) if (isObj(v)) out.set(k.slice(2), v as DayRecord);
    }
    return out;
  }

  /** All stored day keys (statistics export, retention), from their list. */
  async allDayKeys(): Promise<string[]> {
    return [...this.storedDays].sort();
  }

  /** Removes the records of these days. */
  async removeDays(days: string[]) {
    if (!days.length) return;
    // The list may name a day no longer stored, never leave out one that is.
    await api.storage.local.remove(days.map((k) => `u:${k}`));
    for (const k of days) {
      this.usage.days.delete(k);
      this.storedDays.delete(k);
    }
    await api.storage.local.set({ [DAYS_KEY]: [...this.storedDays].sort() });
  }
}

export const store = new Store();
