/**
 * permissions: the table under "Permissions" in PRIVACY.md has one row for everything the two
 * manifests (scripts/manifest.mjs) ask for, and nothing else. The first cell of a row names its
 * items in backticks: each permission, each optional permission (the row says "optional"), each
 * host permission (`<all_urls>`), `web_accessible_resources` and Chrome's `incognito`.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { codeSpans, section, tables } from '../md.mjs';

const PATH = 'PRIVACY.md';

export default {
  slug: 'permissions',
  scope: 'global',
  description: 'PRIVACY.md#permissions lists exactly what both manifests ask for',
  async run({ repo }) {
    const { manifest } = await import(pathToFileURL(join(repo.root, 'scripts/manifest.mjs')).href);
    const version = JSON.parse(repo.read('package.json')).version;
    const expected = new Map();
    for (const target of ['chrome', 'firefox']) {
      const m = manifest(target, version);
      for (const p of m.permissions ?? []) expected.set(p, { optional: false });
      for (const p of m.optional_permissions ?? []) expected.set(p, { optional: true });
      for (const p of m.host_permissions ?? []) expected.set(p, { optional: false });
      if (m.web_accessible_resources?.length) expected.set('web_accessible_resources', { optional: false });
      if (m.incognito) expected.set('incognito', { optional: false });
    }
    const doc = repo.doc(PATH);
    if (!doc) return [{ path: PATH, message: 'does not exist.' }];
    const sec = section(doc, 'permissions');
    if (!sec) return [{ path: PATH, message: `has no '## Permissions' section with the permissions table.` }];
    const problems = [];
    const listed = new Map();
    for (const table of tables(doc, sec.start, sec.end)) {
      for (const row of table.rows) {
        for (const span of codeSpans(row.cells[0] ?? '')) {
          listed.set(span.text, { line: row.line, optional: /\boptional\b/i.test(row.cells.join(' ')) });
        }
      }
    }
    for (const [name, want] of expected) {
      const row = listed.get(name);
      if (!row)
        problems.push({
          path: PATH,
          line: sec.heading.line,
          message: `manifest permission '${name}' has no row in ${PATH}#permissions.`,
        });
      else if (want.optional && !row.optional)
        problems.push({
          path: PATH,
          line: row.line,
          message: `'${name}' is optional in the manifest: say so in its row.`,
        });
    }
    for (const [name, row] of listed)
      if (!expected.has(name))
        problems.push({
          path: PATH,
          line: row.line,
          message: `'${name}' is not in either manifest: remove its row or fix the name.`,
        });
    return problems;
  },
};
