#!/usr/bin/env node
/**
 * I18N-01 check (npm run i18n):
 *
 * - every message key used in the sources exists in src/locales/en.json;
 * - every message is a string with balanced braces;
 * - every call t('<key>', { … }) with an object literal passes every placeholder of the message,
 *   and every call t('<key>') without parameters is for a message without placeholders (calls
 *   whose parameters are not an object literal, or contain a spread, are skipped);
 * - the locale lists agree: AVAILABLE_LOCALES in src/i18n/i18n.ts, the files in src/locales and
 *   the folders in src/_locales;
 * - with --unused, it lists the keys that are no longer used.
 *
 * Keys are found as quoted strings in the sources (a known namespace followed by a dot). Keys built
 * from template literals are declared in DYNAMIC below.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(await readFile(join(root, 'src/locales/en.json'), 'utf8'));

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

/** t('<key>', { (the parameters are an object literal) or t('<key>') (no parameters). */
const tCall = /\bt\(\s*'([a-zA-Z0-9_.:-]+)'\s*(?:,\s*\{|\))/g;

/**
 * The top-level property names of the object literal that opens at src[open] ('{'), or null when it
 * contains a spread. Strings, template literals and nested brackets are skipped.
 */
function objectKeys(src, open) {
  const parts = [];
  let depth = 0;
  let part = '';
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = skipString(src, i);
      part += src.slice(i, end + 1);
      i = end;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') {
      depth++;
      if (depth === 1) continue;
    } else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0) break;
    } else if (c === ',' && depth === 1) {
      parts.push(part);
      part = '';
      continue;
    }
    part += c;
  }
  parts.push(part);
  const keys = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (p.startsWith('...')) return null;
    const m = p.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))/);
    if (m) keys.push(m[1] ?? m[2] ?? m[3]);
  }
  return keys;
}

/** The index of the quote that closes the string or template literal starting at src[start]. */
function skipString(src, start) {
  const q = src[start];
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === q) return i;
    else if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
      let depth = 0;
      for (i++; i < src.length; i++) {
        if (src[i] === "'" || src[i] === '"' || src[i] === '`') i = skipString(src, i);
        else if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
      }
    }
  }
  return src.length;
}

/**
 * The argument names of an ICU message: {name}, {n, number}, and the variables of plural and
 * select, including those nested in their options. Apostrophes quote syntax characters as in ICU.
 */
function placeholders(message) {
  const names = new Set();
  let i = 0;
  const ident = () => {
    while (/\s/.test(message[i] ?? '')) i++;
    const start = i;
    while (i < message.length && /[^\s,{}]/.test(message[i])) i++;
    return message.slice(start, i);
  };
  const nodes = (nested) => {
    while (i < message.length) {
      const c = message[i];
      if (c === "'") {
        const next = message[i + 1];
        if (next === "'") i += 2;
        else if (next === '{' || next === '}' || next === '#') {
          const end = message.indexOf("'", i + 1);
          i = end === -1 ? message.length : end + 1;
        } else i++;
      } else if (c === '}' && nested) return;
      else if (c === '{') {
        i++;
        arg();
      } else i++;
    }
  };
  const arg = () => {
    names.add(ident());
    while (/\s/.test(message[i] ?? '')) i++;
    if (message[i] === '}') {
      i++;
      return;
    }
    i++; // ,
    const type = ident();
    while (/\s/.test(message[i] ?? '')) i++;
    if (type !== 'plural' && type !== 'select' && type !== 'selectordinal') {
      while (i < message.length && message[i] !== '}') i++;
      i++;
      return;
    }
    i++; // ,
    for (;;) {
      while (/\s/.test(message[i] ?? '')) i++;
      if (i >= message.length) return;
      if (message[i] === '}') {
        i++;
        return;
      }
      ident();
      while (/\s/.test(message[i] ?? '')) i++;
      if (message[i] !== '{') continue; // offset:n
      i++;
      nodes(true);
      i++; // }
    }
  };
  nodes(false);
  return [...names];
}

const used = new Set();
/** Calls t('<key>', { … }) and t('<key>'): file, line, key, parameter names (null with a spread). */
const calls = [];
const re = /\bt\(\s*'([a-zA-Z0-9_.-]+)'/g;
const keyLike = /'((?:[a-z][a-zA-Z0-9]*\.)+[a-zA-Z0-9_-]+)'/g;
// Message namespaces: quoted strings starting with one of them are message keys (passed as data,
// returned as error codes, chosen in ternaries…).
const NAMESPACES = new Set([
  'access',
  'addPage',
  'allowlist',
  'alternatives',
  'ask',
  'backup',
  'backups',
  'badge',
  'budget',
  'challenge',
  'checklist',
  'common',
  'cost',
  'data',
  'days',
  'delay',
  'diag',
  'duration',
  'editor',
  'emergency',
  'ext',
  'filter',
  'focus',
  'grant',
  'groups',
  'help',
  'icon',
  'import',
  'insights',
  'intervention',
  'iv',
  'later',
  'level',
  'lists',
  'locked',
  'menu',
  'nav',
  'notify',
  'overlay',
  'pause',
  'pauseRules',
  'pending',
  'period',
  'policy',
  'popup',
  'privacy',
  'protection',
  'redirect',
  'save',
  'schedule',
  'session',
  'settings',
  'status',
  'summary',
  'tamper',
  'target',
  'targetType',
  'targets',
  'template',
  'test',
  'ticket',
  'time',
  'today',
  'unit',
  'validate',
  'warning',
  'welcome',
  'why',
  'wizard',
]);
const IGNORE = /\.(ts|tsx|js|json|css|html|png|svg|com)$|^(chrome|moz)-|^webhandbrake\./;
// RPC method names and setting paths look like keys but are not messages.
const rpc = await readFile(join(root, 'src/shared/rpc.ts'), 'utf8');
const NOT_KEYS = new Set([...rpc.matchAll(/^\s+'?([a-zA-Z.]+)'?:\s*\{/gm)].map((m) => m[1]));
// The methods of the test build (docs/testing.md) are declared with their handlers.
const testing = await readFile(join(root, 'src/background/testing.ts'), 'utf8');
for (const m of testing.matchAll(/^\s+'(test\.[a-zA-Z]+)':/gm)) NOT_KEYS.add(m[1]);
const changesSrc = await readFile(join(root, 'src/engine/changes.ts'), 'utf8');
for (const m of changesSrc.matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'/g)) NOT_KEYS.add(m[1]);
for await (const file of walk(join(root, 'src'))) {
  const src = await readFile(file, 'utf8');
  for (const m of src.matchAll(re)) used.add(m[1]);
  for (const m of src.matchAll(tCall)) {
    const end = m.index + m[0].length - 1;
    calls.push({
      file: relative(root, file),
      line: src.slice(0, m.index).split('\n').length,
      key: m[1],
      params: src[end] === '{' ? objectKeys(src, end) : [],
    });
  }
  for (const m of src.matchAll(keyLike)) {
    const k = m[1];
    if (NOT_KEYS.has(k)) continue;
    if (k in en || (!IGNORE.test(k) && NAMESPACES.has(k.split('.')[0]))) used.add(k);
  }
}

const DYNAMIC = {
  'level.{l}': ['soft', 'balanced', 'strict', 'locked'],
  'level.{l}.desc': ['soft', 'balanced', 'strict', 'locked'],
  'level.{l}.weaken': ['soft', 'balanced', 'strict', 'locked'],
  'level.{l}.pauses': ['soft', 'balanced', 'strict', 'locked'],
  'intervention.{x}': [
    'allow',
    'track',
    'remind',
    'filter',
    'ask',
    'delay',
    'challenge',
    'block',
    'redirect',
    'close',
  ],
  'intervention.help.{x}': [
    'track',
    'remind',
    'filter',
    'ask',
    'delay',
    'challenge',
    'block',
    'redirect',
    'close',
  ],
  'intervention.short.{x}': [
    'track',
    'remind',
    'filter',
    'ask',
    'delay',
    'challenge',
    'block',
    'close',
    'redirect',
  ],
  'icon.{x}': [
    'circle',
    'users',
    'play',
    'newspaper',
    'cart',
    'gamepad',
    'dice',
    'chat',
    'eye-off',
    'globe',
    'heart',
    'zap',
  ],
  'status.type.{x}': [
    'allow',
    'track',
    'remind',
    'filter',
    'ask',
    'delay',
    'challenge',
    'block',
    'close',
    'redirect',
  ],
  'wizard.step.{x}': ['sites', 'when', 'how', 'review'],
  'wizard.{x}.title': ['sites', 'when', 'how', 'review'],
  'wizard.{x}.intro': ['sites', 'when', 'how', 'review'],
  'wizard.when.{x}': ['always', 'schedule', 'daily'],
  'wizard.when.{x}.desc': ['always', 'schedule', 'daily'],
  'wizard.cond.{x}': ['always', 'schedule', 'daily'],
  'wizard.then.{x}': ['track', 'remind', 'filter', 'ask', 'delay', 'challenge', 'block', 'close', 'redirect'],
  'editor.section.{x}': ['sites', 'rules', 'breaks', 'page', 'protection', 'advanced'],
  'focus.mode.{x}': ['groups', 'allowlist'],
  'focus.mode.{x}.desc': ['groups', 'allowlist'],
  'filter.{x}': ['grayscale', 'blur', 'fade', 'invert', 'sepia', 'custom', 'none'],
  'targetType.{x}': ['domain', 'host', 'path', 'page', 'homepage', 'regex'],
  'warning.{x}': [
    'host-permission',
    'incognito',
    'restored',
    'dnr-overflow',
    'dnr-error',
    'tamper',
    'pending-ready',
    'locked-out',
    'clock',
  ],
  'warning.{x}.short': ['host-permission', 'dnr-error'],
  'tamper.{x}': [
    'clock-backward',
    'clock-skew',
    'state-restored',
    'host-permission',
    'private-access',
    'inactive-gap',
    'rules-mismatch',
    'emergency',
  ],
  'unit.field.{x}': [
    'meta',
    'note',
    'message',
    'enabled',
    'archived',
    'policies',
    'pause',
    'protection',
    'protectionUntil',
    'options',
  ],
  'save.refused.{x}': ['locked', 'lockedNow', 'accessWindow'],
  'period.kind.{x}': ['hour', 'day', 'week', 'month', 'minutes', 'days', 'rolling'],
  'why.restriction.{x}': ['budget', 'schedule', 'grant', 'session'],
  'schedule.preset.{x}': ['office', 'evenings', 'allDay', 'weekdays', 'nights'],
  'pause.scope.{x}': ['page', 'site', 'group', 'all'],
  'pauseRules.costKind.{x}': ['none', 'confirm', 'delay', 'random', 'phrase', 'math', 'password'],
  'challenge.charset.{x}': ['alnum', 'letters', 'digits', 'symbols'],
  'settings.tab.{x}': ['general', 'feedback', 'time', 'interventions', 'data', 'privacy', 'diagnostics'],
  'settings.corner.{x}': ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  'settings.size.{x}': ['small', 'medium', 'large'],
  'insights.span.{x}': ['day', 'week', 'month', 'year'],
  'import.format.{x}': ['webhandbrake', 'list', 'unknown'],
  'welcome.goal.{x}': ['schedule', 'limit', 'friction', 'block', 'track'],
  'welcome.goal.{x}.desc': ['schedule', 'limit', 'friction', 'block', 'track'],
  'welcome.{x}.title': ['goal', 'sites', 'plan'],
  'welcome.{x}.intro': ['goal', 'sites', 'plan'],
  'welcome.step.{x}': ['goal', 'sites', 'plan'],
  'welcome.step.details.{x}': ['friction', 'limit', 'schedule'],
  'welcome.details.{x}': ['friction', 'limit', 'schedule'],
  'welcome.details.{x}.intro': ['friction', 'limit', 'schedule'],
  'welcome.details.{x}.then': ['limit', 'schedule'],
  'welcome.value.{x}.title': ['gentle', 'firm', 'private'],
  'welcome.value.{x}.text': ['gentle', 'firm', 'private'],
  'welcome.level.{x}': ['soft', 'balanced', 'strict'],
  'nav.{x}': ['today', 'groups', 'focus', 'later', 'insights', 'protection', 'settings', 'help'],
  'backup.reason.{x}': [
    'edit',
    'daily',
    'install',
    'import-webhandbrake',
    'import-list',
    'import-group',
    'restore',
    'reset',
    'add-page',
    'pending',
    'password',
    'emergency',
    'onboarding',
  ],
  'setting.{x}': [
    'language',
    'theme',
    'highContrast',
    'accent',
    'hour12',
    'dateFormat',
    'weekStart',
    'dayStart',
    'advanced',
    'timer.enabled',
    'timer.thresholdMinutes',
    'timer.corner',
    'timer.size',
    'timer.opacity',
    'badge.enabled',
    'badge.thresholdMinutes',
    'contextMenu',
    'notifications.enabled',
    'notifications.sessionEnd',
    'notifications.pendingReady',
    'notifications.warning',
    'warningSeconds',
    'sound',
    'tracking.idleSeconds',
    'tracking.idleEnabled',
    'tracking.countAudio',
    'tracking.countInactive',
    'tracking.visitGapMinutes',
    'tracking.allSites',
    'tracking.retentionDays',
    'interventions.hideUrl',
    'interventions.customCss',
    'interventions.alternatives',
    'interventions.graceSeconds',
    'interventions.autoReopen',
    'pauseLimit',
    'protection.level',
    'protection.lockedUntil',
    'protection.fallback',
    'protection.coolingOffHours',
    'protection.confirmHours',
    'protection.balancedDelaySeconds',
    'protection.challengeLength',
    'protection.internalPages',
    'protection.internalPagesFollowPause',
    'protection.access.passwordHash',
    'protection.access.codeLength',
    'protection.access.lockWindows',
    'protection.emergencyHours',
    'later.notify',
    'diagnostics.decisionLog',
    'clock.useDateHeaders',
    'onboarded',
  ],
  'privacy.key.{x}': [
    'config',
    'state',
    'activity',
    'usage',
    'backups',
    'later',
    'meta',
    'intentions',
    'u:min',
  ],
};

for (const [pattern, values] of Object.entries(DYNAMIC))
  for (const v of values) used.add(pattern.replace(/\{\w+\}/, v));

const missing = [...used].filter((k) => !(k in en)).sort();
let bad = 0;
for (const [k, v] of Object.entries(en)) {
  if (typeof v?.message !== 'string') {
    console.error(`invalid entry: ${k}`);
    bad++;
    continue;
  }
  let depth = 0;
  for (const ch of v.message.replace(/'[{}]'/g, '')) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) {
    console.error(`unbalanced braces: ${k}`);
    bad++;
  }
}
if (missing.length) {
  console.error(`Missing ${missing.length} keys:\n${missing.join('\n')}`);
}

// Every placeholder of the message is passed: a missing parameter renders as an empty string.
for (const c of calls) {
  const message = en[c.key]?.message;
  if (typeof message !== 'string' || !c.params) continue;
  const absent = placeholders(message).filter((name) => !c.params.includes(name));
  if (absent.length) {
    console.error(
      `${c.file}:${c.line}: t('${c.key}') does not pass ${absent.map((n) => `{${n}}`).join(', ')}`,
    );
    bad++;
  }
}

// The three locale lists agree: the language setting, the message files and the manifest strings.
const i18nSrc = await readFile(join(root, 'src/i18n/i18n.ts'), 'utf8');
const listSrc = i18nSrc.match(/export const AVAILABLE_LOCALES[^=]*=\s*\[([\s\S]*?)\];/)?.[1];
if (!listSrc) {
  console.error('src/i18n/i18n.ts: AVAILABLE_LOCALES not found');
  bad++;
} else {
  const codes = [...listSrc.matchAll(/code:\s*'([^']+)'/g)].map((m) => m[1]).sort();
  const files = (await readdir(join(root, 'src/locales')))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
  const folders = (await readdir(join(root, 'src/_locales'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name.replace('_', '-'))
    .sort();
  const lists = {
    'AVAILABLE_LOCALES in src/i18n/i18n.ts': codes,
    'files in src/locales': files,
    'folders in src/_locales': folders,
  };
  const all = [...new Set([...codes, ...files, ...folders])].sort();
  for (const [where, list] of Object.entries(lists)) {
    const absent = all.filter((code) => !list.includes(code));
    if (absent.length) {
      console.error(`locale lists differ: ${absent.join(', ')} missing from ${where}`);
      bad++;
    }
  }
}
if (process.argv.includes('--unused')) {
  const unused = Object.keys(en).filter((k) => !used.has(k));
  console.log(`Unused (${unused.length}):\n${unused.join('\n')}`);
}
if (missing.length || bad) process.exit(1);
console.log(
  `i18n ok: ${Object.keys(en).length} messages, ${used.size} used keys, ${calls.length} literal calls checked for placeholders`,
);
