/**
 * The dashboard in a real browser: every page, the rule
 * editor creating a rule and changing one, the first run, the rule list, settings and insights.
 */

import { timeStep, totp } from '../../src/background/totp';
import { expect, type Harness, type Tab, test } from './harness';
import {
  ask,
  BLOCK,
  delay,
  during,
  group,
  pauseFree,
  policy,
  REMINDER,
  TRACK,
  timeBudget,
  wait,
  window as weekly,
} from './harness/config';
import { expectAllowed, expectBlocked, openPart, useUntil } from './helpers';

const ROUTES = [
  'today',
  'groups',
  'groups/new',
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

/**
 * From What happens to the summary of a new rule, through its protection (#12) and its details (a
 * name, unless it has one).
 */
async function toSummary(p: Tab, { name, protection = 'Wait' }: { name?: string; protection?: string } = {}) {
  await p.button('Next: protection').click();
  const radio = p.role('radio', new RegExp(`^${protection}`));
  if (!(await radio.checked())) await radio.click();
  await p.button('Next: details').click();
  if (name !== undefined) await p.label('Name', { exact: true }).fill(name);
  await p.button('Next: summary').click();
}

/** The parts of the rule editor and the heading of each. */
const PARTS = {
  Summary: 'This rule at a glance',
  Sites: 'Which sites?',
  When: 'When should it apply?',
  'What happens': 'What should happen?',
  Protection: 'What should loosening this rule take?',
  Details: 'Name, reason and block page',
};

async function setup(h: Harness, protection: unknown = wait(30)) {
  await h.configure((c) => {
    c.groups = [
      group(
        'Social',
        ['social.test', 'chat.test'],
        [policy(BLOCK, { schedule: during(weekly([1, 2, 3, 4, 5], 540, 1020)) })],
      ),
      group('Video', ['video.test'], [policy(ask({ maxMinutes: 15 }))]),
    ];
    for (const g of c.groups) g.protection = protection;
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
      await p.get('.editor-steps').waitFor('visible');
      // Every part of the rule opens. A break lifts a block only, so only a rule that blocks has
      // breaks, under what happens.
      const blocks = g.policies.some((x: any) => x.intervention.type === 'block');
      for (const [part, title] of Object.entries(PARTS)) {
        await openPart(p, part);
        await p.role('heading', title).expectVisible();
        if (part === 'What happens') await p.role('switch', 'Allow breaks').expectCount(blocks ? 1 : 0);
        expect(await p.overflowX(), `horizontal overflow on ${part}`).toBeLessThanOrEqual(0);
      }
      await openPart(p, 'When');
      await p.role('radiogroup', 'When should it apply?').expectVisible();
      expect(await p.overflowX()).toBeLessThanOrEqual(0);
      await openPart(p, 'What happens');
      await p.role('radiogroup', 'What happens').expectVisible();
      expect(await p.overflowX()).toBeLessThanOrEqual(0);
    }
  });
}

test('a rule is created step by step: sites → when → what happens → protection → details → summary', async ({
  h,
}) => {
  await setup(h);
  const p = await h.page('dashboard.html#/groups');
  await p.button('New rule').click();
  await p.role('heading', 'Which sites?').expectVisible();
  // A rule needs sites: the next step stays closed until there is one.
  await p.button('Next: when').expectEnabled(false);
  await p.button('News', { exact: true }).click();
  await p.placeholder('Add a site, or paste a list…').fill('papers.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.role('radio', /At certain times/).click();
  await p.button('Next: what happens').click();
  // Nothing is pre-selected (active choice): every intervention is offered, "count only" too
  // (#21), and a redirect needs an address.
  await p.button('Next: protection').expectEnabled(false);
  await p.get('.friction-option').expectCount(8);
  await p.get('.friction-option[aria-checked="true"]').expectCount(0);
  await p.role('radio', 'Count only').expectEnabled(true);
  await p.role('radio', 'Redirect').click();
  await p.button('Next: protection').expectEnabled(false);
  await p.label('Address', { exact: true }).fill('https://todo.test/');
  await p.button('Next: protection').expectEnabled(true);
  await p.role('radio', 'Block').click();
  // Protection (#12): one of six, nothing pre-selected; a wait as long as chosen.
  await p.button('Next: protection').click();
  await p.role('heading', 'What should loosening this rule take?').expectVisible();
  await p.get('.choice').expectCount(6);
  await p.get('.choice[aria-checked="true"]').expectCount(0);
  await p.button('Next: details').expectEnabled(false);
  await p.role('radio', /^Wait/).click();
  await p.role('radio', '1 h').click();
  await p.text(/waits 1 h, then you confirm it in Protection/).expectVisible();
  // The ready-made list named the rule.
  await p.button('Next: details').click();
  await p.label('Name', { exact: true }).expectValue('News');
  await p.button('Next: summary').click();
  // The summary states the plan: when (the schedule) and what happens.
  await p.get('.plan-text').expectText('Mon–Fri');
  await p.get('.plan-text').expectText('WebHandbrake blocks the page.');
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  const created = cfg.groups[cfg.groups.length - 1];
  expect(created.name).toBe('News');
  expect(created.targets.map((x: any) => x.value)).toContain('papers.test');
  expect(created.policies).toHaveLength(1);
  expect(created.policies[0].schedule.mode).toBe('during');
  expect(created.policies[0].intervention.type).toBe('block');
  expect(created.protection).toEqual({ kind: 'wait', seconds: 3600 });
  // Breaks are off until turned on, whatever the protection.
  expect(created.pause).toMatchObject({
    allowed: false,
    maxMinutes: 15,
    cost: { type: 'delay', seconds: 30 },
  });
});

/** A new rule up to its protection. */
async function toProtection(h: Harness, site: string): Promise<Tab> {
  const p = await h.page('dashboard.html#/groups/new');
  await p.role('heading', 'Which sites?').expectVisible();
  await p.placeholder('Add a site, or paste a list…').fill(site);
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  await p.button('Next: protection').click();
  return p;
}

/** From the protection of a new rule to its summary, naming it. */
async function named(p: Tab, name: string) {
  await p.button('Next: details').click();
  await p.label('Name', { exact: true }).fill(name);
  await p.button('Next: summary').click();
}

/** The new rule's state for the session, as stored. */
const draftState = async (p: Tab) => (await p.eval(() => sessionStorage.getItem('whb-new-rule'))) ?? '';

test("a new rule's Password protection is hashed in the background and never kept for the session", async ({
  h,
}) => {
  const p = await toProtection(h, 'bet.test');
  await p.role('radio', /^Password/).click();
  // The rule is not named yet: its name comes in Details, after the protection.
  await p.role('heading', 'Password of Unnamed rule').expectVisible();
  await p.label('New password').type('only my sister knows');
  await p.label('Repeat the password').type('only my sister knows');
  await p.button('Save', { exact: true, within: 'dialog' }).click();
  await p.text(/Password set/).expectVisible();
  expect(await p.role('radio', /^Password/).checked()).toBe(true);
  await named(p, 'Gambling');
  await p.text('Password', { exact: true, within: '.summary-list' }).expectVisible();
  // The new rule is kept for the session, but never the password hash.
  expect(await draftState(p)).toContain('Gambling');
  expect(await draftState(p)).not.toContain('pbkdf2');
  // Resumed without the password (here after a reload), the rule asks for the protection again
  // instead of being created with the default one; what comes after it is kept.
  await p.reload();
  await p.role('heading', 'What should loosening this rule take?').expectVisible();
  await p.get('.choice[aria-checked="true"]').expectCount(0);
  await p.button('Next: details').expectEnabled(false);
  await p.role('radio', /^Password/).click();
  await p.label('New password').type('only my sister knows');
  await p.label('Repeat the password').type('only my sister knows');
  await p.button('Save', { exact: true, within: 'dialog' }).click();
  await p.button('Next: details').click();
  await p.label('Name', { exact: true }).expectValue('Gambling');
  await p.button('Next: summary').click();
  await p.text('Password', { exact: true, within: '.summary-list' }).expectVisible();
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const created = (await h.rpc('config.get')).config.groups.find((g: any) => g.name === 'Gambling');
  expect(created.protection.kind).toBe('password');
  expect(created.protection.hash).toMatch(/^pbkdf2-sha256\$/);
  expect(JSON.stringify(created)).not.toContain('only my sister knows');
  // Loosening it asks for its password.
  const cfg = (await h.rpc('config.get')).config;
  cfg.groups.find((g: any) => g.id === created.id).targets = [];
  const r = await h.rpc('config.save', { config: cfg });
  expect(r.ticket.step).toEqual({ type: 'rulePassword', names: ['Gambling'] });
  await h.rpc('ticket.cancel', { id: r.ticket.id });
});

test("a new rule's Partner code protection is set up with a code from the partner's app", async ({ h }) => {
  const p = await toProtection(h, 'casino.test');
  await p.role('radio', /^Partner code/).click();
  await p.role('heading', 'Set up a partner code for Unnamed rule').expectVisible();
  const secret = (await p.get('.partner-key').text()).replace(/\s/g, '');
  await p.label('Code from your partner’s app').fill('000000');
  await p.button('Confirm', { exact: true, within: 'dialog' }).click();
  await p.text(/That code does not match/).expectVisible();
  await p.label('Code from your partner’s app').fill(await totp(secret, timeStep(await h.clock.now())));
  await p.button('Confirm', { exact: true, within: 'dialog' }).click();
  await p.text('Your partner’s app shows the codes for this rule.').expectVisible();
  expect(await draftState(p)).not.toContain(secret);
  await named(p, 'Casino');
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const created = (await h.rpc('config.get')).config.groups.find((g: any) => g.name === 'Casino');
  // The rule allows no breaks: nothing to ask the partner for them.
  expect(created.protection).toEqual({ kind: 'partner', secret, breaks: false });
  const cfg = (await h.rpc('config.get')).config;
  cfg.groups.find((g: any) => g.id === created.id).targets = [];
  const r = await h.rpc('config.save', { config: cfg });
  expect(r.ticket.step).toEqual({ type: 'partner', names: ['Casino'] });
  await h.rpc('ticket.cancel', { id: r.ticket.id });
});

test('the Wait protection takes a wait of any length, typed as a number and a unit', async ({ h }) => {
  const p = await toProtection(h, 'slow.test');
  await p.role('radio', /^Wait/).click();
  const length = p.label('Length of the wait', { exact: true });
  const unit = p.label('Length of the wait: unit');
  await length.expectCount(0);
  // "Other" starts from the wait chosen so far.
  await p.role('radio', 'Other', { exact: true }).click();
  await length.expectValue('30');
  await unit.expectValue('seconds');
  await unit.select('minutes');
  await length.fill('45');
  await p.text('Loosening the rule waits 45 min, then you confirm it in Protection.').expectVisible();
  await named(p, 'Slow');
  await p.text('Wait · 45 min', { exact: true, within: '.summary-list' }).expectVisible();
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const created = (await h.rpc('config.get')).config.groups.find((g: any) => g.name === 'Slow');
  expect(created.protection).toEqual(wait(2700));
  // The rule opens with its own wait under "Other"; a usual one closes the field.
  const editor = await h.page(`dashboard.html#/groups/${created.id}?step=protection`);
  await editor.role('radio', 'Other', { exact: true }).expectChecked(true);
  await editor.label('Length of the wait', { exact: true }).expectValue('45');
  await editor.label('Length of the wait: unit').expectValue('minutes');
  await editor.role('radio', '2 min', { exact: true }).click();
  await editor.label('Length of the wait', { exact: true }).expectCount(0);
});

test('a new rule takes wildcards and every website, and the editor warns (#20, #23)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.role('heading', 'Which sites?').expectVisible();
  // An address, not words: a phone's keyboard neither capitalises nor corrects it.
  const field = p.placeholder('Add a site, or paste a list…');
  expect(await field.attr('autocorrect')).toBe('off');
  expect(await field.attr('autocapitalize')).toBe('off');
  expect(await field.attr('spellcheck')).toBe('false');
  await field.fill('*  *news*');
  await p.button('Add', { exact: true }).click();
  await p.text('Every website', { exact: true }).expectVisible();
  await p.text('*news*', { exact: true }).expectVisible();
  await p.text('This rule applies to every website.', { exact: false }).expectVisible();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Count only').click();
  await toSummary(p, { name: 'Everything' });
  await p.get('.plan-text').expectText('Every time you open any website');
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  const created = cfg.groups[cfg.groups.length - 1];
  expect(created.targets.map(({ type, value }: any) => ({ type, value }))).toEqual([
    { type: 'wildcard', value: '*' },
    { type: 'wildcard', value: '*news*' },
  ]);
  const editor = await h.page(`dashboard.html#/groups/${created.id}`);
  await editor.text('This rule applies to every website.', { exact: false }).expectVisible();
});

test('the address guide shows the five common forms and links to every address type (#11)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.text('How to write an address').click();
  await p.get('.guide-example').expectCount(5);
  for (const example of [
    'youtube.com',
    'example.com/page$',
    '*news*',
    '*',
    '+youtube.com/feed/subscriptions',
  ])
    await p.button(`Use the example ${example}`).expectVisible();
  await p.button('Use the example *news*').click();
  await p.placeholder('Add a site, or paste a list…').expectValue('*news*');
  // Every other address type is in Help, opened in a new tab at its address table.
  const link = p.role('link', /^Help \(opens in a new tab\)/);
  expect(await link.attr('href')).toBe('#/help/groups');
  const help = await h.newTab(() => link.click());
  await help.role('heading', 'Rules and sites', { exact: true }).expectVisible();
  await expect.poll(() => help.eval(() => document.activeElement?.textContent)).toBe('Rules and sites');
  await help.text('Any address that contains “news”.', { exact: false }).expectVisible();
  expect(
    await help.eval(() => {
      const r = document.getElementById('help-groups')!.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0;
    }),
  ).toBe(true);
  // The rule being created is still there.
  await p.placeholder('Add a site, or paste a list…').expectValue('*news*');
});

test('Help lists the keys the browser gave the shortcuts, and opens its shortcut settings', async ({ h }) => {
  const p = await h.page('dashboard.html#/help/shortcuts');
  const items = p.get('#help-shortcuts li');
  await items.expectCount(4);
  expect(await items.texts()).toEqual([
    'Alt+Shift+1 — open the popup',
    'Alt+Shift+2 — start a 25-minute focus session',
    'Alt+Shift+3 — block the current site',
    'No key — open the dashboard',
  ]);
  const settings = await h.newTab(() => p.button('Change shortcuts').click());
  await settings.expectUrl(h.browser === 'firefox' ? /^about:addons/ : 'chrome://extensions/shortcuts');
});

test('"count only" at certain times counts nothing outside them (#21)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.placeholder('Add a site, or paste a list…').fill('work.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.role('radio', /At certain times/).click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Count only').click();
  await p.button('Next: protection').click();
  await p.role('radio', /^Wait/).click();
  // A site never names the rule: it is shown next to its sites. A name is needed to go on.
  await p.button('Next: details').click();
  await p.label('Name', { exact: true }).expectValue('');
  await p.text('Give the rule a name.').expectVisible();
  await p.button('Next: summary').expectEnabled(false);
  await p.label('Name', { exact: true }).fill('Work');
  await p.button('Next: summary').click();
  await p.get('.plan-text').expectText('outside these times it counts nothing');
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  const created = cfg.groups[cfg.groups.length - 1];
  // One condition: the times when it counts.
  expect(created.policies.map((x: any) => [x.schedule.mode, x.intervention.type])).toEqual([
    ['during', 'track'],
  ]);
  // The editor states the same plan.
  const editor = await h.page(`dashboard.html#/groups/${created.id}`);
  await editor.get('.plan-text').expectText('outside these times it counts nothing');
});

test('the main settings of what happens are chosen with it (#14)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.placeholder('Add a site, or paste a list…').fill('feeds.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.text('From gentlest to strongest.').expectCount(0);
  // A filter: which one, and nothing more.
  await p.role('radio', 'Filter').click();
  await p.role('radio', 'Blur').click();
  // Five filters, all in view, and no "none".
  await p.get('[role="radiogroup"][aria-label="Filter"] [role="radio"]').expectCount(5);
  await p.text('Advanced options', { exact: true }).expectCount(0);
  await toSummary(p, { name: 'Feeds' });
  await p.get('.plan-text').expectText('makes the page less appealing (Blur)');
  await p.button(/^What happens/).click();
  // Ask first: the longest time and the shortest reason, and nothing more.
  await p.role('radio', 'Ask first').click();
  await p.label('Reason of at least').fill('20');
  await p.text('Advanced options', { exact: true }).expectCount(0);
  // A wait: how long, always the same, random or longer each time.
  await p.role('radio', 'Wait').click();
  await p.label('Wait', { exact: true }).fill('45');
  await p.role('radio', 'Random').click();
  await p.label('Longest wait').expectValue('90');
  await p.label('Longest wait').fill('30');
  await p.text('The longest wait must be longer than the shortest.').expectVisible();
  await p.button('Next: protection').expectEnabled(false);
  await p.role('radio', 'Longer each time').click();
  await p.text('45 s, then 55 s, then 1 min 5 s… Back to 45 s each day.').expectVisible();
  await p.role('radio', 'Fixed').click();
  await p.button('Next: protection').expectEnabled(true);
  // Everything else about a wait is in view too: no advanced options.
  await p.role('radiogroup', 'Once you’re through, open').expectVisible();
  await p.role('radiogroup', 'If you switch to another tab during the wait').expectVisible();
  await p.role('switch', 'Show the countdown').expectChecked(true);
  await p.role('switch', 'Open the page as soon as the wait is over').expectChecked(false);
  await p.text('Advanced options', { exact: true }).expectCount(0);
  // A challenge: which kind; a phrase must be written before going on.
  await p.role('radio', 'Challenge').click();
  await p.role('radiogroup', 'Once you’re through, open').expectVisible();
  await p.text('Advanced options', { exact: true }).expectCount(0);
  await p.role('radio', 'A phrase you choose').click();
  await p.button('Next: protection').expectEnabled(false);
  await p.label('Phrase to type').fill('I choose to spend this time on purpose');
  await p.button('Next: protection').expectEnabled(true);
  // Coming back to an intervention keeps what was set for it.
  await p.role('radio', 'Wait').click();
  await p.label('Wait', { exact: true }).expectValue('45');
  await toSummary(p);
  await p.get('.plan-text').expectText('makes you wait 45 seconds');
  await p.button(/^What happens/).click();
  await p.role('radio', 'Challenge').click();
  await p.label('Phrase to type').expectValue('I choose to spend this time on purpose');
  await toSummary(p);
  await p.get('.plan-text').expectText('type your phrase');
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[cfg.groups.length - 1].policies[0].intervention).toMatchObject({
    type: 'challenge',
    kind: 'phrase',
    phrase: 'I choose to spend this time on purpose',
  });
});

test('a new rule that blocks sets up its breaks (#15)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.placeholder('Add a site, or paste a list…').fill('withbreaks.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  // Breaks are asked with what happens, off until turned on.
  const breaks = p.role('switch', 'Allow breaks');
  await breaks.expectChecked(false);
  await p.text('How long can a break last?').expectCount(0);
  await breaks.click();
  // How long at most, what it takes to take one, how many; nothing more.
  await p.role('spinbutton', 'At most', { exact: true }).fill('20');
  await p.label('What must you do to take a break?').select('confirm');
  await p.role('spinbutton', 'At most this many breaks').fill('2');
  await p.text('Advanced options', { exact: true }).expectCount(0);
  await p.button('Next: protection').click();
  await p.role('radio', /^Reminder/).click();
  // The protection says nothing about breaks: they cost what was chosen.
  await p.text(/^Breaks cost/).expectCount(0);
  await named(p, 'Breaks');
  await p.text('Breaks: up to 20 min each. Cost: a confirmation.').expectVisible();
  await p.text('Reminder', { exact: true, within: '.summary-list' }).expectVisible();
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[cfg.groups.length - 1].pause).toEqual({
    allowed: true,
    maxMinutes: 20,
    limit: { count: 2, minutes: 30, period: { kind: 'day' } },
    cost: { type: 'confirm' },
  });
  const blocked = await expectBlocked(h, 'http://withbreaks.test/');
  await blocked.get('.break-offer').expectText('a confirmation');
  await blocked.get('.break-left').expectText('2 breaks left today, 30 min in total');
});

test('a new rule has no breaks once they are turned off (#15)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.placeholder('Add a site, or paste a list…').fill('nobreak.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  const breaks = p.role('switch', 'Allow breaks');
  await breaks.click();
  await p.button('Next: protection').click();
  await p.role('radio', /^Wait/).click();
  // Back in what happens, the breaks are as they were left, until they are turned off.
  await p.button(/^What happens/).click();
  await breaks.expectChecked(true);
  await p.label('What must you do to take a break?').expectValue('delay');
  await breaks.click();
  await breaks.expectChecked(false);
  await toSummary(p, { name: 'No breaks' });
  await p.text('No breaks.', { exact: true }).expectVisible();
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[cfg.groups.length - 1].pause.allowed).toBe(false);
  // The intervention page offers no break.
  const blocked = await expectBlocked(h, 'http://nobreak.test/');
  await blocked.button('Close the tab').expectVisible();
  await blocked.button(/Take a break/).expectCount(0);
});

test('the rule editor shows breaks in What happens only while the rule blocks', async ({ h }) => {
  await setup(h);
  const video = (await h.rpc('config.get')).config.groups.find((g: any) => g.name === 'Video');
  const p = await h.page(`dashboard.html#/groups/${video.id}?step=breaks`);
  // An old link to the Breaks part opens What happens; there is no Breaks part.
  await p.role('heading', PARTS['What happens']).expectVisible();
  await p.button(/^Breaks/, { within: '.editor-steps' }).expectCount(0);
  // The rule asks first: no breaks.
  const breaks = p.role('switch', 'Allow breaks');
  await breaks.expectCount(0);
  await openPart(p, 'Summary');
  await p.text(/No breaks|Breaks:/, { within: '.summary-list' }).expectCount(0);
  // Once it blocks, they are there, off until turned on.
  await openPart(p, 'What happens');
  await p.role('radio', 'Block').click();
  await p.role('heading', 'Breaks', { exact: true }).expectVisible();
  await breaks.expectChecked(false);
  await openPart(p, 'Summary');
  await p.text('No breaks.', { within: '.summary-list' }).expectVisible();
  await openPart(p, 'What happens');
  await breaks.click();
  await p.text('How long can a break last?').expectVisible();
  // Whether breaks are allowed during a focus session is up to the session.
  await p.role('switch', 'Also during focus sessions').expectCount(0);
  await p.text('What can a break cover?').expectCount(0);
  await p.text('Ask for a reason?').expectCount(0);
  await p.text('Count only time on the site').expectCount(0);
  await openPart(p, 'Summary');
  await p.text('Breaks: up to 30 min each, free.', { within: '.summary-list' }).expectVisible();
  // The protection says nothing about breaks.
  await openPart(p, 'Protection');
  await p.text(/^Loosening the rule makes you wait/).expectVisible();
  await p.text(/^Breaks cost/).expectCount(0);
});

test('only a new rule that blocks gets breaks (#15)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.placeholder('Add a site, or paste a list…').fill('counted.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  const breaks = p.role('switch', 'Allow breaks');
  // A break lifts a block only: the others have their own way in, or leave the page open or at once.
  for (const how of ['Count only', 'Filter', 'Ask first', 'Wait', 'Challenge', 'Redirect', 'Close tab']) {
    await p.role('radio', how).click();
    await breaks.expectCount(0);
  }
  await p.role('radio', 'Block').click();
  await breaks.expectVisible();
  await p.role('radio', 'Wait').click();
  await p.button('Next: protection').click();
  await p.role('radio', /^Reminder/).click();
  await p.text('Loosening the rule asks for a confirmation.').expectVisible();
  await named(p, 'Counted');
  // The summary does not mention breaks at all.
  await p.text('Reminder', { exact: true, within: '.summary-list' }).expectVisible();
  await p.text(/breaks? cost|no breaks/i).expectCount(0);
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[cfg.groups.length - 1].pause.allowed).toBe(false);
});

test('the daily time of a new rule can be any amount, not only the usual ones (#13)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.placeholder('Add a site, or paste a list…').fill('clips.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.role('radio', /^After some time/).click();
  await p.role('radio', '30 min').expectChecked();
  await p.role('radio', 'Other').click();
  await p.label('Time allowed').fill('75');
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  await toSummary(p, { name: 'Clips' });
  await p.get('.plan-text').expectText('After 1 h 15 min a day on clips.test');
  // Going back to the step keeps "Other" and the amount typed.
  await p.button(/^When/).click();
  await p.role('radio', 'Other').expectChecked();
  await p.label('Time allowed').expectValue('75');
  await p.button('Next: what happens').click();
  await toSummary(p);
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[cfg.groups.length - 1].policies[0].budget).toMatchObject({
    type: 'time',
    minutes: 75,
    period: { kind: 'day' },
  });
});

test('the time of a new rule can start again every so many hours or days', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.placeholder('Add a site, or paste a list…').fill('clips.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.role('radio', /^After some time/).click();
  await p.label('Starts again every', { exact: true }).expectValue('1');
  await p.label('Starts again every: unit').expectValue('days');
  await p.role('radio', 'Other').click();
  await p.label('Time allowed', { exact: true }).fill('120');
  // The unit keeps the number: 1 day becomes 1 hour, shorter than the time allowed.
  await p.label('Starts again every: unit').select('hours');
  await p.text('The time allowed must be shorter than the period, or it is never reached.').expectVisible();
  await p.button('Next: what happens').expectEnabled(false);
  await p.label('Starts again every', { exact: true }).fill('3');
  await p.label('Starts again every: unit').select('days');
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  await toSummary(p, { name: 'Clips' });
  await p.get('.plan-text').expectText('After 2 h every 3 days on clips.test');
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[cfg.groups.length - 1].policies[0].budget).toMatchObject({
    type: 'time',
    minutes: 120,
    period: { kind: 'days', n: 3 },
  });
});

test('in the editor a limit and its period are a number and a unit', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('Clips', ['clips.test'], [policy(delay(30), { budget: timeBudget(30) })], {
        protection: REMINDER,
      }),
    ];
  });
  const cfg = (await h.rpc('config.get')).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[0].id}?step=when`);
  await p.role('radio', /^After some time/).expectChecked();
  await p.role('radio', '30 min').expectChecked();
  await p.role('radio', 'Other').click();
  await p.label('Time allowed', { exact: true }).expectValue('30');
  await p.label('Time allowed: unit').select('hours');
  await p.label('Starts again every: unit').select('hours');
  await p.label('Starts again every', { exact: true }).fill('2');
  // 30 hours every 2 hours would never be reached.
  const never = p.text('The time allowed must be shorter than the period, or it is never reached.');
  await never.expectVisible();
  await p.button('Save changes').click();
  await p.text('Fix the problems listed to save.').expectVisible();
  await p.label('Starts again every: unit').select('days');
  await never.expectCount(0);
  await p.button('Save changes').click();
  await p.button('Yes, continue').click();
  await expect
    .poll(async () => (await h.rpc('config.get')).config.groups[0].policies[0].budget)
    .toMatchObject({ type: 'time', minutes: 30 * 60, period: { kind: 'days', n: 2 } });
});

test('a number is typed or stepped with the arrow keys, in one box with its unit', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Clips', ['clips.test'], [policy(BLOCK)], { protection: REMINDER, pause: pauseFree })];
  });
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const p = await h.page(`dashboard.html#/groups/${id}?step=how`);
  const most = p.role('spinbutton', 'At most', { exact: true });
  await most.expectValue('30');
  await most.press('ArrowUp');
  await most.expectValue('31');
  // The unit keeps the number; in hours a fraction can be typed, with a decimal comma too.
  await most.fill('2');
  await p.label('At most: unit').select('hours');
  await most.fill('1,5');
  // Not a number: the field says so, and leaving it gives back the last value.
  await most.fill('x');
  await expect.poll(() => most.attr('aria-invalid')).toBe('true');
  await most.press('Tab');
  await most.expectValue('1.5');
  // How often the limits of breaks start again: the usual periods, or any length.
  await p.role('checkbox', 'At most this many breaks').click();
  await p.role('radio', 'Week', { exact: true }).click();
  await p.role('radio', 'Other', { exact: true }).click();
  await p.label('Starts again every', { exact: true }).expectValue('7');
  await p.label('Starts again every: unit').expectValue('days');
  await p.button('Save changes').click();
  await p.button('Yes, continue').click();
  await expect
    .poll(async () => (await h.rpc('config.get')).config.groups[0].pause)
    .toMatchObject({ maxMinutes: 90, limit: { count: 3, period: { kind: 'days', n: 7 } } });
});

test("first run, welcome → the rule editor's parts → done", async ({ h }) => {
  const p = await h.page('dashboard.html#/welcome');
  await p.role('heading', 'Welcome to WebHandbrake').expectVisible();
  await p.button('Set up in about a minute').click();
  // The parts are the rule editor's, in order, after "Installed".
  await p.role('heading', 'Your first rule').expectVisible();
  await p.get('.wizard-progress li.done').expectText('Installed');
  await p.text('Step 1 of 6').expectVisible();
  await p.button('Next: when').expectEnabled(false);
  await p.button('Video', { exact: true }).click();
  await p.placeholder('Add a site, or paste a list…').fill('clips.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.role('radio', /^After some time/).click();
  await p.role('radio', '45 min').click();
  // The sites of the list share the time allowed unless each one gets its own.
  await p.text(/^45 min in total, shared by all the sites/).expectVisible();
  await p.button('Next: what happens').click();
  // Nothing is pre-selected: we do not know why the extension was installed.
  await p.get('.friction-option[aria-checked="true"]').expectCount(0);
  await p.button('Next: protection').expectEnabled(false);
  await p.role('radio', 'Block').click();
  await p.button('Next: protection').click();
  await p.role('radio', /^Reminder/).click();
  await p.button('Next: details').click();
  await p.label('Name', { exact: true }).expectValue('Video');
  await p.label('Why does this rule matter to you?').fill('More evenings outside');
  await p.button('Next: summary').click();
  await p.get('.plan-text').expectText('After 45 min a day in total on');
  await p.button('Create rule').click();
  await p.role('heading', 'You’re set').expectVisible();
  await p.text('“Video” is active.', { exact: false }).expectVisible();
  // Within its limit the site opens normally: no "Try it", which would show it open.
  await p.text(/opens normally. WebHandbrake steps in once your limit is used up/).expectVisible();
  await p.button('Try it').expectCount(0);
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups).toHaveLength(1);
  const video = cfg.groups[0];
  expect(video.name).toBe('Video');
  expect(video.targets.map((x: any) => x.value)).toContain('clips.test');
  expect(video.note).toBe('More evenings outside');
  expect(video.policies[0].budget).toMatchObject({ type: 'time', minutes: 45, period: { kind: 'day' } });
  expect(video.policies[0].intervention.type).toBe('block');
  // The protection chosen is the rule's protection (#12).
  expect(video.protection).toEqual(REMINDER);
  expect(cfg.settings.onboarded).toBe(true);
  // The draft is gone: the setup is over.
  expect(await p.eval(() => sessionStorage.getItem('whb-first-rule'))).toBeNull();
  // The plan is in force right away.
  await expectAllowed(h, 'http://clips.test/');
});

test('Back from the first step returns to the welcome and keeps the draft; the rule blocks at once', async ({
  h,
}) => {
  const p = await h.page('dashboard.html#/welcome');
  await p.button('Set up in about a minute').click();
  await p.placeholder('Add a site, or paste a list…').fill('casino.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Back').click();
  await p.role('heading', 'Welcome to WebHandbrake').expectVisible();
  await p.button('Set up in about a minute').click();
  await p.text('casino.test', { within: '.target-row' }).expectVisible();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  await p.button('Next: protection').click();
  // Nothing is pre-selected: the rule's protection is an active choice.
  await p.button('Next: details').expectEnabled(false);
  await p.get('.choice').expectCount(6);
  await p.role('radio', /^Wait/).click();
  // A short wait is not a firm protection; a long one blocks the browser's own pages too, and says so.
  const pages = p.text(/the browser’s extension pages are blocked too/);
  await pages.expectCount(0);
  await p.role('radio', '24 h').click();
  await pages.expectVisible();
  await p.button('Next: details').click();
  await p.label('Name', { exact: true }).fill('Casino');
  await p.button('Next: summary').click();
  await p.button('Create rule').click();
  await p.role('heading', 'You’re set').expectVisible();
  await p.button('Try it').expectVisible();
  await expectBlocked(h, 'http://casino.test/');
  expect((await h.rpc('config.get')).config.groups.map((g: any) => g.protection)).toEqual([wait(86_400)]);
});

test('When shows every setting of its answer, with no advanced options; Details folds its own away', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [
      group('Video', ['video.test', '+video.test/learn'], [policy(BLOCK)], { protection: REMINDER }),
    ];
  });
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const p = await h.page(`dashboard.html#/groups/${id}?step=when`);
  // When: the times, the time allowed or the visits, each with how often it starts again; a rule
  // has one condition.
  await p.role('radio', /^At certain times/).click();
  await p.role('radio', 'Outside these times').expectCount(0);
  await p.role('radio', /^After some time/).click();
  await p.label('Starts again every', { exact: true }).expectVisible();
  await p.text('What counts').expectCount(0);
  await p.role('radio', /^After some visits/).click();
  await p.label('How many visits?').fill('4');
  await p.label('Starts again every: unit').select('hours');
  await p.label('Starts again every', { exact: true }).fill('2');
  await p.text('Advanced options', { exact: true }).expectCount(0);
  await p.text('Add a condition:').expectCount(0);
  // What happens: the details of a wait, in view.
  await openPart(p, 'What happens');
  await p.role('radio', 'Wait').click();
  await p.text('Advanced options', { exact: true }).expectCount(0);
  await p.role('radio', 'The wait starts again').click();
  // Details: the windows the rule applies to.
  await openPart(p, 'Details');
  await p.role('radio', 'Only normal windows').expectHidden();
  await p.text('Advanced options', { exact: true }).click();
  await p.role('radio', 'Only normal windows').click();
  await openPart(p, 'Summary');
  await p.get('.plan-text').expectText('After 4 visits every 2 h to video.test');
  await p.button('Save changes').click();
  await p.button('Yes, continue').click();
  await p.text('Done: your change is applied.').expectVisible();
  const saved = (await h.rpc('config.get')).config.groups[0];
  expect(saved.policies).toHaveLength(1);
  expect(saved.policies[0].schedule).toEqual({ mode: 'always', windows: [] });
  expect(saved.policies[0].budget).toEqual({
    type: 'visits',
    count: 4,
    period: { kind: 'minutes', n: 120 },
    perSite: false,
  });
  expect(saved.policies[0].intervention).toMatchObject({ type: 'delay', onBlur: 'restart' });
  expect(saved.options.privacy).toBe('normal');
  // Opened again, each part shows what the rule uses.
  const again = await h.page(`dashboard.html#/groups/${id}?step=when`);
  await again.role('radio', /^After some visits/).expectChecked();
  await again.label('How many visits?').expectValue('4');
  await openPart(again, 'What happens');
  await again.role('radio', 'The wait starts again').expectChecked();
  await openPart(again, 'Details');
  await again.role('radio', 'Only normal windows').expectChecked();
});

test('exceptions stand out among the sites, which are edited as text and never repeated', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test', 'clips.test'], [policy(BLOCK)], { protection: REMINDER })];
  });
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const p = await h.page(`dashboard.html#/groups/${id}?step=sites`);
  // The sites have no advanced options: an exception is typed in the same box as a site.
  await p.text('Advanced options', { exact: true }).expectCount(0);
  const box = p.placeholder('Add a site, or paste a list…');
  await box.fill('+video.test/learn');
  await p.button('Add', { exact: true }).click();
  await p.get('.target-row.exception').expectCount(1);
  await p.text('Exception', { exact: true, within: '.target-row.exception' }).expectVisible();
  await p.text('2 sites, 1 exception').expectVisible();
  // An entry already in the list is not added again, and nothing is said about it.
  await box.fill('video.test');
  await p.button('Add', { exact: true }).click();
  await p.get('.target-row').expectCount(3);
  await p.button('Remove duplicates').expectCount(0);
  // An address changed into one already in the list merges into it.
  await p.button('Edit clips.test').click();
  await p.label('Address').fill('video.test');
  await p.label('Address').press('Enter');
  await p.label('Address').expectCount(0);
  await p.get('.target-row').expectCount(2);
  // The whole list as text, exceptions with +. Its changes can be discarded…
  const text = p.get('textarea.textarea');
  await p.button('Edit as text').click();
  await text.expectValue('video.test\n+video.test/learn');
  await text.fill('other.test');
  await p.button('Discard text changes').click();
  await p.get('.target-row').expectCount(2);
  // …or applied by going back to the list, where a repeated line is kept once.
  await p.button('Edit as text').click();
  await text.fill('video.test\n+video.test/learn\nstream.test\nstream.test');
  await p.button('Edit as list').click();
  await p.get('.target-row').expectCount(3);
  await p.button('Save changes').click();
  await p.button('Yes, continue').click();
  await p.text('Done: your change is applied.').expectVisible();
  const after = (await h.rpc('config.get')).config.groups[0].targets;
  expect(after.map((t: any) => `${t.allow ? '+' : ''}${t.value}`).sort()).toEqual([
    '+video.test/learn',
    'stream.test',
    'video.test',
  ]);
});

test('the editor normalises a pasted address and saves a renamed rule', async ({ h }) => {
  await setup(h);
  const cfg = (await h.rpc('config.get')).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[1].id}?step=details`);
  await p.label('Name', { exact: true }).fill('Videos');
  await openPart(p, 'Sites');
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

test('an address is corrected where it is shown', async ({ h }) => {
  await setup(h, REMINDER);
  const cfg = (await h.rpc('config.get')).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[1].id}?step=sites`);
  await p.button('Edit video.test').click();
  // The address itself turns into a field, in its row: no box with Save and Cancel.
  await p.label('Address').expectValue('video.test');
  await p.get('.target-row').expectCount(1);
  await p.button('Save', { exact: true }).expectCount(0);
  await p.label('Address').fill('two.test three.test');
  await p.label('Address').press('Enter');
  await p.text('Enter one address. To add more, use the box above.').expectVisible();
  // Escape puts the entry back as it was.
  await p.label('Address').press('Escape');
  await p.label('Address').expectCount(0);
  await p.text('Enter one address. To add more, use the box above.').expectCount(0);
  // A click on the address edits it too, and Enter applies it.
  await p.text('video.test', { within: '.target-row' }).click();
  await p.label('Address').fill('vide0.test');
  await p.label('Address').press('Enter');
  await p.label('Address').expectCount(0);
  await p.text('vide0.test', { within: '.target-row' }).expectVisible();
  await p.text('video.test', { within: '.target-row' }).expectCount(0);
  await p.button('Save changes').click();
  // The old address is removed (a loosening) and the new one added.
  await p.button('Yes, continue').click();
  await p.text('Done: your change is applied.').expectVisible();
  const after = (await h.rpc('config.get')).config.groups[1].targets;
  expect(after.map((t: any) => t.value)).toEqual(['vide0.test']);
  await expectBlocked(h, 'http://vide0.test/');
  await expectAllowed(h, 'http://video.test/');
});

test('the bin of an address being edited removes the entry', async ({ h }) => {
  await setup(h, REMINDER);
  const cfg = (await h.rpc('config.get')).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[0].id}?step=sites`);
  await p.button('Edit chat.test').click();
  await p.label('Address').fill('chat2.test');
  // Leaving the field applies the address first; the row stays the same, so the click lands.
  await p.button('Remove chat.test').click();
  await p.get('.target-row').expectCount(1);
  await p.text('social.test', { within: '.target-row' }).expectVisible();
});

test('the rule editor follows changes made elsewhere while nothing is edited', async ({ h }) => {
  await setup(h);
  const cfg = (await h.rpc('config.get')).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[1].id}?step=sites`);
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

test('the rule list turns rules on and off, duplicates, archives and searches', async ({ h }) => {
  await setup(h, REMINDER);
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

test('a list of sites pasted into a rule becomes one entry per line', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Weekdays', ['weekday.test'], [policy(BLOCK)])];
  });
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const p = await h.page(`dashboard.html#/groups/${id}?step=sites`);
  // A list is pasted: the field becomes a text area with every line.
  await p.placeholder('Add a site, or paste a list…').paste('one.test\ntwo.test');
  await p.get('textarea.textarea').expectValue('one.test\ntwo.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Save changes').click();
  await expect
    .poll(async () => (await h.rpc('config.get')).config.groups[0].targets.map((t: any) => t.value))
    .toEqual(['weekday.test', 'one.test', 'two.test']);
  await expectBlocked(h, 'http://two.test/');
});

test('the theme applies to every page of the extension', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Block', ['blocked.test'], [policy(BLOCK)])];
  });
  const p = await h.page('dashboard.html#/settings/general');
  await p.role('radio', 'Dark').click();
  await expect.poll(() => p.eval(() => document.documentElement.dataset.theme)).toBe('dark');
  await p.role('switch', 'High contrast').click();
  await expect.poll(() => p.eval(() => document.documentElement.dataset.contrast)).toBe('high');
  // The accent is the brand colour, not a setting (#22).
  await p.get('input[type="color"]').expectCount(0);
  const blocked = await expectBlocked(h, 'http://blocked.test/');
  await blocked.role('heading', /blocked/).expectVisible();
  expect(await blocked.eval(() => document.documentElement.dataset.theme)).toBe('dark');
  const popup = await h.popup(blocked);
  await popup.get('.popup-head').expectVisible();
  expect(await popup.eval(() => document.documentElement.dataset.theme)).toBe('dark');
});

test('insights show the time per rule and site, and the impulses resisted', async ({ h }) => {
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
  // The days split by site, with a legend.
  await insights.role('radio', 'By site').click();
  await insights.get({ css: '.legend li', text: 'video.test' }).expectVisible();
  await insights.get('.bars .stacked').expectVisible();
  // The time of a column: on a click or a tap, and from the keyboard, with each site.
  const tip = () => insights.eval(() => document.querySelector('.chart-tip')?.textContent ?? null);
  await insights.get('.bars').click();
  await insights.get('.chart-tip').expectVisible();
  await insights.press('Escape');
  await insights.get('.chart-tip').expectHidden();
  await insights.press('Home');
  for (let i = 0; i < (new Date().getDay() + 6) % 7; i++) await insights.press('ArrowRight');
  await expect.poll(tip).toMatch(/^\d.*video\.test/);
  // A day hour by hour.
  await insights.role('radio', 'Day').click();
  await insights.text('Hour by hour', { exact: true }).expectVisible();
  await insights.role('img', 'Time on limited sites per hour').expectVisible();
  expect(await insights.get('.bars .col').count()).toBe(24);
  const today = await h.page('dashboard.html#/today');
  await today.text('Video', { within: 'main' }).expectVisible();
});

test('insights by site add up to the total, and fit a phone screen', async ({ h, browserName }) => {
  const long = 'www.averyveryverylonghostnamewithouthyphens.test';
  await h.configure((c) => {
    c.groups = [group('Reading', [long, 'news.test'], [policy(TRACK)])];
  });
  // Both tabs stay open: a headless browser may count the first one with the second.
  for (const url of [`http://${long}/`, 'http://news.test/']) {
    const p = await expectAllowed(h, url);
    await useUntil(p, async () => false, 2500);
  }
  await h.rpc('test.flush');
  const insights = await h.page('dashboard.html#/insights');
  /** The time of today's column, as its tip shows it. */
  const todayColumn = async () => {
    await insights.get('.bars').click();
    await insights.press('Home');
    for (let i = 0; i < (new Date().getDay() + 6) % 7; i++) await insights.press('ArrowRight');
    const time = await insights.eval(() => document.querySelector('.chart-tip strong')?.textContent ?? '');
    await insights.press('Escape');
    return time;
  };
  const total = await todayColumn();
  expect(total).toMatch(/^\d/);
  await insights.role('radio', 'By site').click();
  await insights.get('.bars .stacked').expectVisible();
  expect(await todayColumn()).toBe(total);
  for (const width of [390, 360]) {
    await insights.viewport(width, 900);
    // Firefox keeps a minimum window width: the narrowest it allows.
    if (browserName === 'chromium') expect(await insights.eval(() => window.innerWidth)).toBe(width);
    await insights.text(long.slice(4), { within: 'main' }).expectVisible();
    expect(await insights.overflowX(), `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    // The time of a column, with the names of its sites, stays over the chart.
    await insights.get('.bars').click();
    await insights.get('.chart-tip').expectVisible();
    expect(await insights.overflowX(), `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    await insights.press('Escape');
  }
});
