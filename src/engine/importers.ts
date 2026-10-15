/**
 * Importers: WebHandbrake exports, single shared rules, and plain lists of sites
 * (domains, hosts files, uBlacklist, uBlock Origin / AdGuard). Every importer returns a
 * configuration plus a report of what could not be mapped.
 */

import { GROUP_COLORS, newGroup, newId, newPolicy } from './defaults';
import { clone, isObj } from './json';
import { parseTargetList } from './patterns';
import { normalizeConfig } from './schema';
import type { Config, Group, SharedList, Target } from './types';

/** `format` of the export file with the whole configuration. */
export const EXPORT_FORMAT = 'webhandbrake';
/** `version` of the export file with the whole configuration. */
export const EXPORT_VERSION = 1;
/** `format` of the file that shares a single rule with its shared lists. */
export const EXPORT_RULE_FORMAT = 'webhandbrake-group';
/** `version` of the single-rule file. */
export const EXPORT_RULE_VERSION = 1;

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

function result(format: ImportResult['format']): ImportResult {
  return { format, config: null, groups: [], lists: [], allowlist: [], warnings: [], errors: [] };
}

/**
 * Reads a file or pasted text. `current` is the configuration it may replace: a rule of an export
 * without secrets takes the password or partner code of the rule with the same id.
 */
export function detectAndImport(text: string, now = Date.now(), current?: Config): ImportResult {
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
      if (data.format === EXPORT_FORMAT || (Array.isArray(data.groups) && isObj(data.settings))) {
        return importWebHandbrake(data, now, current);
      }
      if (data.format === EXPORT_RULE_FORMAT && isObj(data.group)) return importGroupShare(data, now);
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

function importWebHandbrake(data: Record<string, any>, now: number, current?: Config): ImportResult {
  const r = result('webhandbrake');
  const raw = isObj(data.config) ? data.config : data;
  const { config, errors } = normalizeConfig(raw, now, { secretsFrom: current });
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

/**
 * A rule as a file keeps it without its secrets: a password or a partner code
 * says only what it is, so that reading the file can take the secret of the rule it replaces.
 */
export function withoutSecrets(
  g: Group,
): Omit<Group, 'protection'> & { protection: Record<string, unknown> } {
  const p = g.protection;
  if (p.kind === 'password') return { ...g, protection: { kind: 'password' } };
  if (p.kind === 'partner') return { ...g, protection: { kind: 'partner', breaks: p.breaks } };
  return g;
}

/** A single group with its shared lists, as JSON. */
export function exportGroup(config: Config, groupId: string): string | null {
  const g = config.groups.find((x) => x.id === groupId);
  if (!g) return null;
  const lists = config.lists.filter((l) => g.lists.includes(l.id));
  // A shared rule never carries its password or its partner's secret.
  const group = withoutSecrets(g);
  return JSON.stringify({ format: EXPORT_RULE_FORMAT, version: EXPORT_RULE_VERSION, group, lists }, null, 2);
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
    const next: Config = clone(imp.config);
    next.settings.onboarded = true;
    return next;
  }
  const next: Config = clone(current);
  const idMap = new Map<string, string>();
  for (const l of imp.lists) {
    const id = newId();
    idMap.set(l.id, id);
    next.lists.push({ ...l, id });
  }
  for (const g of imp.groups) {
    // A rule from a file never brings a password or a partner that the person does not know:
    // it asks for a reminder instead.
    const secret = g.protection.kind === 'password' || g.protection.kind === 'partner';
    next.groups.push({
      ...g,
      protection: secret ? { kind: 'reminder' } : g.protection,
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
