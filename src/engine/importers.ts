/**
 * Importers: WebHandbrake exports, single shared rules, and plain lists of sites
 * (domains, hosts files, uBlacklist, uBlock Origin / AdGuard). Every importer returns a
 * configuration plus a report of what could not be mapped.
 */

import { deepEqual } from './changes';
import { GROUP_COLORS, newGroup, newId, newPolicy, targetKey } from './defaults';
import { clone, isObj } from './json';
import { parseTargetList } from './patterns';
import { normalizeConfig, type Problem } from './schema';
import type { Config, Group } from './types';

/** `format` of the export file with the whole configuration. */
export const EXPORT_FORMAT = 'webhandbrake';
/** `version` of the export file with the whole configuration. */
export const EXPORT_VERSION = 1;
/** `format` of the file that shares a single rule. */
export const EXPORT_RULE_FORMAT = 'webhandbrake-group';
/** `version` of the single-rule file. */
export const EXPORT_RULE_VERSION = 1;

export interface ImportResult {
  format: 'webhandbrake' | 'list' | 'group' | 'unknown';
  config: Config | null;
  /** Groups to add (merge mode) — for list and group imports. */
  groups: Group[];
  /** i18n keys with parameters, shown as the import report. */
  warnings: Problem[];
  errors: Problem[];
}

function result(format: ImportResult['format']): ImportResult {
  return { format, config: null, groups: [], warnings: [], errors: [] };
}

/**
 * Reads a file or pasted text. `current` is the configuration it may replace: a rule of an export
 * without secrets takes the password or partner code of the rule with the same id.
 */
export function detectAndImport(text: string, now = Date.now(), current?: Config): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { ...result('unknown'), errors: [{ key: 'import.error.empty' }] };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { ...result('unknown'), errors: [{ key: 'import.error.json' }] };
    }
    if (isObj(data)) {
      if (data.format === EXPORT_FORMAT || (Array.isArray(data.groups) && isObj(data.settings))) {
        return importWebHandbrake(data, now, current);
      }
      if (data.format === EXPORT_RULE_FORMAT && isObj(data.group)) return importGroupShare(data, now);
    }
    const strings = collectStrings(data);
    if (strings.length) return importList(strings.join('\n'), now);
    return { ...result('unknown'), errors: [{ key: 'import.error.format' }] };
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
  r.errors = errors;
  return r;
}

function importGroupShare(data: Record<string, any>, now: number): ImportResult {
  const r = result('group');
  // Files of schema 1 carry the shared lists of the rule, which the migration moves into it.
  const { config, errors } = normalizeConfig(
    { schema: 1, groups: [data.group], lists: Array.isArray(data.lists) ? data.lists : [], settings: {} },
    now,
  );
  r.groups = config.groups;
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

/** A single group, as JSON. */
export function exportGroup(config: Config, groupId: string): string | null {
  const g = config.groups.find((x) => x.id === groupId);
  if (!g) return null;
  // A shared rule never carries its password or its partner's secret.
  const group = withoutSecrets(g);
  return JSON.stringify({ format: EXPORT_RULE_FORMAT, version: EXPORT_RULE_VERSION, group }, null, 2);
}

// ---------------------------------------------------------------------------
// Plain lists
// ---------------------------------------------------------------------------

function importList(text: string, now: number): ImportResult {
  const r = result('list');
  const { targets, errors } = parseTargetList(text);
  if (!targets.length) {
    r.errors.push({ key: 'import.error.noSites' });
    return r;
  }
  for (const e of errors)
    r.warnings.push({ key: 'import.warn.line', params: { line: e.line, text: e.text } });
  const group = newGroup(
    {
      // Named by the background, in the interface language (import.listName).
      name: '',
      color: GROUP_COLORS[2],
      targets: targets.map((t) => ({ ...t, id: newId() })),
      policies: [newPolicy({ intervention: { type: 'block' } })],
    },
    now,
  );
  r.groups = [group];
  return r;
}

/**
 * A rule from a file as merging adds it: it never brings a password or a partner that the person
 * does not know, and asks for a reminder instead.
 */
function asMerged(g: Group): Group {
  const secret = g.protection.kind === 'password' || g.protection.kind === 'partner';
  return secret ? { ...g, protection: { kind: 'reminder' } } : g;
}

/** What a rule is, its ids and revision aside: its sites in any order, its condition, its protection… */
function ruleContent(g: Group): unknown {
  return {
    name: g.name,
    color: g.color,
    icon: g.icon,
    note: g.note,
    message: g.message,
    enabled: g.enabled,
    archived: g.archived,
    targets: [...new Set(g.targets.map(targetKey))].sort(),
    policies: g.policies.map((p) => ({
      schedule: p.schedule,
      budget: p.budget,
      intervention: p.intervention,
    })),
    pause: g.pause,
    protection: g.protection,
    options: g.options,
  };
}

/**
 * Which rules a merge leaves out as already present: the same, as merging would add it, as a rule
 * of the configuration or as one before it in the file. Importing a file twice adds its rules once.
 */
export function presentRules(current: Config, groups: Group[]): boolean[] {
  const kept = current.groups.map(ruleContent);
  return groups.map((g) => {
    const content = ruleContent(asMerged(g));
    if (kept.some((k) => deepEqual(k, content))) return true;
    kept.push(content);
    return false;
  });
}

/** Builds the configuration resulting from an import, merging into or replacing the current one. */
export function mergeImport(current: Config, imp: ImportResult, mode: 'merge' | 'replace'): Config {
  if (mode === 'replace' && imp.config) {
    const next: Config = clone(imp.config);
    next.settings.onboarded = true;
    return next;
  }
  const next: Config = clone(current);
  const present = presentRules(current, imp.groups);
  imp.groups.forEach((g, i) => {
    if (present[i]) return;
    next.groups.push({
      ...asMerged(g),
      id: newId(),
      policies: g.policies.map((p) => ({ ...p, id: newId() })),
      targets: g.targets.map((t) => ({ ...t, id: newId() })),
    });
  });
  return next;
}
