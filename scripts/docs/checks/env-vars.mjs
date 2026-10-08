/**
 * env-vars: the environment variables that the tests, the scripts and the test configuration read
 * (`process.env.X`) are exactly the ones in the table under "Environment variables" in
 * docs/testing.md (first column, in backticks). NODE_ENV and CI are not test settings and are
 * ignored.
 */

import { ENV_IGNORED, ENV_SOURCES, SPEC, TOOLS_DIR } from '../config.mjs';
import { codeSpans, section, tables } from '../md.mjs';

const READ = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g;

export default {
  slug: 'env-vars',
  scope: 'global',
  description: 'environment variables read by tests and scripts match docs/testing.md#environment-variables',
  async run({ repo }) {
    const read = new Map();
    for (const path of repo.files()) {
      if (!ENV_SOURCES.test(path) || path.startsWith(TOOLS_DIR)) continue;
      repo
        .read(path)
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(READ)) {
            const name = m[1] ?? m[2];
            if (!ENV_IGNORED.includes(name) && !read.has(name)) read.set(name, { path, line: i + 1 });
          }
        });
    }
    const doc = repo.doc(SPEC.testing);
    const sec = doc && section(doc, 'environment-variables');
    if (!sec)
      return [
        {
          path: SPEC.testing,
          message: `has no '## Environment variables' section with the table of variables.`,
        },
      ];
    const documented = new Map();
    for (const t of tables(doc, sec.start, sec.end))
      for (const row of t.rows)
        for (const s of codeSpans(row.cells[0] ?? '')) documented.set(s.text, row.line);
    const problems = [];
    for (const [name, at] of read)
      if (!documented.has(name))
        problems.push({
          ...at,
          message: `${name} is read here but missing from ${SPEC.testing}#environment-variables.`,
        });
    for (const [name, line] of documented)
      if (!read.has(name))
        problems.push({
          path: SPEC.testing,
          line,
          message: `${name} is documented but nothing reads it: remove its row.`,
        });
    return problems;
  },
};
