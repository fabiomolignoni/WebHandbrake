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
  'groups/new',
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
      // One page with a section nav (docs/ux-redesign.md §6.5): every section is reachable.
      const ids: Record<string, string> = { 'When & how': 'rules', 'Block page': 'page' };
      for (const section of ['Sites', 'When & how', 'Breaks', 'Block page', 'Protection', 'Advanced']) {
        await p.locator('.section-nav').getByRole('button', { name: section, exact: true }).click();
        await p.waitForTimeout(150);
        await expect(p.locator(`#sec-${ids[section] ?? section.toLowerCase()}`)).toBeVisible();
      }
      // Rules open in place, with the friction picker.
      await p.locator('.policy-sentence').first().click();
      await expect(p.getByRole('radiogroup', { name: 'What happens' })).toBeVisible();
      if (shots) await p.screenshot({ path: `${shots}/${width}-editor-${g.name}.png`, fullPage: true });
    }
  });
}

test('a rule is created step by step: sites → when → what happens → review', async () => {
  await setup();
  const p = await h.page('dashboard.html#/groups');
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.getByRole('button', { name: 'New rule' }).click();
  await expect(p.getByRole('heading', { name: 'Which sites?' })).toBeVisible();
  // A rule needs sites: the next step stays closed until there is one.
  await expect(p.getByRole('button', { name: 'Next: when' })).toBeDisabled();
  await p.getByRole('button', { name: 'News', exact: true }).click();
  await p.getByPlaceholder('Add a site, or paste a list…').fill('papers.test');
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(p.getByLabel('Name', { exact: true })).toHaveValue('News');
  await p.getByRole('button', { name: 'Next: when' }).click();
  await p.getByRole('radio', { name: /At certain times/ }).click();
  await p.getByRole('button', { name: 'Next: what happens' }).click();
  // Nothing is pre-selected (active choice): every intervention is offered, "count only" needs
  // "every time", and a redirect needs an address.
  await expect(p.getByRole('button', { name: 'Next: review' })).toBeDisabled();
  await expect(p.locator('.friction-option')).toHaveCount(9);
  await expect(p.locator('.friction-option[aria-checked="true"]')).toHaveCount(0);
  await expect(p.getByRole('radio', { name: 'Count only' })).toBeDisabled();
  await p.getByRole('radio', { name: 'Redirect' }).click();
  await expect(p.getByRole('button', { name: 'Next: review' })).toBeDisabled();
  await p.getByLabel('Address', { exact: true }).fill('https://todo.test/');
  await expect(p.getByRole('button', { name: 'Next: review' })).toBeEnabled();
  await p.getByRole('radio', { name: 'Block' }).click();
  await p.getByRole('button', { name: 'Next: review' }).click();
  // The review states the plan: when (the schedule) and what happens.
  await expect(p.locator('.plan-text')).toContainText('Mon–Fri');
  await expect(p.locator('.plan-text')).toContainText('WebHandbrake blocks them.');
  await p.getByRole('button', { name: 'Create rule' }).click();
  await expect(p.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible({ timeout: 5000 });
  const cfg = ((await h.rpc('config.get')) as any).config;
  const created = cfg.groups[cfg.groups.length - 1];
  expect(created.name).toBe('News');
  expect(created.targets.map((x: any) => x.value)).toContain('papers.test');
  expect(created.policies).toHaveLength(1);
  expect(created.policies[0].schedule.mode).toBe('during');
  expect(created.policies[0].intervention.type).toBe('block');
});

test('first run: welcome → goal → sites → daily time → plan → done', async () => {
  const p = await h.page('dashboard.html#/welcome');
  await p.setViewportSize({ width: 1280, height: 900 });
  await expect(p.getByRole('heading', { name: 'Welcome to WebHandbrake' })).toBeVisible();
  await p.getByRole('button', { name: 'Set up in about a minute' }).click();
  // Progress starts endowed ("Installed" is already done) and counts only the steps of the goal.
  // No goal is pre-selected: we do not know why the extension was installed.
  await expect(p.locator('.choice[aria-checked="true"]')).toHaveCount(0);
  await expect(p.getByRole('button', { name: /^Next:/ })).toBeDisabled();
  await p.getByRole('radio', { name: /Spend less time on some sites/ }).click();
  await expect(p.getByText('Step 1 of 4')).toBeVisible();
  await p.getByRole('button', { name: 'Next: Sites' }).click();
  await expect(p.getByRole('button', { name: 'Next: Daily time' })).toBeDisabled();
  // The addresses of sensitive lists are not shown; the selection is summed up.
  await expect(p.getByRole('button', { name: /^Adult/ })).toContainText('not shown');
  await p.getByRole('button', { name: /^Video/ }).click();
  await p.getByPlaceholder('Add a site, or paste a list…').fill('clips.test');
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(p.locator('.selection')).toContainText('2 rules');
  await p.getByRole('button', { name: 'Next: Daily time' }).click();
  await p.getByRole('radio', { name: '45 min' }).click();
  await expect(p.getByRole('button', { name: 'Next: Your plan' })).toBeDisabled();
  await p.getByRole('radio', { name: 'Block' }).click();
  await p.getByRole('button', { name: 'Next: Your plan' }).click();
  await expect(p.locator('.plan-text')).toContainText('After 45 min a day on the sites in Video');
  await p.getByRole('radio', { name: /^Soft/ }).click();
  await p.getByLabel('Why does this matter to you?').fill('More evenings outside');
  await p.getByRole('button', { name: 'Turn on my plan' }).click();
  await expect(p.getByRole('heading', { name: "You're set" })).toBeVisible({ timeout: 5000 });
  const cfg = ((await h.rpc('config.get')) as any).config;
  const video = cfg.groups.find((g: any) => g.name === 'Video');
  expect(video.note).toBe('More evenings outside');
  expect(video.policies[0].budget).toMatchObject({ type: 'time', minutes: 45, period: { kind: 'day' } });
  expect(video.policies[0].intervention.type).toBe('block');
  const mine = cfg.groups.find((g: any) => g.name === 'My sites');
  expect(mine.targets.map((x: any) => x.value)).toEqual(['clips.test']);
  expect(cfg.settings.protection.level).toBe('soft');
  expect(cfg.settings.onboarded).toBe(true);
});

test('first run: the steps follow the goal ("block" has no details step)', async () => {
  const p = await h.page('dashboard.html#/welcome');
  await p.getByRole('button', { name: 'Set up in about a minute' }).click();
  await p.getByRole('radio', { name: /Block some sites completely/ }).click();
  await expect(p.getByText('Step 1 of 3')).toBeVisible();
  await p.getByRole('button', { name: 'Next: Sites' }).click();
  await expect(p.getByRole('button', { name: 'Next: Your plan' })).toBeVisible();
});

test('the wizard hands its draft to the full editor', async () => {
  await setup();
  const p = await h.page('dashboard.html#/groups/new?template=video');
  await p.setViewportSize({ width: 1280, height: 900 });
  await expect(p.locator('.target-row .value').first()).toBeVisible();
  await p.getByRole('button', { name: 'Use the full editor' }).click();
  await expect(p.locator('.section-nav')).toBeVisible();
  await expect(p.getByLabel('Name', { exact: true })).toHaveValue('Video');
  await expect(p.locator('#sec-sites .target-row')).not.toHaveCount(0);
});

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
