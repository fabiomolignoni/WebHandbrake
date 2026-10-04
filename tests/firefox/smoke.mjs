#!/usr/bin/env node
/**
 * Firefox smoke test (REL-03) through WebDriver BiDi: installs dist/firefox in a real Firefox and
 * checks blocking, exceptions, the dashboard and time accounting.
 *
 *   FIREFOX_BIN=/path/to/firefox node tests/firefox/smoke.mjs
 *   (or: npx @puppeteer/browsers install firefox@stable, then point FIREFOX_BIN to it)
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const bin = process.env.FIREFOX_BIN;
if (!bin) {
  console.error('Set FIREFOX_BIN to a Firefox binary (128 or newer).');
  process.exit(2);
}
const requests = [];
const server = http.createServer((req, res) => {
  // Requests arrive through the proxy with an absolute URL.
  const path = req.url.replace(/^https?:\/\/[^/]+/, '');
  requests.push(`${req.headers.host}${path}`);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>real</title><h1 id="real">REAL ${req.headers.host}${path}</h1>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: bin,
  headless: true,
  args: ['-remote-allow-system-access'],
  extraPrefsFirefox: {
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': port,
    'network.proxy.allow_hijacking_localhost': true,
    'xpinstall.signatures.required': false,
    'extensions.webextensions.restrictedDomains': '',
  },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
};

try {
  await browser.installExtension(join(process.cwd(), 'dist/firefox'));
  await sleep(2500);
  // The welcome page opens on install: it gives us the extension origin.
  let dash = null;
  for (let i = 0; i < 20 && !dash; i++) {
    for (const p of await browser.pages()) {
      const href = await p.evaluate(() => location.href).catch(() => '');
      if (href.startsWith('moz-extension://')) dash = p;
    }
    if (!dash) await sleep(500);
  }
  assert.ok(dash, 'the welcome page did not open');
  const origin = await dash.evaluate(() => location.origin);
  const rpc = (method, args = {}) =>
    dash.evaluate(
      async (m, a) => {
        const res = await browser.runtime.sendMessage({ whb: 1, method: m, args: a });
        if (!res.ok) throw new Error(res.error);
        return res.value;
      },
      method,
      args,
    );

  await check('configuration is saved by the background', async () => {
    const model = await rpc('config.get');
    const config = model.config;
    config.settings.onboarded = true;
    const now = Date.now();
    const group = (name, value, policies) => ({
      id: `g-${name}`,
      rev: 1,
      updatedAt: now,
      name,
      color: '#3a7d7c',
      icon: 'circle',
      note: 'note',
      message: '',
      enabled: true,
      archived: false,
      targets: [{ id: `t-${name}`, type: 'domain', value }],
      lists: [],
      policies,
      pause: {
        allowed: true,
        duringSessions: true,
        scopes: ['page', 'site', 'group', 'all'],
        duration: { mode: 'upTo', minutes: 30 },
        limit: { period: { kind: 'day' } },
        cost: { type: 'none' },
        reason: 'none',
        metered: false,
      },
      protection: null,
      options: { privacy: 'all', embeds: false, tabs: 'all', timer: true, quickSession: true },
    });
    config.groups = [
      group('Block', 'blocked.test', [
        { id: 'p1', schedule: { mode: 'always', windows: [] }, intervention: { type: 'block' } },
      ]),
      group('Budget', 'budget.test', [
        {
          id: 'p2',
          schedule: { mode: 'always', windows: [] },
          budget: { type: 'time', minutes: 0.1, period: { kind: 'day' } },
          intervention: { type: 'block' },
        },
      ]),
    ];
    config.groups[0].targets.push({ id: 't-ok', type: 'path', value: 'blocked.test/ok', allow: true });
    const r = await rpc('config.save', { config });
    assert.ok(
      r.applied.filter((u) => u.kind === 'group.add').length === 2,
      JSON.stringify(r.applied.map((u) => u.kind)),
    );
  });
  await sleep(1000);

  const page = await browser.newPage();
  const href = () => page.evaluate(() => location.href);
  await check('DNR redirects a blocked site before the request (ENF-01)', async () => {
    await page.goto('http://www.blocked.test/x?y=1').catch(() => undefined);
    await sleep(1500);
    assert.ok(
      (await href()).startsWith(`${origin}/intervention.html#http://www.blocked.test/x?y=1`),
      await href(),
    );
    assert.ok(!requests.some((r) => r.startsWith('www.blocked.test')), 'request reached the server');
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent ?? '');
    assert.match(h1, /protected/);
  });
  await check('exceptions load the real page (MAT-04)', async () => {
    await page.goto('http://blocked.test/ok/page').catch(() => undefined);
    await sleep(800);
    assert.equal(
      await page.evaluate(() => document.getElementById('real')?.textContent),
      'REAL blocked.test/ok/page',
    );
  });
  await check('dashboard pages render', async () => {
    for (const route of ['today', 'groups', 'insights', 'protection', 'settings/diagnostics']) {
      await dash.evaluate((r) => {
        location.hash = `#/${r}`;
      }, route);
      await sleep(400);
      const h1 = await dash.evaluate(() => document.querySelector('h1')?.textContent ?? '');
      assert.ok(h1.length > 0, `no heading on ${route}`);
    }
  });
  await check('active time is counted and the budget applies (TIM-01, LIM-01)', async () => {
    await page.goto('http://budget.test/watch').catch(() => undefined);
    await sleep(500);
    await page.bringToFront();
    const t0 = Date.now();
    while (!(await href()).includes('intervention.html') && Date.now() - t0 < 25_000) {
      await page.mouse.move(20 + Math.random() * 50, 20 + Math.random() * 50).catch(() => undefined);
      await sleep(500);
    }
    assert.ok(
      (await href()).includes('intervention.html'),
      `still on ${await href()} after ${Date.now() - t0} ms`,
    );
  });
  await check('popup renders', async () => {
    const popup = await browser.newPage();
    await popup
      .goto(`${origin}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 5000 })
      .catch(() => undefined);
    await sleep(800);
    const text = await popup.evaluate(() => document.body.textContent ?? '');
    assert.match(text, /WebHandbrake/);
    // Firefox sizes popups from their content starting from a tiny viewport: the width must not
    // collapse. Simulated with a 40 px wide frame (resizing privileged pages is not possible).
    const width = await dash.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'width: 40px; height: 400px; border: 0';
      frame.src = 'popup.html';
      document.body.appendChild(frame);
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const el = frame.contentDocument?.querySelector('.popup');
        if (el) return el.getBoundingClientRect().width;
      }
      return 0;
    });
    assert.equal(width, 380);
  });
} finally {
  console.log(results.join('\n'));
  await browser.close();
  server.close();
}
process.exit(results.some((r) => r.startsWith('FAIL')) || !results.length ? 1 : 0);
