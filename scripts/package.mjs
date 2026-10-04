#!/usr/bin/env node
/** Store packages (MAINT-03): zips dist/chrome and dist/firefox into web-ext-artifacts/. */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
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
