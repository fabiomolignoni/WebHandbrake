/**
 * The fact registry: values that the code owns and the documents quote through fact markers,
 * `<!-- fact: name|transform -->value<!-- /fact -->`. `npm run docs` rewrites each value and
 * `npm run docs:check` fails when one differs from the code.
 *
 * Names:
 * - package.version; toolchain.node (.nvmrc); toolchain.engines (package.json engines.node)
 * - manifest.chrome.min, manifest.firefox.min, manifest.android.min (without ".0");
 *   manifest.geckoId; manifest.dataCollection; manifest.csp; manifest.description (the English
 *   extDescription); manifest.permissions, manifest.optionalPermissions, manifest.hostPermissions
 *   (lists); manifest.shortcut.<command> (the default key)
 * - defaults.<path>: any leaf of defaultConfig() (src/engine/defaults.ts)
 * - limits.<EXPORT>: every export of src/engine/limits.ts
 * - data.exportFormat, data.exportVersion, data.exportRuleFormat, data.exportRuleVersion
 *   (src/engine/importers.ts); data.schemaVersion (src/engine/types.ts)
 * - templates.count; templates.sensitive (the names of the sensitive ready-made lists)
 * - enforce.internalPages (the browser pages that protection can block, src/background/enforce.ts)
 * - test.axeTags (tests/e2e/harness/harness.ts); test.geckodriver (scripts/browsers.mjs)
 * - label:<key>: a message of src/locales/en.json
 *
 * Transforms, applied in order after the name: seconds, minutes, hours, days (from the unit that
 * the name's suffix declares: _MS or Ms, _SECONDS or Seconds, _MINUTES or Minutes, _HOURS or Hours,
 * _DAYS or Days); mib (from _BYTES); hhmm (minutes after midnight as HH:MM); grouped (600000 as
 * 600,000); code (each list item in backticks). A list is written as "a, b, c".
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadModules } from './ts.mjs';

const MS = { ms: 1, s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000 };
const UNIT_SUFFIX = [
  [/(_MS|Ms)$/, 'ms'],
  [/(_SECONDS|Seconds)$/, 's'],
  [/(_MINUTES|Minutes)$/, 'min'],
  [/(_HOURS|Hours)$/, 'h'],
  [/(_DAYS|Days)$/, 'd'],
  [/(_BYTES|Bytes)$/, 'bytes'],
];
const TO_UNIT = { seconds: 's', minutes: 'min', hours: 'h', days: 'd' };

export const TRANSFORMS = ['seconds', 'minutes', 'hours', 'days', 'mib', 'hhmm', 'grouped', 'code'];

/** The registry: a Map from fact name to its value (a number, a string or a list of them). */
export async function loadFacts(repo) {
  const facts = new Map();
  const errors = [];
  const json = (path) => JSON.parse(repo.read(path));
  const fromSource = (name, path, re, parse = (m) => m[1]) => {
    const m = repo.read(path)?.match(re);
    if (m) facts.set(name, parse(m));
    else errors.push(`the registry cannot read ${name} from ${path}: update scripts/docs/facts.mjs`);
  };

  const pkg = json('package.json');
  facts.set('package.version', pkg.version);
  facts.set('toolchain.node', (repo.read('.nvmrc') ?? '').trim());
  facts.set('toolchain.engines', pkg.engines?.node ?? '');

  const { manifest } = await import(pathToFileURL(join(repo.root, 'scripts/manifest.mjs')).href);
  const chrome = manifest('chrome', pkg.version);
  const firefox = manifest('firefox', pkg.version);
  const bare = (v) => String(v ?? '').replace(/\.0$/, '');
  const gecko = firefox.browser_specific_settings ?? {};
  facts.set('manifest.chrome.min', bare(chrome.minimum_chrome_version));
  facts.set('manifest.firefox.min', bare(gecko.gecko?.strict_min_version));
  facts.set('manifest.android.min', bare(gecko.gecko_android?.strict_min_version));
  facts.set('manifest.geckoId', gecko.gecko?.id ?? '');
  facts.set('manifest.dataCollection', gecko.gecko?.data_collection_permissions?.required ?? []);
  facts.set('manifest.csp', chrome.content_security_policy?.extension_pages ?? '');
  facts.set('manifest.description', json('src/_locales/en/messages.json').extDescription?.message ?? '');
  facts.set('manifest.permissions', chrome.permissions ?? []);
  facts.set('manifest.optionalPermissions', chrome.optional_permissions ?? []);
  facts.set('manifest.hostPermissions', chrome.host_permissions ?? []);
  for (const [command, def] of Object.entries(chrome.commands ?? {})) {
    if (def.suggested_key?.default) facts.set(`manifest.shortcut.${command}`, def.suggested_key.default);
  }

  const m = await loadModules(repo.root);
  const leaves = (value, path) => {
    if (Array.isArray(value) && value.every((v) => v === null || typeof v !== 'object'))
      facts.set(path, value);
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) leaves(v, `${path}.${k}`);
    } else if (value !== undefined && value !== null) facts.set(path, value);
  };
  leaves(m.defaultConfig(), 'defaults');
  for (const [k, v] of Object.entries(m.limits)) facts.set(`limits.${k}`, v);
  facts.set('data.exportFormat', m.EXPORT_FORMAT);
  facts.set('data.exportVersion', m.EXPORT_VERSION);
  facts.set('data.exportRuleFormat', m.EXPORT_RULE_FORMAT);
  facts.set('data.exportRuleVersion', m.EXPORT_RULE_VERSION);
  facts.set('data.schemaVersion', m.SCHEMA_VERSION);

  const en = json('src/locales/en.json');
  facts.set('templates.count', m.TEMPLATES.length);
  facts.set(
    'templates.sensitive',
    m.TEMPLATES.filter((t) => t.sensitive).map((t) => en[t.nameKey]?.message ?? t.id),
  );

  fromSource(
    'enforce.internalPages',
    'src/background/enforce.ts',
    /const INTERNAL_PAGES\s*=\s*\[([^\]]*)\]/,
    (x) => [...x[1].matchAll(/'([^']+)'/g)].map((y) => y[1]),
  );
  fromSource('test.axeTags', 'tests/e2e/harness/harness.ts', /axe\(tags = \[([^\]]*)\]/, (x) =>
    [...x[1].matchAll(/'([^']+)'/g)].map((y) => y[1]),
  );
  fromSource('test.geckodriver', 'scripts/browsers.mjs', /const GECKODRIVER = '([^']+)'/);

  for (const [k, v] of Object.entries(en)) facts.set(`label:${k}`, v.message);
  return { facts, errors };
}

/** The unit that a fact name's suffix declares, or null. */
function unitOf(name) {
  const last = name.split(/[.:]/).at(-1);
  return UNIT_SUFFIX.find(([re]) => re.test(last))?.[1] ?? null;
}

function round(n) {
  return Number.isInteger(n) ? n : Math.round(n * 100) / 100;
}

/**
 * Renders a fact with its transforms. Returns { value } or { error }.
 */
export function render(facts, name, transforms) {
  if (!facts.has(name)) return { error: unknownFact(facts, name) };
  let unit = unitOf(name);
  let items = [facts.get(name)].flat();
  const isList = Array.isArray(facts.get(name));
  let code = false;
  for (const t of transforms) {
    if (!TRANSFORMS.includes(t))
      return { error: `unknown transform '${t}'; use one of ${TRANSFORMS.join(', ')}` };
    if (t in TO_UNIT) {
      if (!unit || !(unit in MS))
        return { error: `fact ${name} has no time unit in its name, so '${t}' cannot apply` };
      items = items.map((v) => round((v * MS[unit]) / MS[TO_UNIT[t]]));
      unit = TO_UNIT[t];
    } else if (t === 'mib') {
      if (unit !== 'bytes') return { error: `fact ${name} is not in bytes, so 'mib' cannot apply` };
      items = items.map((v) => round(v / 1024 / 1024));
      unit = null;
    } else if (t === 'hhmm') {
      items = items.map(
        (v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`,
      );
    } else if (t === 'grouped') {
      items = items.map((v) => (typeof v === 'number' ? v.toLocaleString('en-GB') : v));
    } else if (t === 'code') code = true;
  }
  items = items.map((v) => (code ? `\`${v}\`` : String(v)));
  return { value: isList ? items.join(', ') : items[0] };
}

/** The message for an unknown fact name: the closest names and the families of names. */
export function unknownFact(facts, name) {
  const names = [...facts.keys()];
  const close = names
    .map((n) => [n, distance(n, name)])
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([n]) => n);
  const families = [
    ...new Set(
      names.map((n) =>
        n.startsWith('label:')
          ? 'label:<key>'
          : n.startsWith('defaults.')
            ? 'defaults.<path>'
            : n.startsWith('limits.')
              ? 'limits.<EXPORT>'
              : n,
      ),
    ),
  ];
  return `unknown fact '${name}' (closest: ${close.join(', ')}). Valid names: ${families.join(', ')}.`;
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
