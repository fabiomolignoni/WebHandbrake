#!/usr/bin/env node
/**
 * Reproducible build: bundles every entry point with esbuild and writes
 * dist/chrome and dist/firefox with browser specific manifests. No timestamps, no minification,
 * no remote code: the output is readable and identical for identical sources.
 *
 * Each target also gets LICENSE (GPL-3.0-or-later) and THIRD_PARTY_NOTICES.txt, with the licence
 * of every package that esbuild bundled. The build fails when a bundled package has no
 * licence file or a licence that is not in COMPATIBLE_LICENSES.
 *
 * With --test the same sources are built into dist-test/ with the hooks of the end-to-end suite
 * (__TEST__, see tests/e2e). Packages are never made from dist-test/, and the
 * normal build checks that it contains none of these hooks.
 *
 * With --pseudo the interface is pseudo-localised (scripts/pseudo.mjs) into dist-pseudo/, to check
 * that every text can be translated and that longer languages fit.
 *
 * The message files lose their descriptions, which only translators read.
 *
 *   node scripts/build.mjs [--target=chrome|firefox|all] [--watch] [--test | --pseudo]
 */

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { manifest } from './manifest.mjs';
import { pseudoMessage } from './pseudo.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const targets = !args.target || args.target === 'all' ? ['chrome', 'firefox'] : [args.target];
const testBuild = Boolean(args.test);
const pseudoBuild = Boolean(args.pseudo);
const outRoot = join(root, testBuild ? 'dist-test' : pseudoBuild ? 'dist-pseudo' : 'dist');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const entries = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  popup: 'src/popup/index.tsx',
  dashboard: 'src/dashboard/index.tsx',
  intervention: 'src/intervention/index.tsx',
  ui: 'src/ui/styles/index.css',
};

const manifestJson = (target) => `${JSON.stringify(manifest(target, pkg.version), null, 2)}\n`;

/** Licences of bundled packages that are compatible with GPL-3.0-or-later. */
const COMPATIBLE_LICENSES = ['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT'];

/** Whether an SPDX expression such as "MIT" or "(MIT OR Apache-2.0)" allows a compatible licence. */
function compatible(expression = '') {
  const ids = expression.replace(/[()]/g, '').split(/\s+(AND|OR)\s+/);
  const names = ids.filter((_, k) => k % 2 === 0);
  const ok = (id) => COMPATIBLE_LICENSES.includes(id.trim());
  return ids.includes('AND') ? names.every(ok) : names.some(ok);
}

/** The package directories under node_modules that a build bundled, from esbuild's metafile. */
function bundledPackages(metafile) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (m) dirs.add(m[1]);
  }
  return [...dirs].sort();
}

/**
 * THIRD_PARTY_NOTICES.txt: the name, version, licence and licence text of every bundled package.
 * MIT and similar licences ask that their notice accompany copies of the code.
 */
async function thirdPartyNotices(metafile) {
  const sections = [];
  for (const dir of bundledPackages(metafile)) {
    const meta = JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8'));
    if (!compatible(meta.license))
      throw new Error(
        `${meta.name} is bundled under "${meta.license}", not one of ${COMPATIBLE_LICENSES.join(', ')}`,
      );
    const file = (await readdir(join(root, dir))).sort().find((f) => /^(licen[cs]e|copying)/i.test(f));
    if (!file) throw new Error(`${meta.name} is bundled but ${dir} has no licence file`);
    const text = (await readFile(join(root, dir, file), 'utf8')).trim();
    sections.push(`${meta.name} ${meta.version}\nLicence: ${meta.license}\n\n${text}\n`);
  }
  const rule = `\n${'-'.repeat(72)}\n\n`;
  const intro =
    `WebHandbrake ${pkg.version} is licensed under GPL-3.0-or-later (LICENSE). It includes the\n` +
    'following third-party software, under the licences below.\n';
  return [intro, ...sections].join(rule);
}

async function writeLicences(out, metafile) {
  await cp(join(root, 'LICENSE'), join(out, 'LICENSE'));
  await writeFile(join(out, 'THIRD_PARTY_NOTICES.txt'), await thirdPartyNotices(metafile));
}

/**
 * A message file as the extension reads it: the messages without their descriptions, and
 * pseudo-localised with --pseudo.
 */
function messagesOnly(json) {
  const messages = JSON.parse(json);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(messages).map(([k, v]) => [
        k,
        { message: pseudoBuild ? pseudoMessage(v.message) : v.message },
      ]),
    ),
  );
}

/** Message files imported by the sources (src/locales/en.json) go through messagesOnly. */
const messagesPlugin = {
  name: 'messages',
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]locales[\\/][^\\/]+\.json$/ }, async (a) => ({
      contents: messagesOnly(await readFile(a.path, 'utf8')),
      loader: 'json',
    }));
  },
};

async function copyStatic(out) {
  await cp(join(root, 'static'), out, { recursive: true });
  await cp(join(root, 'src/_locales'), join(out, '_locales'), { recursive: true });
  if (pseudoBuild) {
    // The browser's own strings (name, description, shortcuts) too; the pseudo name stays within
    // the stores' limits only as far as the browser cares: it is never packaged.
    const file = join(out, '_locales/en/messages.json');
    const messages = JSON.parse(await readFile(file, 'utf8'));
    for (const v of Object.values(messages)) v.message = pseudoMessage(v.message);
    await writeFile(file, `${JSON.stringify(messages, null, 2)}\n`);
  }
  await mkdir(join(out, 'locales'), { recursive: true });
  for (const f of await readdir(join(root, 'src/locales')))
    await writeFile(
      join(out, 'locales', f),
      messagesOnly(await readFile(join(root, 'src/locales', f), 'utf8')),
    );
  // An empty extension page from which the end-to-end suite calls the background.
  if (testBuild)
    await writeFile(
      join(out, 'test.html'),
      '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>WebHandbrake test</title><body></body></html>\n',
    );
}

/** The hooks of the end-to-end suite must never reach a package. */
async function checkNoTestHooks(out) {
  for (const file of Object.keys(entries)) {
    if (file === 'ui') continue;
    const code = await readFile(join(out, `${file}.js`), 'utf8');
    if (/["']test\.(clock|reportError)["']|class ShiftedDate|function testHandlers/.test(code))
      throw new Error(`${out}/${file}.js contains end-to-end test hooks`);
  }
}

async function buildTarget(target) {
  const out = join(outRoot, target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const options = {
    absWorkingDir: root,
    entryPoints: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, join(root, v)])),
    outdir: out,
    bundle: true,
    format: 'iife',
    target: target === 'chrome' ? ['chrome121'] : ['firefox140'],
    jsx: 'automatic',
    jsxImportSource: 'preact',
    charset: 'utf8',
    legalComments: 'none',
    metafile: true,
    sourcemap: false,
    minify: false,
    logLevel: 'warning',
    define: {
      'process.env.NODE_ENV': '"production"',
      __TARGET__: JSON.stringify(target),
      __TEST__: JSON.stringify(testBuild),
    },
    loader: { '.svg': 'text' },
    plugins: [messagesPlugin],
  };
  if (args.watch) {
    const ctx = await esbuild.context({
      ...options,
      plugins: [
        messagesPlugin,
        {
          name: 'static',
          setup(b) {
            b.onEnd(async (result) => {
              await copyStatic(out);
              await writeFile(join(out, 'manifest.json'), manifestJson(target));
              if (result.metafile) await writeLicences(out, result.metafile);
              console.log(`[${target}] rebuilt`);
            });
          },
        },
      ],
    });
    await ctx.watch();
    return;
  }
  const result = await esbuild.build(options);
  await copyStatic(out);
  await writeFile(join(out, 'manifest.json'), manifestJson(target));
  await writeLicences(out, result.metafile);
  if (!testBuild) await checkNoTestHooks(out);
  console.log(`built ${testBuild ? 'dist-test' : pseudoBuild ? 'dist-pseudo' : 'dist'}/${target}`);
}

for (const target of targets) await buildTarget(target);
