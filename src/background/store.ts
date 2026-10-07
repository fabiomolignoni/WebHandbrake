/**
 * Persistent store. Storage is the source of truth (REL-01); memory is a cache rebuilt whenever
 * the service worker / event page wakes up.
 *
 * - config: written with a checksum; every write keeps the previous version as a snapshot
 *   (last 20 + one per day for 30 days, DAT-03), each under its own key with a small index. A
 *   corrupted config is restored from the latest valid snapshot at start-up.
 * - state: written immediately on meaningful changes; activity counters are batched (PERF-04).
 * - usage: one key per logical day plus minute buckets, flushed at most every 10 s (TIM-05).
 */

import { type CompiledConfig, compileConfig } from '../engine/compile';
import { defaultConfig, defaultState } from '../engine/defaults';
import {
  CHECKSUM_VERSION,
  configChecksum,
  looksLikeConfig,
  migrate,
  normalizeConfig,
  storedConfigIntact,
} from '../engine/schema';
import { addDays, dayKey, logicalDayOf } from '../engine/time';
import type { Config, DayRecord, LaterItem, MinuteBuckets, RuntimeState, TamperEvent } from '../engine/types';
import { Usage } from '../engine/usage';
import { api, isFirefox } from '../platform/api';

export interface SnapshotMeta {
  at: number;
  reason: string;
  groups: number;
  /** Storage key of the snapshot data ("bk:…"); recent and daily entries can share it. */
  key: string;
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

export interface Meta {
  installedAt: number;
  version: string;
  lastDaily: string;
  restored: { at: number; snapshotAt: number | null } | null;
  selftest: { at: number; ok: boolean } | null;
  lastFlush: number;
  lastAddGroup?: string;
  incognitoAllowed?: boolean;
  dismissedRestore?: number;
}

export interface IntentionRecord {
  at: number;
  groupId: string;
  text: string;
  minutes: number;
}

const RECENT_SNAPSHOTS = 20;
const DAILY_SNAPSHOTS = 30;
const USAGE_DAYS_IN_MEMORY = 95;
const USAGE_FLUSH_MS = 10_000;
const MAX_TAMPER = 200;
const MAX_INTENTIONS = 500;

function snapshotKey(at: number): string {
  return `bk:${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export class Store {
  config: Config = defaultConfig();
  cc: CompiledConfig = compileConfig(this.config);
  state: RuntimeState = defaultState();
  usage: Usage = new Usage();
  later: LaterItem[] = [];
  intentions: IntentionRecord[] = [];
  meta: Meta = { installedAt: 0, version: '', lastDaily: '', restored: null, selftest: null, lastFlush: 0 };
  firstRun = false;

  private loading: Promise<void> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private usageTimer: ReturnType<typeof setTimeout> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;

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
      'meta',
      'u:min',
      'intentions',
    ]);
    this.meta = { ...this.meta, ...(isObj(raw.meta) ? raw.meta : {}) };
    if (raw.config === undefined) {
      this.firstRun = true;
      this.config = defaultConfig();
    } else {
      this.config = await this.loadConfig(raw.config);
    }
    this.cc = compileConfig(this.config);

    const st = isObj(raw.state) ? raw.state : {};
    this.state = {
      ...defaultState(),
      ...st,
      activity: isObj(raw.activity) ? raw.activity : {},
    } as RuntimeState;
    for (const k of ['grants', 'sessions', 'pending', 'pauses', 'tamper'] as const) {
      if (!Array.isArray(this.state[k])) (this.state as any)[k] = [];
    }
    for (const k of ['cooldowns', 'forfeits'] as const)
      if (!isObj(this.state[k])) (this.state as any)[k] = {};

    this.later = Array.isArray(raw.later) ? raw.later : [];
    this.intentions = Array.isArray(raw.intentions) ? raw.intentions : [];

    const today = logicalDayOf(Date.now(), this.cc.cal);
    const keys: string[] = [];
    for (let i = 0; i < USAGE_DAYS_IN_MEMORY; i++) keys.push(`u:${dayKey(addDays(today, -i))}`);
    const days = await api.storage.local.get(keys);
    const map: Record<string, DayRecord> = {};
    for (const [k, v] of Object.entries(days)) if (isObj(v)) map[k.slice(2)] = v as DayRecord;
    this.usage = new Usage(map, isObj(raw['u:min']) ? (raw['u:min'] as MinuteBuckets) : {});
  }

  private async loadConfig(stored: unknown): Promise<Config> {
    try {
      if (!isObj(stored) || !looksLikeConfig(stored.data)) throw new Error('structure');
      // Firefox keeps the order of the keys; Chrome returns them sorted.
      if (!storedConfigIntact(stored as { data: unknown }, isFirefox)) throw new Error('checksum');
      const { data, migrated, from } = migrate(stored.data);
      const { config } = normalizeConfig(data);
      if (migrated) {
        // Keep the pre-migration copy until the next successful write (DAT-07 rollback).
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

  /** DAT-03: restore the most recent valid snapshot. */
  private async restoreFromBackup(): Promise<Config> {
    const index = await this.getBackupIndex();
    const metas = [...index.recent, ...index.daily].sort((a, b) => b.at - a.at);
    for (const meta of metas) {
      try {
        const snap = await this.loadSnapshot(meta);
        if (!snap || !looksLikeConfig(snap.data)) continue;
        const { data } = migrate(snap.data);
        const { config } = normalizeConfig(data);
        this.meta.restored = { at: Date.now(), snapshotAt: snap.at };
        await this.writeConfigRaw(config);
        await this.saveMeta();
        this.pendingTamper.push({ at: Date.now(), kind: 'state-restored', detail: String(snap.at) });
        return config;
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

  /** Tamper events detected before the state was loaded. */
  pendingTamper: TamperEvent[] = [];

  private async writeConfigRaw(config: Config) {
    await api.storage.local.set({
      config: { data: config, sum: configChecksum(config), v: CHECKSUM_VERSION, savedAt: Date.now() },
    });
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

  async loadSnapshot(meta: SnapshotMeta): Promise<Snapshot | null> {
    const r = await api.storage.local.get(meta.key);
    const data = r[meta.key];
    return isObj(data) ? { ...meta, data: data as unknown as Config } : null;
  }

  /** Saves the index (plus new snapshots) and removes the snapshots no longer referenced. */
  private async saveIndex(before: BackupIndex, after: BackupIndex, items: Record<string, unknown>) {
    const keys = (i: BackupIndex) => new Set([...i.recent, ...i.daily].map((m) => m.key));
    const kept = keys(after);
    const removed = [...keys(before)].filter((k) => !kept.has(k));
    await api.storage.local.set({ ...items, [INDEX_KEY]: after });
    if (removed.length) await api.storage.local.remove(removed);
  }

  private today(at: number): string {
    return dayKey(logicalDayOf(at, this.cc.cal));
  }

  /** Writes a new configuration, keeping the previous one as a snapshot (DAT-03). */
  async writeConfig(next: Config, reason: string) {
    const prev = this.config;
    const before = await this.getBackupIndex();
    const now = Date.now();
    const meta: SnapshotMeta = { at: now, reason, groups: prev.groups.length, key: snapshotKey(now) };
    const after: BackupIndex = {
      recent: [meta, ...before.recent].slice(0, RECENT_SNAPSHOTS),
      daily: before.daily,
    };
    if (!before.daily.length || this.today(before.daily[0].at) !== this.today(now)) {
      after.daily = [{ ...meta, reason: 'daily' }, ...before.daily].slice(0, DAILY_SNAPSHOTS);
    }
    this.config = next;
    this.cc = compileConfig(next);
    await this.saveIndex(before, after, {
      [meta.key]: prev,
      config: { data: next, sum: configChecksum(next), v: CHECKSUM_VERSION, savedAt: now },
    });
    await api.storage.local.remove('config:pre-migration');
  }

  /** One snapshot per day even when nothing changes (DAT-03), without touching the recent ones. */
  async snapshotDaily() {
    const before = await this.getBackupIndex();
    const now = Date.now();
    if (before.daily.length && this.today(before.daily[0].at) === this.today(now)) return;
    const meta: SnapshotMeta = {
      at: now,
      reason: 'daily',
      groups: this.config.groups.length,
      key: snapshotKey(now),
    };
    const after: BackupIndex = {
      recent: before.recent,
      daily: [meta, ...before.daily].slice(0, DAILY_SNAPSHOTS),
    };
    await this.saveIndex(before, after, { [meta.key]: this.config });
  }

  /** Persists the runtime state (without the frequently changing activity counters). */
  async saveState() {
    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }
    this.state.tamper = this.state.tamper.slice(-MAX_TAMPER);
    const { activity, ...rest } = this.state;
    await api.storage.local.set({ state: rest, activity });
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
    for (const dk of this.usage.dirtyDays) {
      const rec = this.usage.days.get(dk);
      if (rec) items[`u:${dk}`] = rec;
    }
    this.usage.dirtyDays.clear();
    if (this.usage.dirtyMinutes) {
      items['u:min'] = this.usage.minutes;
      this.usage.dirtyMinutes = false;
    }
    if (Object.keys(items).length) await api.storage.local.set(items);
  }

  async flushAll() {
    await Promise.all([this.flushUsage(), this.saveState()]);
  }

  async saveLater() {
    await api.storage.local.set({ later: this.later });
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
    this.state.tamper = this.state.tamper.slice(-MAX_TAMPER);
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

  /** All stored day keys (statistics export, retention). */
  async allDayKeys(): Promise<string[]> {
    const all = await api.storage.local.get(null);
    return Object.keys(all)
      .filter((k) => /^u:\d{4}-\d{2}-\d{2}$/.test(k))
      .map((k) => k.slice(2))
      .sort();
  }
}

export const store = new Store();
