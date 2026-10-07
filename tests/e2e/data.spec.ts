/**
 * Data in a real browser (DAT-01…DAT-07, LST-03, STA-06, PRIV-05): import and export from the
 * settings page, backups, recovery of a damaged configuration at start-up, statistics.
 */

import { expect, type Harness, type Tab, test } from './harness';
import { BLOCK, group, policy, TRACK, timeBudget } from './harness/config';
import { expectAllowed, expectBlocked, useUntil } from './helpers';

const LIST = [
  '# sites that distract me',
  'social.test',
  '0.0.0.0 video.test',
  '||news.test^',
  'not a site ::',
].join('\n');

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Captures the files the page downloads (the anchor + Blob URL used on every platform, DAT-05). */
async function captureDownloads(page: Tab) {
  await page.eval(() => {
    const w = window as unknown as { __downloads: { name: string; text: string }[] };
    w.__downloads = [];
    const blobs = new Map<string, Blob>();
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b: Blob | MediaSource) => {
      const u = create(b);
      if (b instanceof Blob) blobs.set(u, b);
      return u;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.href);
      if (this.download && blob) {
        void blob.text().then((text) => w.__downloads.push({ name: this.download, text }));
        return;
      }
      click.call(this);
    };
  });
  return () =>
    page.eval(() => (window as unknown as { __downloads: { name: string; text: string }[] }).__downloads);
}

async function soft(h: Harness) {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
  });
}

test('DAT-02: a plain list (hosts file, uBlock syntax) becomes a rule from the import dialog, with a report', async ({
  h,
}) => {
  const p = await h.page('dashboard.html#/settings/data');
  await p.button('Import a file or a list…').click();
  await p.label('…or paste the content here').fill(LIST);
  await p.button('Preview').click();
  await p.text('Imported list: 3 sites, 1 conditions').expectVisible();
  await p.text(/not a site/).expectVisible();
  await p.button('Import', { exact: true, within: 'dialog' }).click();
  await expect
    .poll(async () => (await h.rpc('config.get')).config.groups.map((g: any) => g.name))
    .toEqual(['Imported list']);
  const imported = (await h.rpc('config.get')).config.groups[0];
  expect(imported.targets.map((t: any) => t.value).sort()).toEqual([
    'news.test',
    'social.test',
    'video.test',
  ]);
  await expectBlocked(h, 'http://news.test/');
});

test('DAT-01 / DAT-04: the export is a timestamped JSON file, secrets only when asked', async ({ h }) => {
  await soft(h);
  await h.configure((c) => {
    c.groups = [group('Share me', ['share.test'], [policy(BLOCK)])];
  });
  await h.rpc('password.change', { password: 'pw for export' });
  const p = await h.page('dashboard.html#/settings/data');
  const files = await captureDownloads(p);
  await p.button('Download file').click();
  await expect.poll(async () => (await files()).length).toBe(1);
  const [file] = await files();
  expect(file.name).toMatch(/^webhandbrake-\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
  const data = JSON.parse(file.text);
  expect(data).toMatchObject({ format: 'webhandbrake', version: 1 });
  expect(data.config.groups[0].name).toBe('Share me');
  expect(data.config.settings.protection.access.passwordHash).toBeNull();
  const withSecrets = await h.rpc('data.export', { stats: true, secrets: true });
  const full = JSON.parse(withSecrets.text);
  expect(full.config.settings.protection.access.passwordHash).toMatch(/^pbkdf2-sha256\$/);
  expect(full.statistics).toBeDefined();
});

test('DAT-01 / LST-03: export, import and sharing of a single rule round-trip', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Share me', ['share.test'], [policy(BLOCK)])];
  });
  const exp = await h.rpc('data.export', { stats: false, secrets: false });
  expect((await h.rpc('data.preview', { text: exp.text, mode: 'replace' })).units).toEqual([]);
  const id = JSON.parse(exp.text).config.groups[0].id;
  const shared = await h.rpc('group.export', { groupId: id });
  expect(shared.filename).toMatch(/^webhandbrake-group-share-me-/);
  const r = await h.rpc('data.import', { text: shared.text, mode: 'merge' });
  expect(r.applied.map((u: any) => u.kind)).toEqual(['group.add']);
  expect((await h.rpc('config.get')).config.groups.map((g: any) => g.name)).toEqual(['Share me', 'Share me']);
});

test('DAT-03: every change keeps a backup, and a backup can be restored', async ({ h }) => {
  await soft(h);
  await h.configure((c) => {
    c.groups = [group('First', ['first.test'], [policy(BLOCK)])];
  });
  await h.configure((c) => {
    c.groups[0].name = 'Renamed';
  });
  const backups = await h.rpc('backups.list');
  expect(backups.length).toBeGreaterThanOrEqual(2);
  const p = await h.page('dashboard.html#/settings/data');
  // The backup made before the rename has one rule named "First".
  const before = backups.find((b: any) => b.groups === 1 && b.reason !== 'daily');
  const r = await h.rpc('backups.restore', { at: before.at });
  if (r.ticket) await h.completeTicket(r.ticket);
  expect((await h.rpc('config.get')).config.groups[0].name).toBe('First');
  await p.reload();
  await p.button('Restore').expectVisible();
});

test('DAT-03: a damaged configuration is restored from the last backup at start-up, with a warning', async ({
  h,
}) => {
  await soft(h);
  await h.configure((c) => {
    c.groups = [group('Kept', ['kept.test'], [policy(BLOCK)])];
  });
  await h.configure((c) => {
    c.groups[0].targets.push({ id: 'x', type: 'domain', value: 'also.test' });
  });
  // The stored configuration is damaged (as by a crash or a manual edit): its checksum no longer matches.
  await h.control.eval(() =>
    chrome.storage.local.get('config').then((r) => {
      const stored = r.config as { data: { groups: { name: string }[] } };
      stored.data.groups[0].name = 'Tampered';
      return chrome.storage.local.set({ config: stored });
    }),
  );
  await h.restart();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups.map((g: any) => g.name)).toEqual(['Kept']);
  const ov = await h.rpc('overview.get');
  expect(ov.warnings.map((w: any) => w.kind)).toContain('restored');
  const s = await h.state();
  expect(s.state.tamper.map((e: any) => e.kind)).toContain('state-restored');
  const today = await h.page('dashboard.html#/today');
  await today.text(/Your settings were damaged and were restored from the backup of/).expectVisible();
  // Blocking keeps working with the restored rules.
  await expectBlocked(h, 'http://kept.test/');
});

test('DAT-07: fields unknown to this version are kept across a restart', async ({ h }) => {
  await soft(h);
  await h.configure((c) => {
    c.groups = [group('Future', ['future.test'], [policy(BLOCK)], { fromTheFuture: { x: 1 } })];
    c.settings.futureSetting = 'keep me';
  });
  await h.restart();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.settings.futureSetting).toBe('keep me');
  expect(cfg.groups[0].fromTheFuture).toEqual({ x: 1 });
  await expectBlocked(h, 'http://future.test/');
});

test('STA-06: statistics export (CSV, JSON) and deletion; limits survive the deletion', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(0.1) })]),
      group('Read', ['read.test'], [policy(TRACK)]),
    ];
  });
  const p = await expectAllowed(h, 'http://video.test/');
  await useUntil(p, () => p.isIntervention(), 20_000);
  await p.expectIntervention(true, 3000);
  const r = await expectAllowed(h, 'http://read.test/');
  await useUntil(r, async () => false, 2500);
  // Nothing is being counted any more while the statistics are deleted.
  await r.close();
  await h.rpc('test.flush');
  const csv = await h.rpc('stats.export', { format: 'csv' });
  expect(csv.filename).toMatch(/^webhandbrake-statistics-.*\.csv$/);
  expect(csv.text.split('\n')[0]).toBe('day,kind,id,name,seconds,visits');
  expect(csv.text).toContain(',group,');
  expect(csv.text).toContain('video.test');
  const json = JSON.parse((await h.rpc('stats.export', { format: 'json' })).text);
  expect(json.format).toBe('webhandbrake-statistics');
  // Delete one site.
  await h.rpc('stats.delete', { scope: 'site', host: 'read.test' });
  let stats = await h.rpc('stats.get', { from: today(), to: today() });
  expect(stats.sites.map((s: any) => s.host)).not.toContain('read.test');
  // Delete everything: the statistics are gone but the exhausted budget stays exhausted.
  await h.rpc('stats.delete', { scope: 'all' });
  stats = await h.rpc('stats.get', { from: today(), to: today() });
  expect(stats.sites).toEqual([]);
  await expectBlocked(h, 'http://video.test/again');
});

test('PRIV-05: what is stored is listed with its size, and the export of the configuration is readable', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test'], [policy(BLOCK)])];
  });
  const usage = await h.rpc('data.usage');
  const names = usage.keys.map((k: any) => k.name);
  expect(names).toEqual(expect.arrayContaining(['config', 'meta', 'backups']));
  expect(usage.total).toBeGreaterThan(0);
  const p = await h.page('dashboard.html#/settings/privacy');
  await p.text('Rules and settings', { exact: true }).expectVisible();
  await p.text('Automatic backups', { exact: true }).expectVisible();
  await p.text(/does not contact any server/).expectVisible();
});
