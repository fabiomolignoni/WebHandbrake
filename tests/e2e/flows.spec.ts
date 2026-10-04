import { expect, test } from '@playwright/test';
import { group, policy } from './fixtures';
import { type Harness, launch } from './harness';

let h: Harness;
test.beforeEach(async () => {
  h = await launch();
});
test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

const isIntervention = (url: string) => url.includes('/intervention.html#');

test('FOC-01: a focus session starts from the popup in two taps and blocks the groups', async () => {
  await h.configure((c) => {
    c.groups = [group('Games', ['games.test'], [policy({ type: 'track' })])];
  });
  expect(isIntervention((await h.open('http://games.test/')).url())).toBe(false);
  const popup = await h.page('popup.html');
  await popup.getByRole('combobox', { name: 'Duration' }).selectOption('50');
  await popup.getByRole('button', { name: 'Start focus' }).click();
  await expect(popup.getByText(/Focus until/)).toBeVisible();
  expect(isIntervention((await h.open('http://games.test/')).url())).toBe(true);
  const ov = (await h.rpc('overview.get')) as any;
  expect(Math.round((ov.sessions[0].endAt - ov.sessions[0].startAt) / 60_000)).toBe(50);
});

test('MAT-17: adding the current page creates a group and restricts the open tab', async () => {
  await h.configure((c) => {
    c.groups = [group('Misc', ['misc.test'], [policy({ type: 'block' })])];
  });
  const site = await h.open('http://shop.test/cart/item');
  const r = (await h.rpc('config.addPage', {
    url: 'http://shop.test/cart/item',
    granularity: 'path',
    groupId: null,
    newGroupName: 'Shopping',
  })) as any;
  expect(r.applied.map((u: any) => u.kind)).toContain('group.add');
  const cfg = ((await h.rpc('config.get')) as any).config;
  const shopping = cfg.groups.find((g: any) => g.name === 'Shopping');
  expect(shopping.targets[0]).toMatchObject({ type: 'path', value: 'shop.test/cart/item' });
  // The open tab is restricted as soon as the site is added (ENF-02).
  await expect.poll(() => isIntervention(site.url()), { timeout: 5000 }).toBe(true);
});

test('INT-03: the intention question grants the chosen time and records the intention', async () => {
  await h.configure((c) => {
    c.groups = [
      group('Video', ['tube.test'], [policy({ type: 'ask', seconds: 1, choices: [5, 10], maxMinutes: 10 })]),
    ];
  });
  const p = await h.open('http://tube.test/watch');
  expect(isIntervention(p.url())).toBe(true);
  await p.getByRole('button', { name: 'Reply to a message' }).click();
  await p.getByRole('radio', { name: '10 min' }).click();
  await p.getByRole('button', { name: 'Continue for 10 min' }).click();
  await expect(p.locator('#real')).toBeVisible({ timeout: 5000 });
  const d = (await h.rpc('explain', { url: 'http://tube.test/other' })) as any;
  expect(d.groups[0].pass.intention).toBe('Reply to a message');
  expect(d.groups[0].pass.until - Date.now()).toBeGreaterThan(9 * 60_000);
});

test('INT-12: a blocked page can be saved for later and reopened when allowed', async () => {
  await h.configure((c) => {
    c.groups = [group('News', ['paper.test'], [policy({ type: 'block' })])];
  });
  const p = await h.open('http://paper.test/story');
  await p.getByRole('button', { name: 'Save for later' }).click();
  await expect(p.getByRole('button', { name: 'Saved' })).toBeVisible();
  const later = (await h.rpc('later.list')) as any;
  expect(later.items[0]).toMatchObject({ url: 'http://paper.test/story', allowedNow: false });
  const stats = (await h.rpc('overview.get')) as any;
  expect(stats.today.shown).toBeGreaterThanOrEqual(1);
});
