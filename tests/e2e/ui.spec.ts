import { expect, test } from '@playwright/test';
import { BLOCK, delay, group, policy } from './fixtures';
import { type Harness, launch } from './harness';

let h: Harness;
test.beforeEach(async () => {
  h = await launch();
});
test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

const ROUTES = [
  'today',
  'groups',
  'lists',
  'allowlist',
  'focus',
  'later',
  'insights',
  'protection',
  'settings/general',
  'settings/feedback',
  'settings/time',
  'settings/interventions',
  'settings/data',
  'settings/privacy',
  'settings/diagnostics',
  'help',
  'welcome',
];

const shots = process.env.WHB_SCREENSHOTS;

async function setup() {
  await h.configure((c) => {
    c.groups = [
      group(
        'Social',
        ['social.test', 'chat.test'],
        [
          policy(BLOCK, {
            schedule: { mode: 'during', windows: [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }] },
          }),
          policy(delay(30), { budget: { type: 'time', minutes: 30, period: { kind: 'day' } } }),
        ],
      ),
      group('Video', ['video.test'], [policy({ type: 'ask', seconds: 5, choices: [5, 10], maxMinutes: 15 })]),
    ];
  });
}

for (const width of [1280, 390]) {
  test(`every dashboard page renders without errors at ${width}px`, async () => {
    await setup();
    const p = await h.page('dashboard.html#/today');
    await p.setViewportSize({ width, height: 900 });
    for (const route of ROUTES) {
      await p.evaluate((r) => {
        location.hash = `#/${r}`;
      }, route);
      await p.waitForTimeout(500);
      await expect(p.locator('h1').first()).toBeVisible();
      // Responsive layout: never a horizontal page scroll (§8.1).
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(0);
      if (shots)
        await p.screenshot({ path: `${shots}/${width}-${route.replace('/', '-')}.png`, fullPage: true });
    }
    const cfg = ((await h.rpc('config.get')) as any).config;
    for (const g of cfg.groups) {
      await p.evaluate((id) => {
        location.hash = `#/groups/${id}`;
      }, g.id);
      await p.waitForTimeout(400);
      for (const tab of ['Sites', 'Rules', 'Breaks & page', 'Protection', 'More']) {
        await p.getByRole('tab', { name: tab }).click();
        await p.waitForTimeout(150);
        if (shots)
          await p.screenshot({
            path: `${shots}/${width}-editor-${g.name}-${tab.replace(/\W+/g, '')}.png`,
            fullPage: true,
          });
      }
    }
  });
}

test('the group editor saves a renamed group and a new site', async () => {
  await setup();
  const cfg = ((await h.rpc('config.get')) as any).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[1].id}`);
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.getByLabel('Name').fill('Videos');
  await p.getByPlaceholder('Add a site, or paste a list…').fill('https://www.Stream.test/watch?v=1');
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(p.locator('.target-row .value', { hasText: 'stream.test/watch' })).toBeVisible();
  await p.getByRole('button', { name: 'Save changes' }).click();
  await expect(p.getByText('Unsaved changes')).toHaveCount(0, { timeout: 5000 });
  const after = ((await h.rpc('config.get')) as any).config.groups[1];
  expect(after.name).toBe('Videos');
  expect(after.targets.map((t: any) => t.value)).toContain('stream.test/watch?v=1');
});

test('popup and intervention page render for a restricted site', async () => {
  await setup();
  const site = await h.open('http://video.test/');
  expect(site.url()).toContain('intervention.html');
  if (shots) await site.screenshot({ path: `${shots}/intervention-ask.png`, fullPage: true });
  const popup = await h.page('popup.html');
  await popup.setViewportSize({ width: 380, height: 640 });
  await expect(popup.getByText('WebHandbrake').first()).toBeVisible();
  if (shots) await popup.screenshot({ path: `${shots}/popup.png` });
  const social = await h.open('http://social.test/');
  if (shots) await social.screenshot({ path: `${shots}/intervention-social.png`, fullPage: true });
});

test('the popup keeps its width when the browser sizes it from its content', async () => {
  await setup();
  // Browsers size toolbar popups from the content, starting from a very small viewport.
  const popup = await h.page('popup.html');
  await popup.setViewportSize({ width: 40, height: 400 });
  await expect(popup.locator('.popup-head')).toBeVisible();
  const width = await popup.evaluate(
    () => document.querySelector<HTMLElement>('.popup')!.getBoundingClientRect().width,
  );
  expect(width).toBe(380);
});

test('the group editor follows changes made elsewhere while nothing is edited', async () => {
  await setup();
  const cfg = ((await h.rpc('config.get')) as any).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[1].id}`);
  await expect(p.locator('.target-row .value', { hasText: 'video.test' })).toBeVisible();
  // A site added from the popup or the context menu.
  await h.rpc('config.addPage', {
    url: 'http://clips.test/a',
    granularity: 'domain',
    groupId: cfg.groups[1].id,
  });
  await expect(p.locator('.target-row .value', { hasText: 'clips.test' })).toBeVisible({ timeout: 5000 });
  await expect(p.getByText('Unsaved changes')).toHaveCount(0);
});
