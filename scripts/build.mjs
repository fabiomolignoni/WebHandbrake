#!/usr/bin/env node
/**
 * Reproducible build (MAINT-03, PRIV-07): bundles every entry point with esbuild and writes
 * dist/chrome and dist/firefox with browser specific manifests. No timestamps, no minification,
 * no remote code: the output is readable and identical for identical sources.
 *
 * With --test the same sources are built into dist-test/ with the hooks of the end-to-end suite
 * (__TEST__, see tests/e2e and docs/testing.md). Packages are never made from dist-test/, and the
 * normal build checks that it contains none of these hooks.
 *
 *   node scripts/build.mjs [--target=chrome|firefox|all] [--watch] [--test]
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const targets = !args.target || args.target === 'all' ? ['chrome', 'firefox'] : [args.target];
const testBuild = Boolean(args.test);
const outRoot = join(root, testBuild ? 'dist-test' : 'dist');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const entries = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  popup: 'src/popup/index.tsx',
  dashboard: 'src/dashboard/index.tsx',
  intervention: 'src/intervention/index.tsx',
  ui: 'src/ui/styles/index.css',
};

function manifest(target) {
  const icons = {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    96: 'icons/icon-96.png',
    128: 'icons/icon-128.png',
  };
  const m = {
    manifest_version: 3,
    name: '__MSG_extName__',
    short_name: 'WebHandbrake',
    description: '__MSG_extDescription__',
    version: pkg.version,
    default_locale: 'en',
    homepage_url: 'https://github.com/fabiomolignoni/WebHandbrake',
    icons,
    action: {
      default_popup: 'popup.html',
      default_title: 'WebHandbrake',
      default_icon: { 16: icons[16], 32: icons[32], 48: icons[48] },
    },
    options_ui: { page: 'dashboard.html', open_in_tab: true },
    permissions: [
      'storage',
      'unlimitedStorage',
      'declarativeNetRequest',
      'tabs',
      'webNavigation',
      'webRequest',
      'alarms',
      'idle',
      'scripting',
      'contextMenus',
    ],
    optional_permissions: ['notifications'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['intervention.html', 'intervention.js', 'ui.css', 'icons/*'],
        matches: ['<all_urls>'],
      },
    ],
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+H' }, description: '__MSG_cmdOpenPopup__' },
      'start-session': { suggested_key: { default: 'Alt+Shift+F' }, description: '__MSG_cmdStartSession__' },
      'block-site': { suggested_key: { default: 'Alt+Shift+B' }, description: '__MSG_cmdBlockSite__' },
      'open-dashboard': { description: '__MSG_cmdOpenDashboard__' },
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src 'self' data:; style-src 'self'; connect-src 'self'",
    },
  };
  if (target === 'chrome') {
    m.minimum_chrome_version = '121';
    m.background = { service_worker: 'background.js' };
    m.incognito = 'spanning';
  } else {
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: {
        id: 'webhandbrake@webhandbrake.org',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: '142.0' },
    };
  }
  return m;
}

async function copyStatic(out) {
  await cp(join(root, 'static'), out, { recursive: true });
  await cp(join(root, 'src/_locales'), join(out, '_locales'), { recursive: true });
  await mkdir(join(out, 'locales'), { recursive: true });
  await cp(join(root, 'src/locales'), join(out, 'locales'), { recursive: true });
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
    sourcemap: false,
    minify: false,
    logLevel: 'warning',
    define: {
      'process.env.NODE_ENV': '"production"',
      __TARGET__: JSON.stringify(target),
      __TEST__: JSON.stringify(testBuild),
    },
    loader: { '.svg': 'text' },
  };
  if (args.watch) {
    const ctx = await esbuild.context({
      ...options,
      plugins: [
        {
          name: 'static',
          setup(b) {
            b.onEnd(async () => {
              await copyStatic(out);
              await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest(target), null, 2)}\n`);
              console.log(`[${target}] rebuilt`);
            });
          },
        },
      ],
    });
    await ctx.watch();
    return;
  }
  await esbuild.build(options);
  await copyStatic(out);
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest(target), null, 2)}\n`);
  if (!testBuild) await checkNoTestHooks(out);
  console.log(`built ${testBuild ? 'dist-test' : 'dist'}/${target}`);
}

for (const target of targets) await buildTarget(target);
