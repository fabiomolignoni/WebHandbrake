#!/usr/bin/env node
/**
 * I18N-01 check: every message key used in the sources exists in src/locales/en.json, every
 * message parses as ICU, and (with --unused) lists keys that are no longer used.
 * Dynamic keys (template literals) are declared in DYNAMIC below.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

const used = new Set();
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
  'summary',
  'tamper',
  'target',
  'targetType',
  'targets',
  'template',
  'templateStyle',
  'test',
  'ticket',
  'time',
  'today',
  'unit',
  'validate',
  'warning',
  'welcome',
  'why',
]);
const IGNORE = /\.(ts|tsx|js|json|css|html|png|svg|com)$|^(chrome|moz)-|^webhandbrake\./;
// RPC method names and setting paths look like keys but are not messages.
const rpc = await readFile(join(root, 'src/shared/rpc.ts'), 'utf8');
const NOT_KEYS = new Set([...rpc.matchAll(/^\s+'?([a-zA-Z.]+)'?:\s*\{/gm)].map((m) => m[1]));
const changesSrc = await readFile(join(root, 'src/engine/changes.ts'), 'utf8');
for (const m of changesSrc.matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'/g)) NOT_KEYS.add(m[1]);
for await (const file of walk(join(root, 'src'))) {
  const src = await readFile(file, 'utf8');
  for (const m of src.matchAll(re)) used.add(m[1]);
  for (const m of src.matchAll(keyLike)) {
    const k = m[1];
    if (IGNORE.test(k) || NOT_KEYS.has(k)) continue;
    if (k in en || NAMESPACES.has(k.split('.')[0])) used.add(k);
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
  'import.format.{x}': ['webhandbrake', 'leechblock', 'list', 'unknown'],
  'templateStyle.{x}': ['ask', 'block'],
  'welcome.goal.{x}': ['schedule', 'limit', 'friction', 'block', 'track'],
  'welcome.goal.{x}.desc': ['schedule', 'limit', 'friction', 'block', 'track'],
  'welcome.style.{x}': ['ask', 'delay', 'block'],
  'welcome.style.{x}.desc': ['ask', 'delay', 'block'],
  'help.{x}.title': [
    'start',
    'groups',
    'rules',
    'interventions',
    'pauses',
    'focus',
    'protection',
    'emergency',
    'privacy',
    'mobile',
  ],
  'help.faq.{x}.q': ['private', 'flash', 'locked', 'android', 'leechblock', 'sync', 'uninstall'],
  'help.faq.{x}.a': ['private', 'flash', 'locked', 'android', 'leechblock', 'sync', 'uninstall'],
  'nav.{x}': ['today', 'groups', 'focus', 'later', 'insights', 'protection', 'settings', 'help'],
  'backup.reason.{x}': [
    'edit',
    'daily',
    'install',
    'import-webhandbrake',
    'import-leechblock',
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
const HELP_PARAGRAPHS = {
  start: 3,
  groups: 3,
  rules: 4,
  interventions: 3,
  pauses: 2,
  focus: 2,
  protection: 4,
  emergency: 2,
  privacy: 2,
  mobile: 2,
};

for (const [pattern, values] of Object.entries(DYNAMIC))
  for (const v of values) used.add(pattern.replace(/\{\w+\}/, v));
for (const [id, n] of Object.entries(HELP_PARAGRAPHS))
  for (let i = 1; i <= n; i++) used.add(`help.${id}.p${i}`);

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
if (process.argv.includes('--unused')) {
  const unused = Object.keys(en).filter((k) => !used.has(k));
  console.log(`Unused (${unused.length}):\n${unused.join('\n')}`);
}
if (missing.length || bad) process.exit(1);
console.log(`i18n ok: ${Object.keys(en).length} messages, ${used.size} used keys`);
