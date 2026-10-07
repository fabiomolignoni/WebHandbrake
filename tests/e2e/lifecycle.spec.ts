/**
 * The extension's life in a real browser (REL, ENF-08, PRIV-01, SEC-05, DIA, MAT-17 through the
 * browser's own entry points): install, restarts, a stopped service worker or a suspended event
 * page, diagnostics and the self-test, privacy and message security.
 */

import { expect, test } from './harness';
import { BLOCK, group, policy, TRACK, timeBudget } from './harness/config';
import { expectAllowed, expectBlocked, sleep, useUntil } from './helpers';

test('install: the welcome page opens and the popup invites to set up', async ({ h }) => {
  await expect
    .poll(async () => (await h.tabs()).some((t) => t.url.endsWith('/dashboard.html#/welcome')))
    .toBe(true);
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.settings.onboarded).toBe(false);
  // Suggested alternatives are filled in at install (INT-09).
  expect(cfg.settings.interventions.alternatives.map((a: any) => a.label)).toHaveLength(3);
  const popup = await h.popup();
  await popup.text('WebHandbrake is not set up yet.').expectVisible();
  const welcome = await h.newTab(() => popup.button('Set up').click());
  await welcome.role('heading', 'Welcome to WebHandbrake').expectVisible();
});

test('REL-01 / ENF-08: rules, state and blocking survive a restart, and apply before the first page', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Block', ['blocked.test'], [policy(BLOCK)])];
  });
  await h.rpc('later.add', { url: 'http://saved.test/a', title: 'Saved' });
  await h.restart();
  // The very first navigation after the start is stopped before reaching the network.
  await expectBlocked(h, 'http://blocked.test/first');
  expect((await h.rpc('later.list')).items.map((i: any) => i.url)).toEqual(['http://saved.test/a']);
  const s = await h.state();
  expect(s.state.tamper).toEqual([]);
  expect(s.meta.restored).toBeNull();
});

test('REL-01: a stopped service worker or a suspended event page loses nothing (regression)', async ({
  h,
  browserName,
}) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
  });
  await h.configure((c) => {
    c.groups = [
      group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(10) })]),
      group('Block', ['blocked.test'], [policy(BLOCK)]),
    ];
  });
  // The last change before the background stops must not be lost.
  await h.configure((c) => {
    c.groups[1].name = 'Renamed just before';
  });
  const p = await expectAllowed(h, 'http://video.test/');
  await useUntil(p, async () => false, 3000);
  const before = await h.state();
  if (browserName === 'chromium') expect(await h.stopBackground()).toBe(true);
  else await h.reloadExtension();
  // Blocking does not need the background (declarativeNetRequest rules).
  await expectBlocked(h, 'http://blocked.test/');
  const after = await h.state();
  expect(after.bootId).not.toBe(before.bootId);
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups.map((g: any) => g.name)).toEqual(['Video', 'Renamed just before']);
  // Not mistaken for damage: no restore and no warning.
  expect(after.meta.restored).toBeNull();
  expect(after.state.tamper.map((e: any) => e.kind)).not.toContain('state-restored');
  expect((await h.rpc('overview.get')).warnings.map((w: any) => w.kind)).not.toContain('restored');
  // Counting resumes after the restart (TIM-05: at most a few seconds lost).
  const q = await expectAllowed(h, 'http://video.test/again');
  await useUntil(q, async () => false, 3000);
  await h.rpc('test.flush');
  expect((await h.rpc('overview.get')).today.seconds).toBeGreaterThanOrEqual(3);
});

test.describe('Firefox event page', () => {
  test.use({ launch: { backgroundIdleMs: 2000 } });

  test('REL-01: the event page is suspended when idle and wakes up on events', async ({ h, browserName }) => {
    test.skip(
      browserName !== 'firefox',
      'Event pages are a Firefox background (Chrome uses a service worker)',
    );
    await h.configure((c) => {
      c.groups = [
        group('Block', ['blocked.test'], [policy(BLOCK)]),
        group('Read', ['read.test'], [policy(TRACK)]),
      ];
    });
    const first = (await h.state()).bootId;
    // Nothing happens for a while: Firefox suspends the event page.
    await sleep(6000);
    const tab = await h.open('http://blocked.test/');
    await tab.expectIntervention();
    // The intervention page needed the background: it woke up with everything it had.
    await tab.role('heading', /protected/).expectVisible();
    expect((await h.state()).bootId).not.toBe(first);
    expect((await h.rpc('config.get')).config.groups).toHaveLength(2);
    expect((await h.state()).meta.restored).toBeNull();
  });
});

test('DIA-03: the self-test opens a test address that the browser filters stop', async ({ h }) => {
  const p = await h.page('dashboard.html#/settings/diagnostics');
  const t = await h.newTab(() => p.button('Run the self-test').click());
  await t.expectIntervention();
  await t.role('heading', 'Self-test passed').expectVisible();
  await expect.poll(async () => (await h.state()).meta.selftest?.ok).toBe(true);
  expect(h.server.hits('selftest.webhandbrake.invalid')).toEqual([]);
});

test('DIA-01 / DIA-02: diagnostics show the filters and recent decisions; the report hides addresses', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Block', ['blocked.test'], [policy(BLOCK)])];
  });
  await expectBlocked(h, 'http://blocked.test/secret-path');
  await h.open('http://blocked.test/');
  const d = await h.rpc('diag.get');
  expect(d.rules.dynamic).toBeGreaterThan(0);
  expect(d.rules.limits.regex).toBeGreaterThan(0);
  expect(d.permissions.hostAccess).toBe(true);
  const p = await h.page('dashboard.html#/settings/diagnostics');
  await p.role('heading', 'Browser blocking filters').expectVisible();
  await p.role('heading', 'Recent decisions').expectVisible();
  await p.text(/blocked\.test\/secret-path/).expectVisible();
  const report = (await h.rpc('diag.report', { includeUrls: false })).text;
  expect(report).toContain('WebHandbrake 1.0.0');
  expect(report).not.toContain('blocked.test');
  const full = (await h.rpc('diag.report', { includeUrls: true })).text;
  expect(full).toContain('blocked.test');
});

test('PRIV-01: the extension never makes network requests of its own', async ({ h }) => {
  // A typical session: setup, dashboard pages, blocking, time counted, statistics.
  await h.configure((c) => {
    c.groups = [
      group('Block', ['blocked.test'], [policy(BLOCK)]),
      group('Read', ['read.test'], [policy(TRACK)]),
    ];
  });
  for (const route of ['today', 'groups', 'insights', 'protection', 'settings/general', 'help', 'welcome'])
    await (await h.page(`dashboard.html#/${route}`)).get('h1').waitFor('visible');
  await h.popup();
  await expectBlocked(h, 'http://blocked.test/');
  const r = await expectAllowed(h, 'http://read.test/');
  await useUntil(r, async () => false, 2000);
  await h.rpc('diag.selftest');
  await sleep(1000);
  const hosts = new Set(h.server.requests.map((q) => q.host));
  expect([...hosts].sort()).toEqual(['read.test']);
  // No request carries the extension as its origin.
  expect(
    h.server.requests.filter((q) => /extension:/.test(`${q.headers.origin ?? ''}${q.headers.referer ?? ''}`)),
  ).toEqual([]);
});

test('SEC-05: web pages cannot reach the extension', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Read', ['read.test'], [policy(TRACK)])];
  });
  const p = await expectAllowed(h, 'http://read.test/');
  const id = h.origin.replace(/^.*:\/\//, '');
  const result = await p.eval(async (extId: string) => {
    const c = (globalThis as any).chrome;
    if (!c?.runtime?.sendMessage) return 'no messaging API';
    try {
      await c.runtime.sendMessage(extId, { whb: 1, method: 'config.save', args: {} });
      return 'sent';
    } catch (e) {
      return `refused: ${(e as Error).message}`;
    }
  }, id);
  expect(result).not.toBe('sent');
});

test('PERF-03: content scripts run only on the sites of the rules', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Read', ['read.test'], [policy(TRACK)])];
  });
  const s = await h.state();
  expect(s.content).toEqual(['*://*.read.test/*', '*://read.test/*']);
  const other = await expectAllowed(h, 'http://other.test/');
  await useUntil(other, async () => false, 2000);
  const ticks = (await h.state()).counters.ticks;
  const r = await expectAllowed(h, 'http://read.test/');
  await useUntil(r, async () => false, 2000);
  expect((await h.state()).counters.ticks).toBeGreaterThan(ticks);
  // A site added later gets the content script in its open tabs too.
  await h.configure((c) => {
    c.groups[0].targets.push({ id: 't-other', type: 'domain', value: 'other.test' });
  });
  const before = (await h.state()).counters.ticks;
  await useUntil(other, async () => false, 2500);
  expect((await h.state()).counters.ticks).toBeGreaterThan(before);
});

test('MAT-17 / API-02: "Block this site" from the context menu, for a page and for a link', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Social', ['social.test'], [policy(BLOCK)])];
  });
  const s = await h.state();
  const titles = s.menus.map((m: any) => m.title);
  expect(titles).toEqual(expect.arrayContaining(['Block this site in', 'Social', 'New rule…']));
  const groupId = (await h.rpc('config.get')).config.groups[0].id;
  const tab = await expectAllowed(h, 'http://forum.test/thread/1');
  await h.rpc('test.menu', { menuItemId: `site|${groupId}`, pageUrl: 'http://forum.test/thread/1' });
  await tab.expectIntervention(true, 5000);
  await h.rpc('test.menu', { menuItemId: 'link|new', linkUrl: 'http://video.test/watch?v=1' });
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups.map((g: any) => g.name)).toEqual(['Social', 'Blocked sites']);
  await expectBlocked(h, 'http://video.test/other');
  // SET-05: the menu can be turned off.
  await h.configure((c) => {
    c.settings.contextMenu = false;
  });
  expect((await h.state()).menus).toEqual([]);
});

test('MAT-17 / API-01: the "block this site" shortcut adds the site to the last rule used', async ({ h }) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
  });
  await h.configure((c) => {
    c.groups = [
      group('Old', ['old.test'], [policy(BLOCK)]),
      group('Social', ['social.test'], [policy(BLOCK)]),
    ];
  });
  const [oldId, socialId] = (await h.rpc('config.get')).config.groups.map((g: any) => g.id);
  await h.rpc('config.addPage', { url: 'http://first.test/', granularity: 'domain', groupId: oldId });
  const tab = await expectAllowed(h, 'http://shortcut.test/page');
  await h.rpc('test.command', { command: 'block-site', tabId: await tab.id() });
  await tab.expectIntervention(true, 5000);
  let cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[0].targets.map((t: any) => t.value)).toContain('shortcut.test');
  // The last rule used is archived: the shortcut must not add sites to a rule that blocks nothing.
  await h.configure((c) => {
    c.groups[0].archived = true;
  });
  const next = await expectAllowed(h, 'http://next.test/');
  await h.rpc('test.command', { command: 'block-site', tabId: await next.id() });
  await next.expectIntervention(true, 5000);
  cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups.find((g: any) => g.id === socialId).targets.map((t: any) => t.value)).toContain(
    'next.test',
  );
});

test('NOT-02 / SET-05: the badge can be turned off', async ({ h }) => {
  await h.configure((c) => {
    c.settings.badge.enabled = false;
    c.groups = [group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(30) })])];
  });
  const p = await expectAllowed(h, 'http://video.test/');
  await useUntil(p, async () => false, 2500);
  const id = await p.id();
  expect(await h.control.eval((tabId: number) => chrome.action.getBadgeText({ tabId }), id)).toBe('');
});

test('ENF-12: without access to the sites, blocking falls back to network blocks and says so', async ({
  h,
  browserName,
}) => {
  test.skip(browserName !== 'firefox', 'Only Firefox lets an extension give back its host permission');
  await h.configure((c) => {
    c.groups = [group('Block', ['blocked.test'], [policy(BLOCK)])];
  });
  await h.control.eval(() => chrome.permissions.remove({ origins: ['<all_urls>'] }));
  await expect.poll(async () => (await h.rpc('diag.get')).permissions.hostAccess).toBe(false);
  const d = await h.rpc('diag.get');
  expect(d.rules.redirects).toBe(0);
  const p = await h.open('http://blocked.test/x');
  await p.expectIntervention(true, 8000);
  expect(h.server.hits('blocked.test')).toEqual([]);
  const popup = await h.popup(p);
  await popup.text('Access to all sites is missing.').expectVisible();
  expect((await h.state()).state.tamper.map((e: any) => e.kind)).toContain('host-permission');
});

test('PRO-09: the protection centre says whether private windows are covered', async ({ h }) => {
  const ov = await h.rpc('overview.get');
  expect(ov.warnings.map((w: any) => w.kind)).toContain('incognito');
  const p = await h.page('dashboard.html#/protection');
  await p.text('Not active in private windows.').expectVisible();
});
