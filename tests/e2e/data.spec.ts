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

const LEECHBLOCK = [
  'numSets=2',
  'setName1=Social%20media',
  'sites1=lbsocial.test +lbsocial.test/help >ref.test ~cats',
  'times1=0000-2400',
  'days1=127',
  'limitMins1=',
  'limitPeriod1=',
  'blockURL1=blocked.html?$S&$U',
  'allowOverride1=true',
  'setName2=Video',
  'sites2=lbvideo.test',
  'times2=',
  'limitMins2=30',
  'limitPeriod2=86400',
  'days2=127',
  'blockURL2=delayed.html?$S&$U',
  'delaySecs2=20',
  'oa=2',
].join('\n');

test('DAT-02: LeechBlock NG export is converted with a report', async () => {
  const preview = (await h.rpc('data.preview', { text: LEECHBLOCK, mode: 'merge' })) as any;
  expect(preview.format).toBe('leechblock');
  expect(preview.groups.map((g: any) => g.name)).toEqual(['Social media', 'Video']);
  expect(preview.warnings.join(' ')).toContain('ref.test');
  expect(preview.warnings.join(' ')).toContain('cats');
  const r = (await h.rpc('data.import', { text: LEECHBLOCK, mode: 'merge' })) as any;
  expect(r.applied.length).toBeGreaterThan(0);
  const cfg = ((await h.rpc('config.get')) as any).config;
  const social = cfg.groups.find((g: any) => g.name === 'Social media');
  expect(social.targets.map((t: any) => `${t.allow ? '+' : ''}${t.value}`)).toEqual([
    'lbsocial.test',
    '+lbsocial.test/help',
  ]);
  expect(social.policies[0].schedule.windows[0]).toMatchObject({ start: 0, end: 1440 });
  const video = cfg.groups.find((g: any) => g.name === 'Video');
  expect(video.policies[0].budget).toMatchObject({ type: 'time', minutes: 30, period: { kind: 'day' } });
  expect(video.policies[0].intervention).toMatchObject({ type: 'delay', seconds: 20 });
  const p = await h.open('http://lbsocial.test/');
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
