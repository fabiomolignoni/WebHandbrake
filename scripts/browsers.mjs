#!/usr/bin/env node
/**
 * Installs the browsers of the end-to-end suite into .cache/browsers (docs/testing.md):
 * - Chromium: Playwright's build (`npx playwright install chromium`), unless CHROMIUM_BIN is set;
 * - Firefox: the current release (`@puppeteer/browsers`), unless FIREFOX_BIN is set;
 * - geckodriver: a pinned release from GitHub, unless GECKODRIVER_BIN is set.
 * The paths are written to .cache/browsers/paths.json, where the suite finds them.
 *
 *   node scripts/browsers.mjs [--skip-chromium]
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GECKODRIVER = '0.37.1';
const root = join(import.meta.dirname, '..');
const dir = join(root, '.cache/browsers');
mkdirSync(dir, { recursive: true });
const pathsFile = join(dir, 'paths.json');
const paths = existsSync(pathsFile) ? JSON.parse(readFileSync(pathsFile, 'utf8')) : {};
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

if (process.env.CHROMIUM_BIN) paths.chromium = process.env.CHROMIUM_BIN;
else if (!process.argv.includes('--skip-chromium')) {
  execFileSync(npx, ['playwright', 'install', 'chromium'], { stdio: 'inherit', cwd: root });
}

if (process.env.FIREFOX_BIN) paths.firefox = process.env.FIREFOX_BIN;
else {
  const out = execFileSync(
    npx,
    ['--yes', '@puppeteer/browsers', 'install', 'firefox@stable', '--path', dir, '--format', '{{path}}'],
    { cwd: root, encoding: 'utf8' },
  );
  paths.firefox = out.trim().split('\n').pop();
}

if (process.env.GECKODRIVER_BIN) paths.geckodriver = process.env.GECKODRIVER_BIN;
else {
  const platform =
    process.platform === 'win32'
      ? 'win64.zip'
      : process.platform === 'darwin'
        ? process.arch === 'arm64'
          ? 'macos-aarch64.tar.gz'
          : 'macos.tar.gz'
        : process.arch === 'arm64'
          ? 'linux-aarch64.tar.gz'
          : 'linux64.tar.gz';
  const name = `geckodriver-v${GECKODRIVER}-${platform}`;
  const url = `https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER}/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cannot download ${url}: ${res.status}`);
  const archive = join(dir, name);
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  const target = join(dir, `geckodriver-${GECKODRIVER}`);
  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xf', archive, '-C', target]);
  paths.geckodriver = join(target, process.platform === 'win32' ? 'geckodriver.exe' : 'geckodriver');
  if (process.platform !== 'win32') chmodSync(paths.geckodriver, 0o755);
}

writeFileSync(pathsFile, `${JSON.stringify(paths, null, 2)}\n`);
console.log(`Browsers for the end-to-end suite (${pathsFile}):`);
for (const [k, v] of Object.entries(paths)) console.log(`  ${k}: ${v}`);
