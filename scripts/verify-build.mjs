#!/usr/bin/env node
/**
 * Verifies the release build (npm run build:verify): builds dist/ twice, compares the SHA-256 of
 * every file under dist/, then runs web-ext lint on dist/firefox. It fails with the list of files
 * that differ between the two builds, or with the errors of web-ext lint.
 *
 * The comparison covers dist/ only: the packages that scripts/package.mjs zips from it are not
 * compared.
 *
 *   node scripts/verify-build.mjs
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function build() {
  execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
}

async function hashes() {
  const out = new Map();
  for await (const file of walk(dist)) {
    const sum = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
    out.set(relative(root, file).split('\\').join('/'), sum);
  }
  return out;
}

build();
const first = await hashes();
build();
const second = await hashes();

const differing = [...new Set([...first.keys(), ...second.keys()])]
  .filter((f) => first.get(f) !== second.get(f))
  .sort();
if (differing.length) {
  console.error(`build:verify: ${differing.length} files differ between two builds:`);
  for (const f of differing) {
    let note = '';
    if (!first.has(f)) note = ' (only in the second build)';
    if (!second.has(f)) note = ' (only in the first build)';
    console.error(`  ${f}${note}`);
  }
  process.exit(1);
}
console.log(`build:verify: ${first.size} files under dist/ are identical in two builds`);

try {
  execFileSync('npx', ['web-ext', 'lint', '--source-dir', 'dist/firefox', '--warnings-as-errors=false'], {
    cwd: root,
    stdio: 'inherit',
  });
} catch {
  console.error('build:verify: web-ext lint reported errors in dist/firefox');
  process.exit(1);
}
console.log('build:verify ok');
