/**
 * npm-scripts: every `npm run <script>` named in a document, a comment, a workflow, a template or
 * package.json exists in package.json. Names built from GitHub expressions
 * (`test:e2e:${{ matrix.browser }}`) and placeholders (`npm run <script>`) are skipped.
 */

import { isCode } from '../config.mjs';

const RUN = /\bnpm (?:run|run-script) ([^\s`'"),;|&]+)/g;

export default {
  slug: 'npm-scripts',
  scope: 'file',
  description: 'every npm run <script> mentioned anywhere exists in package.json',
  async run({ repo }) {
    const scripts = JSON.parse(repo.read('package.json')).scripts ?? {};
    const problems = [];
    for (const path of repo.files()) {
      if (!path.endsWith('.md') && !isCode(path)) continue;
      const text = repo.read(path);
      if (text === null || text.includes('\0')) continue;
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(RUN)) {
          const name = m[1].replace(/[.:]+$/, '');
          const rest = line.slice(m.index + m[0].length);
          if (!name || /[<$[{]/.test(name) || rest.startsWith('${{')) continue;
          if (!(name in scripts))
            problems.push({
              path,
              line: i + 1,
              message: `npm run ${name}: package.json has no script '${name}'.`,
            });
        }
      });
    }
    return problems;
  },
};
