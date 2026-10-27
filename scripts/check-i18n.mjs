#!/usr/bin/env node
/**
 * Message check (npm run i18n):
 *
 * - every message key used in the sources exists in src/locales/en.json;
 * - every message is a string with balanced braces, and every plural or select has an `other`;
 * - every call t('<key>', { … }) or parts('<key>', { … }) with an object literal passes every
 *   placeholder of the message, and every call t('<key>') without parameters is for a message
 *   without placeholders. whenParams(…) and dateTimeParams(…), as the parameters or spread in
 *   them, pass {when}, {day}, {time} and {date}. Calls whose parameters are another expression,
 *   or contain another spread, are skipped;
 * - the description of every English message with placeholders explains each of them;
 * - English messages follow the typography of the translations: ’ for an apostrophe (an ASCII '
 *   only quotes ICU syntax), “ ” for quotes, … for an ellipsis; a number followed by a noun is a
 *   plural ({n, plural, one {# day} other {# days}}), since other languages need more forms;
 * - the locale lists agree: AVAILABLE_LOCALES in src/i18n/i18n.ts, the files in src/locales and
 *   the folders in src/_locales;
 * - every translation (src/locales/<lang>.json, src/_locales/<lang>/messages.json) has only keys of
 *   English, valid ICU syntax with the plural categories of CLDR, the placeholders of English
 *   (plus {day}, {time} and {date} where English has {when}), and store names and descriptions
 *   within the stores' limits;
 * - no message of src/locales/en.json or src/_locales/en/messages.json uses the code
 *   words group, groups, DNR or declarativeNetRequest (placeholder names are not text);
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

/**
 * t('<key>', { (the parameters are an object literal), t('<key>') (no parameters),
 * t('<key>', whenParams(…)) or parts('<key>', {.
 */
const tCall = /\b(?:t|parts)\(\s*'([a-zA-Z0-9_.:-]+)'\s*(?:,\s*(\{|(?:whenParams|dateTimeParams)\()|\))/g;
/** The parameters that whenParams() and dateTimeParams() give a message. */
const WHEN_PARAMS = ['when', 'day', 'time', 'date'];

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
    if (
      /^\.\.\.\(?\s*(?:whenParams|dateTimeParams)\(/.test(p) ||
      /^\.\.\.\(.*\?\s*dateTimeParams\(/.test(p)
    ) {
      keys.push(...WHEN_PARAMS);
      continue;
    }
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
const re = /\b(?:t|parts)\(\s*'([a-zA-Z0-9_.-]+)'/g;
const keyLike = /'((?:[a-z][a-zA-Z0-9]*\.)+[a-zA-Z0-9_-]+)'/g;
// Message namespaces: quoted strings starting with one of them are message keys (passed as data,
// returned as error codes, chosen in ternaries…).
const NAMESPACES = new Set([
  'access',
  'addPage',
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
// The methods of the test build are declared with their handlers.
const testing = await readFile(join(root, 'src/background/testing.ts'), 'utf8');
for (const m of testing.matchAll(/^\s+'(test\.[a-zA-Z]+)':/gm)) NOT_KEYS.add(m[1]);
const changesSrc = await readFile(join(root, 'src/engine/changes.ts'), 'utf8');
for (const m of changesSrc.matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'/g)) NOT_KEYS.add(m[1]);
// So are the settings of earlier versions that normalisation drops (OBSOLETE_SETTINGS).
const schemaSrc = await readFile(join(root, 'src/engine/schema.ts'), 'utf8');
const obsolete = /OBSOLETE_SETTINGS = \[([^\]]*)\]/.exec(schemaSrc)?.[1] ?? '';
for (const m of obsolete.matchAll(/'([a-zA-Z.]+)'/g)) NOT_KEYS.add(m[1]);
for await (const file of walk(join(root, 'src'))) {
  const src = await readFile(file, 'utf8');
  for (const m of src.matchAll(re)) used.add(m[1]);
  for (const m of src.matchAll(tCall)) {
    const end = m.index + m[0].length - 1;
    calls.push({
      file: relative(root, file),
      line: src.slice(0, m.index).split('\n').length,
      key: m[1],
      params: m[2] === '{' ? objectKeys(src, end) : m[2] ? WHEN_PARAMS : [],
    });
  }
  for (const m of src.matchAll(keyLike)) {
    const k = m[1];
    if (NOT_KEYS.has(k)) continue;
    if (k in en || (!IGNORE.test(k) && NAMESPACES.has(k.split('.')[0]))) used.add(k);
  }
}

const DYNAMIC = {
  'duration.unit.{x}': ['seconds', 'minutes', 'hours', 'days'],
  'popup.add.{x}.scope': ['domain', 'host', 'path', 'page'],
  'level.{l}': ['reminder', 'wait', 'password', 'partner', 'locked', 'permanent'],
  'level.{l}.desc': ['reminder', 'wait', 'password', 'partner', 'locked', 'permanent'],
  'level.{l}.weaken': ['reminder', 'wait', 'password', 'partner', 'locked', 'permanent'],
  'intervention.{x}': ['allow', 'track', 'filter', 'ask', 'delay', 'challenge', 'block', 'redirect', 'close'],
  'intervention.help.{x}': [
    'allow',
    'track',
    'filter',
    'ask',
    'delay',
    'challenge',
    'block',
    'redirect',
    'close',
  ],
  'intervention.short.{x}': [
    'allow',
    'track',
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
  'status.type.{x}': ['allow', 'track', 'filter', 'ask', 'delay', 'challenge', 'block', 'close', 'redirect'],
  'wizard.cond.{x}': [
    'always',
    'schedule',
    'daily',
    'daily.each',
    'daily.shared',
    'visits',
    'visits.each',
    'visits.shared',
  ],
  'focus.mode.{x}': ['groups', 'blocklist', 'allowlist'],
  'focus.mode.{x}.desc': ['groups', 'blocklist', 'allowlist'],
  'filter.{x}': ['grayscale', 'blur', 'fade', 'invert', 'sepia'],
  'targetType.{x}': ['domain', 'host', 'path', 'page', 'homepage', 'wildcard', 'regex'],
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
    'clock-realigned',
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
    'options',
  ],
  'save.refused.{x}': ['permanent', 'locked'],
  'pending.error.{x}': ['permanent', 'locked'],
  'period.kind.{x}': ['hour', 'day', 'week', 'month', 'other'],
  'wizard.period.{x}': ['hour', 'day', 'week', 'month'],
  'why.restriction.{x}': ['budget', 'schedule', 'pause', 'pass', 'session'],
  'schedule.preset.{x}': ['office', 'evenings', 'allDay', 'weekdays', 'nights'],
  'pauseRules.costKind.{x}': ['none', 'confirm', 'delay', 'random', 'phrase', 'math', 'password'],
  'delay.length.{x}': ['fixed', 'random', 'growing'],
  'settings.tab.{x}': ['general', 'feedback', 'time', 'interventions', 'data', 'privacy', 'diagnostics'],
  'settings.corner.{x}': ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  'settings.size.{x}': ['small', 'medium', 'large'],
  'insights.span.{x}': ['day', 'week', 'month', 'year'],
  'import.format.{x}': ['webhandbrake', 'list', 'unknown'],
  'welcome.value.{x}.title': ['gentle', 'firm', 'private'],
  'welcome.value.{x}.text': ['gentle', 'firm', 'private'],
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
    'hour12',
    'dateFormat',
    'weekStart',
    'dayStart',
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
    'interventions.graceSeconds',
    'interventions.autoReopen',
    'pauseLimit',
    'protection.confirmHours',
    'protection.internalPages',
    'protection.internalPagesFollowPause',
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
    'focus',
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
/**
 * The problems of an ICU message as a translation platform would see them: syntax, a plural or
 * select without `other`, a plural category that CLDR does not have. Apostrophes quote syntax
 * characters as in src/i18n/icu.ts.
 */
function icuProblems(message) {
  const problems = [];
  let i = 0;
  const ws = () => {
    while (/\s/.test(message[i] ?? '')) i++;
  };
  const ident = () => {
    ws();
    const start = i;
    while (i < message.length && /[^\s,{}]/.test(message[i])) i++;
    return message.slice(start, i);
  };
  const nodes = (nested, inPlural) => {
    while (i < message.length) {
      const c = message[i];
      if (c === "'") {
        const next = message[i + 1];
        if (next === "'") i += 2;
        else if (next === '{' || next === '}' || (inPlural && next === '#')) {
          const end = message.indexOf("'", i + 1);
          if (end === -1) problems.push('an apostrophe opens a quote that never closes');
          i = end === -1 ? message.length : end + 1;
        } else i++;
      } else if (c === '}') {
        if (nested) return;
        problems.push('a } without a {');
        i++;
      } else if (c === '{') {
        i++;
        arg();
      } else i++;
    }
    if (nested) problems.push('a { without a }');
  };
  const arg = () => {
    const name = ident();
    if (!/^[\w.]+$/.test(name)) problems.push(`a placeholder without a valid name: {${name}`);
    ws();
    if (message[i] === '}') {
      i++;
      return;
    }
    if (message[i] !== ',') {
      problems.push(`{${name} is not followed by } or ,`);
      return;
    }
    i++;
    const type = ident();
    ws();
    if (type === 'number') {
      while (i < message.length && message[i] !== '}') i++;
      i++;
      return;
    }
    if (type !== 'plural' && type !== 'select' && type !== 'selectordinal') {
      problems.push(`{${name}, ${type}}: unknown argument type`);
      while (i < message.length && message[i] !== '}') i++;
      i++;
      return;
    }
    if (message[i] !== ',') {
      problems.push(`{${name}, ${type}} has no options`);
      return;
    }
    i++;
    const keys = [];
    for (;;) {
      ws();
      if (i >= message.length) {
        problems.push(`{${name}, ${type}, …} never closes`);
        return;
      }
      if (message[i] === '}') {
        i++;
        break;
      }
      const key = ident();
      ws();
      if (type !== 'select' && key.startsWith('offset:')) continue;
      if (message[i] !== '{') {
        problems.push(`{${name}, ${type}}: option ${key} has no {…}`);
        return;
      }
      keys.push(key);
      i++;
      nodes(true, type !== 'select');
      i++;
    }
    if (!keys.includes('other')) problems.push(`{${name}, ${type}} has no other {…}`);
    if (type !== 'select')
      for (const k of keys)
        if (!/^=\d+$/.test(k) && !PLURAL_CATEGORIES.includes(k))
          problems.push(`{${name}, ${type}}: ${k} is not a plural category`);
  };
  nodes(false, false);
  return problems;
}
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

for (const [k, v] of Object.entries(en)) {
  if (typeof v?.message !== 'string') continue;
  for (const problem of icuProblems(v.message)) {
    console.error(`src/locales/en.json: ${k}: ${problem}`);
    bad++;
  }
}

// The typography the translations follow: ’ “ ” …; an ASCII apostrophe only quotes ICU syntax.
for (const [k, v] of Object.entries(en)) {
  if (typeof v?.message !== 'string') continue;
  const m = v.message;
  const loose = m.replace(/'(?:[{}#][^']*'|')/g, '');
  if (loose.includes("'")) {
    console.error(`src/locales/en.json: ${k}: use ’ for an apostrophe (an ASCII ' quotes ICU syntax)`);
    bad++;
  }
  if (m.includes('"')) {
    console.error(`src/locales/en.json: ${k}: use “ ” for quotes`);
    bad++;
  }
  if (m.includes('...')) {
    console.error(`src/locales/en.json: ${k}: use … for an ellipsis`);
    bad++;
  }
}

// A number followed by a noun is a plural: "{days} days" reads "2 dni" and "5 dni" in Polish, but
// "2 godziny" and "5 godzin". Abbreviations (s, min, h, MB) do not change.
const NUMBERS =
  /^(?:n|count|seconds|minutes|hours|days|length|recent|daily|keepDays|returnMinutes|confirmHours|total|increase|to)$/;
const NOT_NOUNS = new Set(['s', 'min', 'h', 'MB', 'of', 'and', 'or', 'to', 'more', 'in', 'from', 'at']);
for (const [k, v] of Object.entries(en)) {
  if (typeof v?.message !== 'string') continue;
  // Only the text outside plural and select arguments.
  let text = v.message;
  for (let n = 0; n < 6; n++)
    text = text.replace(/\{\w+, (?:plural|select|selectordinal),[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '#');
  for (const m of text.matchAll(/\{(\w+)\}[ -]([\p{L}]+)/gu)) {
    if (!NUMBERS.test(m[1]) || NOT_NOUNS.has(m[2])) continue;
    console.error(`src/locales/en.json: ${k}: {${m[1]}} ${m[2]}: write the number as a plural`);
    bad++;
  }
}

// Translators see a message alone: its description says what each placeholder holds.
for (const [k, v] of Object.entries(en)) {
  if (typeof v?.message !== 'string') continue;
  const unexplained = placeholders(v.message).filter((name) => !v.description?.includes(`{${name}}`));
  if (unexplained.length) {
    console.error(
      `src/locales/en.json: ${k}: the description does not explain ${unexplained.map((n) => `{${n}}`).join(', ')}`,
    );
    bad++;
  }
}

/** The placeholders that a translation may use: those of English, and the parts of a moment. */
function allowedPlaceholders(message) {
  const names = placeholders(message);
  return names.includes('when') ? [...names, 'day', 'time', 'date'] : names;
}

// Translations: only keys of English, valid ICU, the placeholders of English.
for (const file of (await readdir(join(root, 'src/locales'))).filter((f) => f.endsWith('.json'))) {
  if (file === 'en.json') continue;
  const where = `src/locales/${file}`;
  const messages = JSON.parse(await readFile(join(root, where), 'utf8'));
  for (const [k, v] of Object.entries(messages)) {
    if (!(k in en)) {
      console.error(`${where}: ${k} is not an English key`);
      bad++;
      continue;
    }
    if (typeof v?.message !== 'string') {
      console.error(`${where}: ${k}: invalid entry`);
      bad++;
      continue;
    }
    for (const problem of icuProblems(v.message)) {
      console.error(`${where}: ${k}: ${problem}`);
      bad++;
    }
    const allowed = allowedPlaceholders(en[k].message);
    const used = placeholders(v.message);
    for (const name of used.filter((n) => !allowed.includes(n))) {
      console.error(`${where}: ${k}: {${name}} is not a placeholder of the English message`);
      bad++;
    }
    for (const name of placeholders(en[k].message).filter((n) => !used.includes(n) && n !== 'when')) {
      console.error(`${where}: ${k}: {${name}} of the English message is missing`);
      bad++;
    }
    if (placeholders(en[k].message).includes('when') && !used.some((n) => WHEN_PARAMS.includes(n))) {
      console.error(`${where}: ${k}: the moment ({when}, or {time} and {date}) is missing`);
      bad++;
    }
  }
}

// The names and descriptions of the stores and the browser: the limits of the stores, in every
// language (addons.mozilla.org: names of 50 characters at most; Chrome: descriptions of 132).
const STORE_LIMITS = { extName: 50, extDescription: 132 };
const manifestEn = JSON.parse(await readFile(join(root, 'src/_locales/en/messages.json'), 'utf8'));
for (const folder of await readdir(join(root, 'src/_locales'))) {
  const where = `src/_locales/${folder}/messages.json`;
  const messages = JSON.parse(await readFile(join(root, where), 'utf8'));
  for (const [k, v] of Object.entries(messages)) {
    if (!(k in manifestEn)) {
      console.error(`${where}: ${k} is not an English key`);
      bad++;
      continue;
    }
    const limit = STORE_LIMITS[k];
    if (limit && [...v.message].length > limit) {
      console.error(`${where}: ${k} has ${[...v.message].length} characters, ${limit} at most`);
      bad++;
    }
  }
}

// Interface strings use the interface terms (rule, browser blocking filters), never the
// code words. Placeholder names and ICU keywords are not text.
const CODE_WORDS = /(?<![\p{L}\p{N}_])(?:group|groups|DNR|declarativeNetRequest)(?![\p{L}\p{N}_])/giu;
const manifestStrings = JSON.parse(await readFile(join(root, 'src/_locales/en/messages.json'), 'utf8'));
for (const [file, messages] of [
  ['src/locales/en.json', en],
  ['src/_locales/en/messages.json', manifestStrings],
]) {
  for (const [k, v] of Object.entries(messages)) {
    if (typeof v?.message !== 'string') continue;
    const text = v.message.replace(/\{\s*[\w.]+\s*(?:,\s*\w+\s*,?)?/g, ' ').replace(/\$\w+\$/g, ' ');
    for (const m of text.matchAll(CODE_WORDS)) {
      console.error(`${file}: ${k}: '${m[0]}' is a code word; use the interface term`);
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
