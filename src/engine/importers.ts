/**
 * Importers (DAT-01, DAT-02, LST-03): WebHandbrake exports, LeechBlock NG exports (text and
 * JSON), single shared groups, and plain lists (domains, hosts files, uBlacklist, uBlock Origin /
 * AdGuard). Every importer returns a configuration plus a report of what could not be mapped.
 */

import {
  defaultConfig,
  delayIntervention,
  GROUP_COLORS,
  newGroup,
  newId,
  newPolicy,
  pausePolicyFor,
} from './defaults';
import { checkRegex, parseTargetList } from './patterns';
import { normalizeConfig } from './schema';
import type {
  Config,
  Cost,
  Group,
  Intervention,
  Period,
  Policy,
  SharedList,
  Target,
  TimeWindow,
} from './types';

export interface ImportResult {
  format: 'webhandbrake' | 'leechblock' | 'list' | 'group' | 'unknown';
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
      if (Object.keys(data).some((k) => /^(setName|sites)\d+$/.test(k))) return importLeechBlock(data, now);
    }
    const strings = collectStrings(data);
    if (strings.length) return importList(strings.join('\n'), now);
    return { ...result('unknown'), errors: ['import.error.format'] };
  }
  if (/^(setName|sites|numSets)\d*=/m.test(trimmed)) return importLeechBlockText(trimmed, now);
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

// ---------------------------------------------------------------------------
// LeechBlock NG (text "name=value" export and JSON export)
// ---------------------------------------------------------------------------

function importLeechBlockText(text: string, now: number): ImportResult {
  const opts: Record<string, unknown> = {};
  for (const line of text.split(/[\r\n]+/)) {
    const m = /^(\w+)=(.*)$/.exec(line);
    if (!m) continue;
    const [, name, value] = m;
    if (/^days\d+$/.test(name)) {
      const code = Number(value);
      opts[name] = Array.from({ length: 7 }, (_, i) => (code & (1 << i)) !== 0);
    } else if (value === 'true' || value === 'false') opts[name] = value === 'true';
    else opts[name] = value;
  }
  return importLeechBlock(opts, now);
}

/** LeechBlock exports strings with the legacy escape(): this is the matching unescape(). */
function lbStr(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/%u([0-9a-f]{4})|%([0-9a-f]{2})/gi, (_, u: string | undefined, h: string | undefined) =>
    String.fromCharCode(Number.parseInt(u ?? h ?? '0', 16)),
  );
}

function lbPeriod(seconds: number): Period {
  if (seconds === 3600) return { kind: 'hour' };
  if (seconds === 86400) return { kind: 'day' };
  if (seconds === 604800) return { kind: 'week' };
  if (seconds % 86400 === 0) return { kind: 'days', n: Math.min(90, seconds / 86400) };
  return { kind: 'minutes', n: Math.max(5, Math.min(1440, Math.round(seconds / 60))) };
}

function lbWindows(times: string, days: boolean[]): TimeWindow[] {
  const dayList = days.map((on, i) => (on ? i : -1)).filter((d) => d >= 0);
  const out: TimeWindow[] = [];
  for (const part of times.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(part);
    if (!m) continue;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]);
    out.push({ days: dayList, start, end: start === 0 && end >= 1440 ? 1440 : end });
  }
  return out;
}

function lbFilter(name: string, custom: string, mute: boolean): Intervention {
  const m = /^(blur|fade) \((\d+)(px|%)\)$/.exec(name);
  if (m) {
    const n = Number(m[2]);
    return m[1] === 'blur'
      ? { type: 'filter', filter: 'blur', intensity: Math.min(100, n * 10), mute }
      : { type: 'filter', filter: 'fade', intensity: Math.min(100, Math.round(n / 0.9)), mute };
  }
  if (name === 'custom') return { type: 'filter', filter: 'custom', css: custom, intensity: 100, mute };
  if (name === 'grayscale' || name === 'invert' || name === 'sepia')
    return { type: 'filter', filter: name, intensity: 100, mute };
  return { type: 'filter', filter: 'none', intensity: 0, mute };
}

function importLeechBlock(o: Record<string, any>, now: number): ImportResult {
  const r = result('leechblock');
  const config = defaultConfig();
  config.settings.onboarded = true;
  const numSets = Math.max(1, Math.min(30, Number(o.numSets) || 6));
  const warn = (key: string, params?: Record<string, string | number>) => r.warnings.push({ key, params });

  // General options.
  const s = config.settings;
  if (typeof o.timerVisible === 'boolean') s.timer.enabled = o.timerVisible;
  if (o.timerSize !== undefined)
    s.timer.size = (['small', 'medium', 'large'] as const)[Number(o.timerSize)] ?? 'medium';
  if (o.timerLocation !== undefined) {
    s.timer.corner =
      (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const)[Number(o.timerLocation)] ??
      'top-left';
  }
  if (typeof o.timerBadge === 'boolean') s.badge.enabled = o.timerBadge;
  if (o.warnSecs) s.warningSeconds = Math.min(3600, Number(o.warnSecs) || 0);
  if (typeof o.contextMenu === 'boolean') s.contextMenu = o.contextMenu;
  if (o.clockTimeFormat === '1') s.hour12 = '12';
  if (o.clockTimeFormat === '2') s.hour12 = '24';
  if (o.theme === 'dark' || o.theme === 'light') s.theme = o.theme;
  if (o.customStyle) s.interventions.customCss = lbStr(o.customStyle);
  const oa = String(o.oa ?? '0');
  if (oa === '1') warn('import.lb.password');
  if (oa === '2' || oa === '3' || oa === '4')
    s.protection.access.codeLength = { '2': 32, '3': 64, '4': 128 }[oa]!;
  if (o.apt) warn('import.lb.unsupported', { option: 'accessPreventTimes' });

  const ora = String(o.ora ?? '0');
  const overrideCost: Cost =
    ora === '1' || ora === '8' || ora === '9'
      ? { type: 'password' }
      : ora === '2' || ora === '3' || ora === '4'
        ? { type: 'challenge', kind: 'random', length: { '2': 32, '3': 64, '4': 128 }[ora]! }
        : o.orc === false
          ? { type: 'none' }
          : { type: 'confirm' };
  if ((ora === '8' || ora === '9') && !s.protection.access.passwordHash) warn('import.lb.overridePassword');
  const overrideMinutes = Number(o.orm) || 15;
  const overrideCount = Number(o.orln) || undefined;
  const overridePeriod: Period = o.orlp ? lbPeriod(Number(o.orlp) * 3600) : { kind: 'day' };

  let anyPrev = false;
  for (let n = 1; n <= numSets; n++) {
    const sites = typeof o[`sites${n}`] === 'string' ? (o[`sites${n}`] as string) : '';
    const regexBlock = lbStr(o[`regexpBlock${n}`]);
    const regexAllow = lbStr(o[`regexpAllow${n}`]);
    if (!sites.trim() && !regexBlock && !regexAllow) continue;
    const name = lbStr(o[`setName${n}`]) || `Block set ${n}`;
    const targets: Target[] = [];
    for (const raw of sites.split(/\s+/).filter(Boolean)) {
      if (raw.startsWith('#')) continue;
      if (raw === 'FILE' || raw === '+FILE') {
        targets.push({
          id: newId(),
          type: 'path',
          value: 'file:///',
          ...(raw === '+FILE' ? { allow: true } : {}),
        });
        continue;
      }
      if (raw.startsWith('>')) {
        warn('import.lb.referrer', { set: name, site: raw.slice(1) });
        continue;
      }
      if (raw.startsWith('~')) {
        warn('import.lb.keyword', { set: name, keyword: raw.slice(1) });
        continue;
      }
      const parsed = parseTargetList(raw.replace(/\*\+/g, '*'));
      if (parsed.targets[0]) targets.push({ id: newId(), ...parsed.targets[0] });
      else warn('import.warn.line', { line: n, text: raw });
    }
    for (const [re, allow] of [
      [regexBlock, false],
      [regexAllow, true],
    ] as const) {
      if (!re) continue;
      const err = checkRegex(re);
      if (err) warn('import.lb.regex', { set: name, error: err });
      else targets.push({ id: newId(), type: 'regex', value: re, ...(allow ? { allow: true } : {}) });
    }

    // Intervention.
    const blockURL = lbStr(o[`blockURL${n}`]) || 'blocked.html?$S&$U';
    let intervention: Intervention = { type: 'block' };
    if (o[`applyFilter${n}`]) {
      intervention = lbFilter(
        lbStr(o[`filterName${n}`]) || 'grayscale',
        lbStr(o[`filterCustom${n}`]),
        Boolean(o[`filterMute${n}`]),
      );
    } else if (o[`closeTab${n}`]) {
      intervention = { type: 'close' };
    } else if (/delayed\.html/.test(blockURL)) {
      const allowMins = Number(o[`delayAllowMins${n}`]) || 0;
      intervention = {
        ...(delayIntervention(Number(o[`delaySecs${n}`]) || 60) as Extract<Intervention, { type: 'delay' }>),
        autoContinue: o[`delayAutoLoad${n}`] !== false,
        onBlur: o[`delayCancel${n}`] === false ? 'ignore' : 'restart',
        grant: {
          scope: o[`delayFirstMode${n}`] === '1' ? 'group' : 'site',
          mode: allowMins ? 'minutes' : 'visit',
          ...(allowMins ? { minutes: allowMins } : {}),
        },
      };
    } else if (/password\.html/.test(blockURL)) {
      intervention = {
        type: 'challenge',
        kind: 'random',
        length: 32,
        grant: { scope: 'site', mode: 'visit' },
      };
      warn('import.lb.passwordPage', { set: name });
    } else if (!/^(\w+\/)?blocked\.html/.test(blockURL)) {
      intervention = { type: 'redirect', url: blockURL.replace(/\$S/g, '{group}').replace(/\$U/g, '{url}') };
    }

    // Policies: time periods and time limit, combined with OR (two policies) or AND (one).
    const days: boolean[] = Array.isArray(o[`days${n}`])
      ? o[`days${n}`]
      : [false, true, true, true, true, true, false];
    const times = typeof o[`times${n}`] === 'string' ? (o[`times${n}`] as string) : '';
    const windows = lbWindows(times, days);
    const limitMins = Number.parseFloat(String(o[`limitMins${n}`] ?? ''));
    const limitPeriod = Number(o[`limitPeriod${n}`]);
    const hasLimit = limitMins > 0 && limitPeriod > 0;
    const allDays = days.every(Boolean);
    const dayWindows: TimeWindow[] = [
      { days: days.map((on, i) => (on ? i : -1)).filter((d) => d >= 0), start: 0, end: 1440 },
    ];
    const policies: Policy[] = [];
    const budget = hasLimit
      ? { type: 'time' as const, minutes: limitMins, period: lbPeriod(limitPeriod) }
      : undefined;
    if (windows.length && hasLimit && o[`conjMode${n}`]) {
      policies.push(newPolicy({ schedule: { mode: 'during', windows }, budget, intervention }));
    } else {
      if (windows.length) policies.push(newPolicy({ schedule: { mode: 'during', windows }, intervention }));
      if (hasLimit) {
        policies.push(
          newPolicy({
            schedule: allDays ? { mode: 'always', windows: [] } : { mode: 'during', windows: dayWindows },
            budget,
            intervention,
          }),
        );
      }
    }
    if (!policies.length) warn('import.lb.neverBlocks', { set: name });
    if (o[`limitOffset${n}`]) warn('import.lb.unsupported', { option: `limitOffset (${name})` });
    if (o[`rollover${n}`]) warn('import.lb.unsupported', { option: `rollover (${name})` });
    if (o[`minBlock${n}`]) warn('import.lb.unsupported', { option: `minBlock (${name})` });
    if (o[`sitesURL${n}`]) warn('import.lb.unsupported', { option: `sitesURL (${name})` });
    if (o[`allowRefers${n}`] || o[`allowKeywords${n}`] || o[`waitSecs${n}`]) {
      warn('import.lb.unsupported', { option: `keywords/referrers (${name})` });
    }
    for (const k of [
      'prevAddons',
      'prevSupport',
      'prevDebugging',
      'prevProfiles',
      'prevOpts',
      'prevGenOpts',
      'prevExts',
    ]) {
      if (o[`${k}${n}`]) anyPrev = true;
    }

    const pause = pausePolicyFor('balanced');
    pause.allowed = Boolean(o[`allowOverride${n}`]);
    pause.duringSessions = o[`allowOverLock${n}`] !== false;
    pause.duration = { mode: 'fixed', minutes: overrideMinutes };
    pause.limit = { ...(overrideCount ? { count: overrideCount } : {}), period: overridePeriod };
    pause.cost = overrideCost;
    pause.reason = 'none';
    pause.metered = false;
    pause.scopes = ['page', 'site', 'group', 'all'];

    const incog = String(o[`incogMode${n}`] ?? '0');
    const tabsMode = String(o[`activeTabMode${n}`] ?? '0');
    config.groups.push(
      newGroup(
        {
          name,
          color: GROUP_COLORS[(n - 1) % GROUP_COLORS.length],
          enabled: !o[`disable${n}`],
          message: lbStr(o[`customMsg${n}`]),
          targets,
          policies,
          pause,
          options: {
            privacy: incog === '1' ? 'normal' : incog === '2' ? 'private' : 'all',
            embeds: false,
            tabs: tabsMode === '1' ? 'active' : tabsMode === '2' ? 'inactive' : 'all',
            timer: o[`showTimer${n}`] !== false,
            quickSession: true,
          },
        },
        now,
      ),
    );
  }
  if (anyPrev) s.protection.internalPages = 'auto';
  if (!config.groups.length) r.errors.push('import.error.noSites');
  const { config: normalized, errors } = normalizeConfig(config, now);
  r.config = normalized;
  r.groups = normalized.groups;
  r.errors.push(...errors);
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
