#!/usr/bin/env node
/**
 * Store packages (MAINT-03): zips dist/chrome and dist/firefox into web-ext-artifacts/.
 *
 * With --source it writes the source archive instead (npm run package:source):
 * web-ext-artifacts/webhandbrake-source-<version>.zip, made by `git archive` from the committed
 * HEAD. Uncommitted changes are not included.
 *
 *   node scripts/package.mjs [--source]
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

if (process.argv.includes('--source')) {
  mkdirSync('web-ext-artifacts', { recursive: true });
  const output = `web-ext-artifacts/webhandbrake-source-${version}.zip`;
  execFileSync('git', ['archive', '--format=zip', `--output=${output}`, 'HEAD'], { stdio: 'inherit' });
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
    console.warn('package:source: the working tree has uncommitted changes; the archive contains HEAD only.');
  console.log(`wrote ${output}`);
} else {
  for (const target of ['chrome', 'firefox']) {
    execFileSync(
      'npx',
      [
        'web-ext',
        'build',
        '--source-dir',
        `dist/${target}`,
        '--artifacts-dir',
        'web-ext-artifacts',
        '--filename',
        `webhandbrake-${target}-${version}.zip`,
        '--overwrite-dest',
      ],
      { stdio: 'inherit' },
    );
  }
}
