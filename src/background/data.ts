/** Data management. */

import { classify, diffConfig } from '../engine/changes';
import { defaultConfig } from '../engine/defaults';
import {
  detectAndImport,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportGroup,
  mergeImport,
  withoutSecrets,
} from '../engine/importers';
import { clone, isObj } from '../engine/json';
import { MAX_IMPORT_BYTES, MAX_LATER_ITEMS } from '../engine/limits';
import type { Config, LaterItem } from '../engine/types';
import { t } from '../i18n/i18n';
import { api } from '../platform/api';
import { timestampSuffix } from '../shared/format';
import type { ImportPreview, SaveResult } from '../shared/models';
import { emptySaveResult, proposeConfig } from './protection';
import { store } from './store';

export async function exportData(includeStats: boolean, includeSecrets: boolean) {
  await store.ready();
  await store.flushUsage();
  const config: Config = clone(store.config);
  if (!includeSecrets) {
    // The passwords and the partner secrets of the rules.
    config.groups = config.groups.map(withoutSecrets) as Config['groups'];
  }
  const out: Record<string, unknown> = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    config,
    later: store.later,
  };
  if (includeStats) {
    const keys = await store.allDayKeys();
    out.statistics = Object.fromEntries(await store.loadDays(keys));
  }
  return { filename: `webhandbrake-${timestampSuffix()}.json`, text: JSON.stringify(out, null, 2) };
}

export async function exportGroupFile(groupId: string) {
  await store.ready();
  const text = exportGroup(store.config, groupId) ?? '';
  const name = store.config.groups.find((g) => g.id === groupId)?.name ?? 'group';
  const safe = name.replace(/[^\w-]+/g, '-').toLowerCase() || 'group';
  return { filename: `webhandbrake-group-${safe}-${timestampSuffix()}.json`, text };
}

function translateWarnings(w: { key: string; params?: Record<string, string | number> }[]) {
  return w.map((x) => t(x.key, x.params));
}

function buildNext(text: string, mode: 'merge' | 'replace') {
  if (text.length > MAX_IMPORT_BYTES) {
    return {
      imp: null,
      next: null,
      errors: [t('import.error.tooLarge', { mb: MAX_IMPORT_BYTES / 1024 / 1024 })],
    };
  }
  const imp = detectAndImport(text, Date.now(), store.config);
  if (imp.format === 'unknown' || (!imp.config && !imp.groups.length)) {
    return { imp, next: null, errors: imp.errors.map((e) => (e.startsWith('import.') ? t(e) : e)) };
  }
  const effectiveMode = imp.config ? mode : 'merge';
  return {
    imp,
    next: mergeImport(store.config, imp, effectiveMode),
    errors: imp.errors.map((e) => (e.startsWith('import.') ? t(e) : e)),
  };
}

export async function previewImport(text: string, mode: 'merge' | 'replace'): Promise<ImportPreview> {
  await store.ready();
  const { imp, next, errors } = buildNext(text, mode);
  if (!imp || !next) {
    return { format: 'unknown', groups: [], warnings: [], errors, units: [], directions: [] };
  }
  const units = diffConfig(store.config, next);
  return {
    format: imp.format === 'group' ? 'webhandbrake' : imp.format,
    groups: imp.groups.map((g) => ({ name: g.name, sites: g.targets.length })),
    warnings: translateWarnings(imp.warnings),
    errors,
    units,
    directions: units.map((u) => classify(u, store.config)),
  };
}

/**
 * The pages saved for later in a file, with the fields that the list reads: web pages only, as
 * "Save for later" keeps them (a file may have been edited, and the list opens its addresses).
 */
function importedLater(raw: unknown[]): LaterItem[] {
  const items: LaterItem[] = [];
  for (const i of raw) {
    if (!isObj(i) || typeof i.url !== 'string' || !/^https?:\/\//i.test(i.url)) continue;
    items.push({
      ...i,
      id: typeof i.id === 'string' && i.id ? i.id : crypto.randomUUID(),
      url: i.url,
      title: typeof i.title === 'string' ? i.title.slice(0, 300) : '',
      groupId: typeof i.groupId === 'string' ? i.groupId : undefined,
      savedAt: typeof i.savedAt === 'number' && Number.isFinite(i.savedAt) ? i.savedAt : Date.now(),
    });
  }
  return items.slice(0, MAX_LATER_ITEMS);
}

/** Whatever an import loosens follows the emergency exit, for this import only. */
export async function applyImport(text: string, mode: 'merge' | 'replace'): Promise<SaveResult> {
  await store.ready();
  const { imp, next, errors } = buildNext(text, mode);
  if (!imp || !next) return emptySaveResult(errors);
  if (imp.format === 'webhandbrake' && imp.config && mode === 'replace') {
    const raw = JSON.parse(text);
    if (Array.isArray(raw.later)) {
      store.later = importedLater(raw.later);
      await store.saveLater();
    }
  }
  return proposeConfig(next, `import-${imp.format}`, {
    errors: [...errors, ...translateWarnings(imp.warnings)],
    bulk: true,
  });
}

export async function listBackups() {
  await store.ready();
  const index = await store.getBackupIndex();
  const seen = new Set<string>();
  return [...index.recent, ...index.daily]
    .sort((x, y) => y.at - x.at)
    .filter((m) => {
      // Recent and daily entries can share the same snapshot.
      if (seen.has(m.key)) return false;
      seen.add(m.key);
      return true;
    })
    .map((m) => ({ at: m.at, reason: m.reason, groups: m.groups }));
}

/** Whatever a restore loosens follows the emergency exit, for this restore only. */
export async function restoreBackup(at: number): Promise<SaveResult> {
  await store.ready();
  const index = await store.getBackupIndex();
  const meta = [...index.recent, ...index.daily].find((m) => m.at === at);
  const snap = meta ? await store.loadSnapshot(meta) : null;
  if (!snap) return emptySaveResult([t('backups.error.notFound')]);
  const next: Config = clone(snap.data);
  next.settings.onboarded = true;
  return proposeConfig(next, 'restore', { bulk: true });
}

/** Factory reset: whatever it loosens follows the emergency exit, for this reset only. */
export async function resetConfig(): Promise<SaveResult> {
  await store.ready();
  const next = defaultConfig();
  next.settings.onboarded = true;
  return proposeConfig(next, 'reset', { bulk: true });
}

/** The row of Settings › Privacy that a storage key belongs to (a `privacy.key.*` label). */
function storageGroup(key: string): string {
  if (key === 'u:min') return 'u:min';
  if (key.startsWith('u:')) return 'usage';
  if (key.startsWith('bk:') || key === 'backups:index') return 'backups';
  if (key === 'config:pre-migration') return 'config';
  return key;
}

/** What is stored, with sizes. */
export async function storageUsage() {
  const all = await api.storage.local.get(null);
  const groups: Record<string, number> = {};
  for (const [k, v] of Object.entries(all)) {
    const name = storageGroup(k);
    groups[name] = (groups[name] ?? 0) + JSON.stringify(v).length;
  }
  let total: number | null = null;
  try {
    total = await api.storage.local.getBytesInUse(null);
  } catch {
    total = Object.values(groups).reduce((a, b) => a + b, 0);
  }
  return { keys: Object.entries(groups).map(([name, bytes]) => ({ name, bytes })), total };
}
