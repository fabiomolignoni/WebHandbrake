import { expect, test } from '@playwright/test';
import { BLOCK, group, policy } from './fixtures';
import { type Harness, launch } from './harness';

let h: Harness;
test.beforeEach(async () => {
  h = await launch();
});
test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

const LIST = [
  '# sites that distract me',
  'social.test',
  '0.0.0.0 video.test',
  '||news.test^',
  'not a site ::',
].join('\n');

test('DAT-02: a plain list of sites (hosts file, uBlock syntax) becomes a rule, with a report', async () => {
  const preview = (await h.rpc('data.preview', { text: LIST, mode: 'merge' })) as any;
  expect(preview.format).toBe('list');
  expect(preview.groups).toEqual([{ name: 'Imported list', sites: 3, policies: 1 }]);
  expect(preview.warnings.join(' ')).toContain('not a site');
  const r = (await h.rpc('data.import', { text: LIST, mode: 'merge' })) as any;
  expect(r.applied.length).toBeGreaterThan(0);
  const cfg = ((await h.rpc('config.get')) as any).config;
  const imported = cfg.groups.find((g: any) => g.name === 'Imported list');
  expect(imported.targets.map((t: any) => t.value).sort()).toEqual([
    'news.test',
    'social.test',
    'video.test',
  ]);
  const p = await h.open('http://news.test/');
  expect(p.url()).toContain('intervention.html');
});

test('DAT-01: export and re-import round trip; LST-03 group sharing', async () => {
  await h.configure((c) => {
    c.groups = [group('Share me', ['share.test'], [policy(BLOCK)])];
  });
  const exp = (await h.rpc('data.export', { stats: true, secrets: false })) as any;
  expect(exp.filename).toMatch(/^webhandbrake-\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
  const data = JSON.parse(exp.text);
  expect(data.format).toBe('webhandbrake');
  expect(data.config.groups[0].name).toBe('Share me');
  const preview = (await h.rpc('data.preview', { text: exp.text, mode: 'replace' })) as any;
  expect(preview.units).toEqual([]);
  const id = data.config.groups[0].id;
  const shared = (await h.rpc('group.export', { groupId: id })) as any;
  const r = (await h.rpc('data.import', { text: shared.text, mode: 'merge' })) as any;
  expect(r.applied.map((u: any) => u.kind)).toEqual(['group.add']);
  const cfg = ((await h.rpc('config.get')) as any).config;
  expect(cfg.groups.map((g: any) => g.name)).toEqual(['Share me', 'Share me']);
});
