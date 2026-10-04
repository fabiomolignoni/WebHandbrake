/** Data management (DAT-01…DAT-07, PRO-12, PRIV-05). */

import { classify, diffConfig } from '../engine/changes';
import { defaultConfig } from '../engine/defaults';
import { detectAndImport, exportGroup, mergeImport } from '../engine/importers';
import { MAX_IMPORT_BYTES } from '../engine/schema';
import type { Config } from '../engine/types';
import { t } from '../i18n/i18n';
import { api } from '../platform/api';
import { timestampSuffix } from '../shared/format';
import type { ImportPreview, SaveResult } from '../shared/models';
import { proposeConfig } from './protection';
import { store } from './store';

export async function exportData(includeStats: boolean, includeSecrets: boolean) {
  await store.ready();
  await store.flushUsage();
  const config: Config = JSON.parse(JSON.stringify(store.config));
  if (!includeSecrets) config.settings.protection.access.passwordHash = null;
  const out: Record<string, unknown> = {
    format: 'webhandbrake',
    version: 1,
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
    return { imp: null, next: null, errors: [t('import.error.tooLarge')] };
  }
  const imp = detectAndImport(text);
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
    groups: imp.groups.map((g) => ({ name: g.name, sites: g.targets.length, policies: g.policies.length })),
    warnings: translateWarnings(imp.warnings),
    errors,
    units,
    directions: units.map((u) => classify(u, store.config)),
  };
}

/** PRO-12: an import that weakens the rules is subject to the protection like any other change. */
export async function applyImport(text: string, mode: 'merge' | 'replace'): Promise<SaveResult> {
  await store.ready();
  const { imp, next, errors } = buildNext(text, mode);
  if (!imp || !next) return { applied: [], ticket: null, pending: null, refused: null, errors };
  if (imp.format === 'webhandbrake' && imp.config && mode === 'replace') {
    const raw = JSON.parse(text);
    if (Array.isArray(raw.later)) {
      store.later = raw.later.filter((i: unknown) => typeof i === 'object' && i !== null).slice(0, 1000);
      await store.saveLater();
    }
  }
  return proposeConfig(next, `import-${imp.format}`, {
    errors: [...errors, ...translateWarnings(imp.warnings)],
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

export async function restoreBackup(at: number): Promise<SaveResult> {
  await store.ready();
  const index = await store.getBackupIndex();
  const meta = [...index.recent, ...index.daily].find((m) => m.at === at);
  const snap = meta ? await store.loadSnapshot(meta) : null;
  if (!snap)
    return { applied: [], ticket: null, pending: null, refused: null, errors: [t('backups.error.notFound')] };
  const next: Config = JSON.parse(JSON.stringify(snap.data));
  next.settings.onboarded = true;
  return proposeConfig(next, 'restore');
}

/** DAT-06: factory reset, protected like any weakening. */
export async function resetConfig(): Promise<SaveResult> {
  await store.ready();
  const next = defaultConfig();
  next.settings.onboarded = true;
  return proposeConfig(next, 'reset');
}

/** PRIV-05: what is stored, with sizes. */
export async function storageUsage() {
  const all = await api.storage.local.get(null);
  const groups: Record<string, number> = {};
  for (const [k, v] of Object.entries(all)) {
    const name = k.startsWith('u:') ? 'usage' : k.startsWith('bk:') || k === 'backups:index' ? 'backups' : k;
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
