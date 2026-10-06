/**
 * Importers (DAT-01, LST-03): WebHandbrake exports, single shared rules, and plain lists of sites
 * (domains, hosts files, uBlacklist, uBlock Origin / AdGuard). Every importer returns a
 * configuration plus a report of what could not be mapped.
 */

import { GROUP_COLORS, newGroup, newId, newPolicy } from './defaults';
import { parseTargetList } from './patterns';
import { normalizeConfig } from './schema';
import type { Config, Group, SharedList, Target } from './types';

export interface ImportResult {
  format: 'webhandbrake' | 'list' | 'group' | 'unknown';
  config: Config | null;
  /** Groups to add (merge mode) — for list and group imports. */
  groups: Group[];
  lists: SharedList[];
  allowlist: Target[];
  /** i18n keys with parameters, shown as the import report. */
  warnings: { key: string; params?: Record<string, string | number> }[];
  errors: string[];
}

const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function result(format: ImportResult['format']): ImportResult {
  return { format, config: null, groups: [], lists: [], allowlist: [], warnings: [], errors: [] };
}

export function detectAndImport(text: string, now = Date.now()): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { ...result('unknown'), errors: ['import.error.empty'] };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { ...result('unknown'), errors: ['import.error.json'] };
    }
    if (isObj(data)) {
      if (data.format === 'webhandbrake' || (Array.isArray(data.groups) && isObj(data.settings))) {
        return importWebHandbrake(data, now);
      }
      if (data.format === 'webhandbrake-group' && isObj(data.group)) return importGroupShare(data, now);
    }
    const strings = collectStrings(data);
    if (strings.length) return importList(strings.join('\n'), now);
    return { ...result('unknown'), errors: ['import.error.format'] };
  }
  return importList(trimmed, now);
}

function collectStrings(data: unknown, out: string[] = []): string[] {
  if (typeof data === 'string') {
    if (/^[\w*.-]+\.[a-z*]{2,}([/?#].*)?$/i.test(data.trim()) || /^https?:\/\//i.test(data.trim()))
      out.push(data.trim());
  } else if (Array.isArray(data)) {
    for (const d of data) collectStrings(d, out);
  } else if (isObj(data)) {
    for (const d of Object.values(data)) collectStrings(d, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// WebHandbrake
// ---------------------------------------------------------------------------

function importWebHandbrake(data: Record<string, any>, now: number): ImportResult {
  const r = result('webhandbrake');
  const raw = isObj(data.config) ? data.config : data;
  const { config, errors } = normalizeConfig(raw, now);
  r.config = config;
  r.groups = config.groups;
  r.lists = config.lists;
  r.allowlist = config.allowlist;
  r.errors = errors;
  return r;
}

function importGroupShare(data: Record<string, any>, now: number): ImportResult {
  const r = result('group');
  const { config, errors } = normalizeConfig(
    { schema: 1, groups: [data.group], lists: Array.isArray(data.lists) ? data.lists : [], settings: {} },
    now,
  );
  r.groups = config.groups;
  r.lists = config.lists;
  r.errors = errors;
  return r;
}

/** LST-03: a single group with its shared lists, as JSON. */
export function exportGroup(config: Config, groupId: string): string | null {
  const g = config.groups.find((x) => x.id === groupId);
  if (!g) return null;
  const lists = config.lists.filter((l) => g.lists.includes(l.id));
  return JSON.stringify({ format: 'webhandbrake-group', version: 1, group: g, lists }, null, 2);
}

// ---------------------------------------------------------------------------
// Plain lists
// ---------------------------------------------------------------------------

function importList(text: string, now: number): ImportResult {
  const r = result('list');
  const { targets, errors } = parseTargetList(text);
  if (!targets.length) {
    r.errors.push('import.error.noSites');
    return r;
  }
  for (const e of errors)
    r.warnings.push({ key: 'import.warn.line', params: { line: e.line, text: e.text } });
  const group = newGroup(
    {
      name: 'Imported list',
      color: GROUP_COLORS[2],
      targets: targets.map((t) => ({ ...t, id: newId() })),
      policies: [newPolicy({ intervention: { type: 'block' } })],
    },
    now,
  );
  r.groups = [group];
  return r;
}

/** Builds the configuration resulting from an import, merging into or replacing the current one. */
export function mergeImport(current: Config, imp: ImportResult, mode: 'merge' | 'replace'): Config {
  if (mode === 'replace' && imp.config) {
    const next: Config = JSON.parse(JSON.stringify(imp.config));
    next.settings.onboarded = true;
    if (!next.settings.protection.access.passwordHash) {
      next.settings.protection.access.passwordHash = current.settings.protection.access.passwordHash;
    }
    return next;
  }
  const next: Config = JSON.parse(JSON.stringify(current));
  const idMap = new Map<string, string>();
  for (const l of imp.lists) {
    const id = newId();
    idMap.set(l.id, id);
    next.lists.push({ ...l, id });
  }
  for (const g of imp.groups) {
    next.groups.push({
      ...g,
      id: newId(),
      lists: g.lists.map((id) => idMap.get(id)).filter((x): x is string => Boolean(x)),
      policies: g.policies.map((p) => ({ ...p, id: newId() })),
      targets: g.targets.map((t) => ({ ...t, id: newId() })),
    });
  }
  const have = new Set(next.allowlist.map((t) => `${t.type}|${t.value}`));
  for (const t of imp.allowlist)
    if (!have.has(`${t.type}|${t.value}`)) next.allowlist.push({ ...t, id: newId() });
  return next;
}
