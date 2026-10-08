/**
 * The dashboard in a real browser (ONB, SET, SCH-02, MAT-22, STA-02): every page, the rule
 * wizard, the first run, the rule editor, the rule list, shared lists, settings and insights.
 */

import { expect, type Harness, test } from './harness';
import { ask, BLOCK, delay, during, group, policy, timeBudget, window as weekly } from './harness/config';
import { expectAllowed, expectBlocked, useUntil } from './helpers';

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

async function setup(h: Harness) {
  await h.configure((c) => {
    c.groups = [
      group(
        'Social',
        ['social.test', 'chat.test'],
        [
          policy(BLOCK, { schedule: during(weekly([1, 2, 3, 4, 5], 540, 1020)) }),
          policy(delay(30), { budget: timeBudget(30) }),
        ],
      ),
      group('Video', ['video.test'], [policy(ask({ seconds: 5, choices: [5, 10], maxMinutes: 15 }))]),
    ];
  });
}

for (const width of [1280, 390]) {
  test(`every dashboard page renders without errors and without horizontal scroll at ${width}px`, async ({
    h,
    browserName,
  }) => {
    await setup(h);
    const p = await h.page('dashboard.html#/today');
    await p.viewport(width, 900);
    const actual = await p.eval(() => window.innerWidth);
    // Firefox keeps a minimum window width: the narrowest it allows.
    if (browserName === 'chromium') expect(actual).toBe(width);
    for (const route of ROUTES) {
      await p.eval((r: string) => {
        location.hash = `#/${r}`;
      }, route);
      await p.get('h1').waitFor('visible');
      await expect
        .poll(() => p.overflowX(), { message: `horizontal overflow on ${route}` })
        .toBeLessThanOrEqual(0);
      if (shots) await p.screenshot(`${shots}/${browserName}-${width}-${route.replace('/', '-')}.png`);
    }
    const cfg = (await h.rpc('config.get')).config;
    for (const g of cfg.groups) {
      await p.eval((id: string) => {
        location.hash = `#/groups/${id}`;
      }, g.id);
      await p.get('.section-nav').waitFor('visible');
      // One page with a section nav (docs/design.md): every section is reachable.
      const ids: Record<string, string> = { 'When & how': 'rules', 'Block page': 'page' };
      for (const section of ['Sites', 'When & how', 'Breaks', 'Block page', 'Protection', 'Advanced']) {
        await p.button(section, { exact: true, within: '.section-nav' }).click();
        await p.get(`#sec-${ids[section] ?? section.toLowerCase()}`).expectVisible();
      }
      // Conditions open in place, with the friction picker.
      await p.get('.policy-sentence').click();
      await p.role('radiogroup', 'What happens').expectVisible();
      expect(await p.overflowX()).toBeLessThanOrEqual(0);
    }
  });
}

test('a rule is created step by step: sites → when → what happens → review', async ({ h }) => {
  await setup(h);
  const p = await h.page('dashboard.html#/groups');
  await p.button('New rule').click();
  await p.role('heading', 'Which sites?').expectVisible();
  // A rule needs sites: the next step stays closed until there is one.
  await p.button('Next: when').expectEnabled(false);
  await p.button('News', { exact: true }).click();
  await p.placeholder('Add a site, or paste a list…').fill('papers.test');
  await p.button('Add', { exact: true }).click();
  await p.label('Name', { exact: true }).expectValue('News');
  await p.button('Next: when').click();
  await p.role('radio', /At certain times/).click();
  await p.button('Next: what happens').click();
  // Nothing is pre-selected (active choice): every intervention is offered, "count only" needs
  // "every time", and a redirect needs an address.
  await p.button('Next: review').expectEnabled(false);
  await p.get('.friction-option').expectCount(9);
  await p.get('.friction-option[aria-checked="true"]').expectCount(0);
  await p.role('radio', 'Count only').expectEnabled(false);
  await p.role('radio', 'Redirect').click();
  await p.button('Next: review').expectEnabled(false);
  await p.label('Address', { exact: true }).fill('https://todo.test/');
  await p.button('Next: review').expectEnabled(true);
  await p.role('radio', 'Block').click();
  await p.button('Next: review').click();
  // The review states the plan: when (the schedule) and what happens.
  await p.get('.plan-text').expectText('Mon–Fri');
  await p.get('.plan-text').expectText('WebHandbrake blocks them.');
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  const created = cfg.groups[cfg.groups.length - 1];
  expect(created.name).toBe('News');
  expect(created.targets.map((x: any) => x.value)).toContain('papers.test');
  expect(created.policies).toHaveLength(1);
  expect(created.policies[0].schedule.mode).toBe('during');
  expect(created.policies[0].intervention.type).toBe('block');
});

test('ONB-01: first run, welcome → goal → sites → daily time → plan → done', async ({ h }) => {
  const p = await h.page('dashboard.html#/welcome');
  await p.role('heading', 'Welcome to WebHandbrake').expectVisible();
  await p.button('Set up in about a minute').click();
  // No goal is pre-selected: we do not know why the extension was installed.
  await p.get('.choice[aria-checked="true"]').expectCount(0);
  await p.button(/^Next:/).expectEnabled(false);
  await p.role('radio', /Spend less time on some sites/).click();
  await p.text('Step 1 of 4').expectVisible();
  await p.button('Next: Sites').click();
  await p.button('Next: Daily time').expectEnabled(false);
  // The addresses of sensitive lists are not shown; the selection is summed up.
  await p.button(/^Adult/).expectText('not shown');
  await p.button(/^Video/).click();
  await p.placeholder('Add a site, or paste a list…').fill('clips.test');
  await p.button('Add', { exact: true }).click();
  await p.get('.selection').expectText('2 rules');
  await p.button('Next: Daily time').click();
  await p.role('radio', '45 min').click();
  await p.button('Next: Your plan').expectEnabled(false);
  await p.role('radio', 'Block').click();
  await p.button('Next: Your plan').click();
  await p.get('.plan-text').expectText('After 45 min a day on the sites in Video');
  await p.role('radio', /^Soft/).click();
  await p.label('Why does this matter to you?').fill('More evenings outside');
  await p.button('Turn on my plan').click();
  await p.role('heading', "You're set").expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  const video = cfg.groups.find((g: any) => g.name === 'Video');
  expect(video.note).toBe('More evenings outside');
  expect(video.policies[0].budget).toMatchObject({ type: 'time', minutes: 45, period: { kind: 'day' } });
  expect(video.policies[0].intervention.type).toBe('block');
  const mine = cfg.groups.find((g: any) => g.name === 'My sites');
  expect(mine.targets.map((x: any) => x.value)).toEqual(['clips.test']);
  expect(cfg.settings.protection.level).toBe('soft');
  expect(cfg.settings.onboarded).toBe(true);
  // The plan is in force right away.
  await expectAllowed(h, 'http://clips.test/');
});

test('ONB-01: the steps follow the goal ("block" has no details step) and the plan blocks at once', async ({
  h,
}) => {
  const p = await h.page('dashboard.html#/welcome');
  await p.button('Set up in about a minute').click();
  await p.role('radio', /Block some sites completely/).click();
  await p.text('Step 1 of 3').expectVisible();
  await p.button('Next: Sites').click();
  await p.placeholder('Add a site, or paste a list…').fill('casino.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: Your plan').click();
  await p.button('Turn on my plan').click();
  await p.role('heading', "You're set").expectVisible();
  await expectBlocked(h, 'http://casino.test/');
});

test('the wizard hands its draft to the full editor', async ({ h }) => {
  await setup(h);
  const p = await h.page('dashboard.html#/groups/new?template=video');
  await p.get('.target-row .value').expectVisible();
  await p.button('Use the full editor').click();
  await p.get('.section-nav').expectVisible();
  await p.label('Name', { exact: true }).expectValue('Video');
  expect(await p.get({ css: '#sec-sites .target-row' }).count()).toBeGreaterThan(0);
});

test('MAT-02: the editor normalises a pasted address and saves a renamed rule', async ({ h }) => {
  await setup(h);
  const cfg = (await h.rpc('config.get')).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[1].id}`);
  await p.label('Name', { exact: true }).fill('Videos');
  await p.placeholder('Add a site, or paste a list…').fill('https://www.Stream.test/watch?v=1');
  await p.button('Add', { exact: true }).click();
  await p.get('.target-row .value').expectCount(2);
  await p.text('stream.test/watch?v=1').expectVisible();
  await p.text('Unsaved changes').expectVisible();
  await p.button('Save changes').click();
  await p.text('Unsaved changes').expectCount(0);
  const after = (await h.rpc('config.get')).config.groups[1];
  expect(after.name).toBe('Videos');
  expect(after.targets.map((t: any) => t.value)).toContain('stream.test/watch?v=1');
  await expectBlocked(h, 'http://stream.test/watch?v=1');
});

test('the rule editor follows changes made elsewhere while nothing is edited', async ({ h }) => {
  await setup(h);
  const cfg = (await h.rpc('config.get')).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[1].id}`);
  await p.text('video.test', { within: '.target-row' }).expectVisible();
  // A site added from the popup or the context menu.
  await h.rpc('config.addPage', {
    url: 'http://clips.test/a',
    granularity: 'domain',
    groupId: cfg.groups[1].id,
  });
  await p.text('clips.test', { within: '.target-row' }).expectVisible();
  await p.text('Unsaved changes').expectCount(0);
});

test('SET-04: the rule list turns rules on and off, duplicates, archives and searches', async ({ h }) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
  });
  await setup(h);
  const p = await h.page('dashboard.html#/groups');
  // Strengthening: turning a rule on is immediate; turning it off asks for a confirmation (Soft).
  await p.role('switch', 'Turn Video on or off').click();
  await p.button('Yes, continue').click();
  await expect.poll(async () => (await h.rpc('config.get')).config.groups[1].enabled).toBe(false);
  await expectAllowed(h, 'http://video.test/');
  await p.role('switch', 'Turn Video on or off').click();
  await expect.poll(async () => (await h.rpc('config.get')).config.groups[1].enabled).toBe(true);
  await p.button('More actions for Social').click();
  await p.role('menuitem', 'Duplicate').click();
  await expect
    .poll(async () => (await h.rpc('config.get')).config.groups.map((g: any) => g.name))
    .toEqual(['Social', 'Video', 'Social (copy)']);
  await p.label('Search rules and sites').fill('video.test');
  await p.text('Social', { exact: true, within: '.group-list, main' }).expectCount(0);
  await p.text('Video', { exact: true, within: 'main' }).expectVisible();
});

test('MAT-18: a shared list is created and used by a rule', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Weekdays', ['weekday.test'], [policy(BLOCK)])];
  });
  const p = await h.page('dashboard.html#/lists');
  await p.button('New list').click();
  await p.label('Name').fill('Social media');
  // A list is pasted: the field becomes a text area with every line.
  await p.placeholder('Add a site, or paste a list…').paste('one.test\ntwo.test');
  await p.get('textarea.textarea').expectValue('one.test\ntwo.test');
  await p.button('Add', { exact: true }).click();
  await p.button(/Save|Create/).click();
  await expect
    .poll(async () => (await h.rpc('config.get')).config.lists.map((l: any) => l.name))
    .toEqual(['Social media']);
  const list = (await h.rpc('config.get')).config.lists[0];
  expect(list.targets.map((t: any) => t.value)).toEqual(['one.test', 'two.test']);
  await h.configure((c) => {
    c.groups[0].lists = [list.id];
  });
  await expectBlocked(h, 'http://two.test/');
  await p.eval(() => {
    location.hash = '#/lists';
  });
  await p.text(/used by Weekdays/).expectVisible();
});

test('SEM-05: a site added to "Always allowed" from its page loosens the rules with their cost', async ({
  h,
}) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
  });
  await h.configure((c) => {
    c.groups = [group('Block', ['bank.test'], [policy(BLOCK)])];
  });
  const p = await h.page('dashboard.html#/allowlist');
  await p.placeholder('Add a site, or paste a list…').fill('bank.test/login');
  await p.button('Add', { exact: true }).click();
  await p.button(/Save/).click();
  await p.button('Yes, continue').click();
  await expect.poll(async () => (await h.rpc('config.get')).config.allowlist.length).toBe(1);
  await expectAllowed(h, 'http://bank.test/login');
  await expectBlocked(h, 'http://bank.test/');
});

test('SET-01: the theme applies to every page of the extension', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Block', ['blocked.test'], [policy(BLOCK)])];
  });
  const p = await h.page('dashboard.html#/settings/general');
  await p.role('radio', 'Dark').click();
  await expect.poll(() => p.eval(() => document.documentElement.dataset.theme)).toBe('dark');
  await p.role('switch', 'High contrast').click();
  await expect.poll(() => p.eval(() => document.documentElement.dataset.contrast)).toBe('high');
  const blocked = await expectBlocked(h, 'http://blocked.test/');
  await blocked.role('heading', /protected/).expectVisible();
  expect(await blocked.eval(() => document.documentElement.dataset.theme)).toBe('dark');
  const popup = await h.popup(blocked);
  await popup.get('.popup-head').expectVisible();
  expect(await popup.eval(() => document.documentElement.dataset.theme)).toBe('dark');
});

test('STA-02 / STA-03: insights show the time per rule and site, and the impulses resisted', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test'], [policy(delay(30), { budget: timeBudget(30) })])];
  });
  const p = await expectAllowed(h, 'http://video.test/');
  await useUntil(p, async () => false, 3000);
  await h.rpc('budget.forfeit', { groupId: (await h.rpc('config.get')).config.groups[0].id });
  await p.expectIntervention(true, 5000);
  await p.button('Close the tab').click();
  await h.rpc('test.flush');
  const insights = await h.page('dashboard.html#/insights');
  await insights.text('Video', { exact: true, within: 'main' }).expectVisible();
  await insights.text('video.test', { exact: true, within: 'main' }).expectVisible();
  await insights.text(/time you chose not to go in/).expectVisible();
  const today = await h.page('dashboard.html#/today');
  await today.text('Video', { within: 'main' }).expectVisible();
});
