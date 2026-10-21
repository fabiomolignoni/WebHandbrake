/**
 * The dashboard in a real browser: every page, the rule
 * wizard, the first run, the rule editor, the rule list, settings and insights.
 */

import { timeStep, totp } from '../../src/background/totp';
import { expect, type Harness, type Tab, test } from './harness';
import {
  ask,
  BLOCK,
  delay,
  during,
  group,
  policy,
  REMINDER,
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

/** From "What happens" to the review of the wizard, through the protection step (#12). */
async function toReview(p: Tab, protection = 'Wait') {
  await p.button('Next: protection').click();
  const radio = p.role('radio', new RegExp(`^${protection}`));
  if (!(await radio.checked())) await radio.click();
  await p.button('Next: review').click();
}

/** The parts of the rule editor and the heading of each. */
const PARTS = {
  Overview: 'This rule at a glance',
  Sites: 'Which sites?',
  When: 'When should it apply?',
  'What happens': 'What should happen?',
  Protection: 'What should loosening this rule take?',
  Breaks: 'Can you take a break from this rule?',
  Details: 'Name, reason and block page',
};

async function setup(h: Harness, protection: unknown = wait(30)) {
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
      // The parts of the rule as the wizard's steps: every part opens. A break lifts a block only,
      // so a rule that never blocks has no Breaks part.
      const blocks = g.policies.some((x: any) => x.intervention.type === 'block');
      for (const [part, title] of Object.entries(PARTS)) {
        if (part === 'Breaks' && !blocks) {
          await p.button(/^Breaks/, { within: '.editor-steps' }).expectCount(0);
          continue;
        }
        await openPart(p, part);
        await p.role('heading', title).expectVisible();
        expect(await p.overflowX(), `horizontal overflow on ${part}`).toBeLessThanOrEqual(0);
      }
      // Conditions open in place: when they apply in When, the friction picker in What happens; a
      // single one is open already.
      await openPart(p, 'When');
      if ((await p.get('.policy-sentence').attr('aria-expanded')) !== 'true')
        await p.get('.policy-sentence').click();
      await p.role('radiogroup', 'When').expectVisible();
      expect(await p.overflowX()).toBeLessThanOrEqual(0);
      await openPart(p, 'What happens');
      if ((await p.get('.policy-sentence').attr('aria-expanded')) !== 'true')
        await p.get('.policy-sentence').click();
      await p.role('radiogroup', 'What happens').expectVisible();
      expect(await p.overflowX()).toBeLessThanOrEqual(0);
    }
  });
}

test('a rule is created step by step: sites → when → what happens → protection → review', async ({ h }) => {
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
  await p.button('Next: review').expectEnabled(false);
  await p.role('radio', /^Wait/).click();
  await p.role('radio', '1 h').click();
  await p.text(/becomes a pending change, which you can confirm 1 h later/).expectVisible();
  await p.button('Next: review').click();
  // The review states the plan: when (the schedule) and what happens.
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
  // Breaks are off until turned on; their cost follows the protection: a typed code for a long wait.
  expect(created.pause.allowed).toBe(false);
  expect(created.pause.cost.type).toBe('challenge');
});

/** A new rule through the wizard, up to its protection step. */
async function toProtection(h: Harness, name: string, site: string): Promise<Tab> {
  const p = await h.page('dashboard.html#/groups/new');
  await p.role('heading', 'Which sites?').expectVisible();
  await p.label('Name', { exact: true }).fill(name);
  await p.placeholder('Add a site, or paste a list…').fill(site);
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  await p.button('Next: protection').click();
  return p;
}

/** The wizard's state for the session, as stored. */
const wizardState = async (p: Tab) => (await p.eval(() => sessionStorage.getItem('whb-new-rule'))) ?? '';

test("the wizard's Password protection is hashed in the background and never kept for the session", async ({
  h,
}) => {
  const p = await toProtection(h, 'Gambling', 'bet.test');
  await p.role('radio', /^Password/).click();
  await p.label('New password').type('only my sister knows');
  await p.label('Repeat the password').type('only my sister knows');
  await p.button('Save', { exact: true, within: 'dialog' }).click();
  await p.text(/The password is set/).expectVisible();
  expect(await p.role('radio', /^Password/).checked()).toBe(true);
  // The wizard keeps its state for the session, but never the password hash.
  expect(await wizardState(p)).toContain('Gambling');
  expect(await wizardState(p)).not.toContain('pbkdf2');
  await p.button('Next: review').click();
  await p.text(/Loosening this rule later takes: Password/).expectVisible();
  // Resumed without the password (here after a reload), the wizard asks for the protection again
  // instead of creating the rule with the default one.
  await p.reload();
  await p.role('heading', 'What should loosening this rule take?').expectVisible();
  await p.get('.choice[aria-checked="true"]').expectCount(0);
  await p.button('Next: review').expectEnabled(false);
  await p.role('radio', /^Password/).click();
  await p.label('New password').type('only my sister knows');
  await p.label('Repeat the password').type('only my sister knows');
  await p.button('Save', { exact: true, within: 'dialog' }).click();
  await p.button('Next: review').click();
  await p.text(/Loosening this rule later takes: Password/).expectVisible();
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const created = (await h.rpc('config.get')).config.groups.find((g: any) => g.name === 'Gambling');
  expect(created.protection.kind).toBe('password');
  expect(created.protection.hash).toMatch(/^pbkdf2-sha256\$/);
  expect(JSON.stringify(created)).not.toContain('only my sister knows');
  // Its breaks cost the password, and loosening it asks for it.
  expect(created.pause.cost).toEqual({ type: 'password' });
  const cfg = (await h.rpc('config.get')).config;
  cfg.groups.find((g: any) => g.id === created.id).targets = [];
  const r = await h.rpc('config.save', { config: cfg });
  expect(r.ticket.step).toEqual({ type: 'rulePassword', names: ['Gambling'] });
  await h.rpc('ticket.cancel', { id: r.ticket.id });
});

test("the wizard's Partner code protection is set up with a code from the partner's app", async ({ h }) => {
  const p = await toProtection(h, 'Casino', 'casino.test');
  await p.role('radio', /^Partner code/).click();
  await p.role('heading', 'Set up a partner code for Casino').expectVisible();
  const secret = (await p.get('.partner-key').text()).replace(/\s/g, '');
  await p.label('Code from your partner’s app').fill('000000');
  await p.button('Confirm', { exact: true, within: 'dialog' }).click();
  await p.text(/not the code that your partner’s app shows/).expectVisible();
  await p.label('Code from your partner’s app').fill(await totp(secret, timeStep(await h.clock.now())));
  await p.button('Confirm', { exact: true, within: 'dialog' }).click();
  await p.text('Your partner’s app shows the codes for this rule.').expectVisible();
  expect(await wizardState(p)).not.toContain(secret);
  await p.button('Next: review').click();
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

test('the wizard takes wildcards and every website, and the editor warns (#20, #23)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.role('heading', 'Which sites?').expectVisible();
  await p.label('Name', { exact: true }).fill('Everything');
  await p.placeholder('Add a site, or paste a list…').fill('*  *news*');
  await p.button('Add', { exact: true }).click();
  await p.text('Every website', { exact: true }).expectVisible();
  await p.text('*news*', { exact: true }).expectVisible();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Count only').click();
  await toReview(p);
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
  const link = p.role('link', /Help, under Rules and sites/);
  expect(await link.attr('href')).toBe('#/help/groups');
  const help = await h.newTab(() => link.click());
  await help.role('heading', 'Rules and sites', { exact: true }).expectVisible();
  await expect.poll(() => help.eval(() => document.activeElement?.textContent)).toBe('Rules and sites');
  await help
    .text('Without a site name, * matches any characters in the whole address', {
      exact: false,
    })
    .expectVisible();
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
  await toReview(p);
  await p.get('.plan-text').expectText('outside these times it counts nothing');
  // A site never names the rule: it is shown next to its sites.
  await p.get('.plan-name').expectText('Unnamed rule');
  await p.text('Give the rule a name.').expectVisible();
  await p.button('Create rule').expectEnabled(false);
  await p.label('Name', { exact: true }).fill('Work');
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  const created = cfg.groups[cfg.groups.length - 1];
  expect(created.policies.map((x: any) => [x.schedule.mode, x.intervention.type])).toEqual([
    ['during', 'track'],
    ['always', 'allow'],
  ]);
  // The editor shows the second condition, and no "otherwise" after it.
  const editor = await h.page(`dashboard.html#/groups/${created.id}`);
  await editor.text('Allowed, time not counted', { within: '.plan' }).expectVisible();
  await editor
    .text(
      'When no condition applies, the sites open normally: WebHandbrake only keeps track of the time spent on them.',
    )
    .expectCount(0);
  await openPart(editor, 'When');
  await editor.text('Allowed, time not counted', { within: '.policy' }).expectVisible();
  await editor.get('.policy.otherwise').expectCount(0);
  await openPart(editor, 'What happens');
  await editor.get('.policy.otherwise').expectCount(0);
});

test('the main settings of what happens are chosen in the wizard (#14)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.label('Name', { exact: true }).fill('Feeds');
  await p.placeholder('Add a site, or paste a list…').fill('feeds.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  // A filter: which one.
  await p.role('radio', 'Filter').click();
  await p.get('select[aria-label="Filter"]').select('blur');
  await toReview(p);
  await p.get('.plan-text').expectText('applies a filter (Blur)');
  await p.button(/^What happens/).click();
  // A wait: how long.
  await p.role('radio', 'Wait').click();
  await p.label('Wait', { exact: true }).fill('45');
  // A challenge: which kind; a phrase must be written before going on.
  await p.role('radio', 'Challenge').click();
  await p.get('select[aria-label="Challenge"]').select('phrase');
  await p.button('Next: protection').expectEnabled(false);
  await p.label('Phrase to type').fill('I choose to spend this time on purpose');
  await p.button('Next: protection').expectEnabled(true);
  // Coming back to an intervention keeps what was set for it.
  await p.role('radio', 'Wait').click();
  await p.label('Wait', { exact: true }).expectValue('45');
  await toReview(p);
  await p.get('.plan-text').expectText('makes you wait 45 seconds');
  await p.button(/^What happens/).click();
  await p.role('radio', 'Challenge').click();
  await p.label('Phrase to type').expectValue('I choose to spend this time on purpose');
  await toReview(p);
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

test('the wizard decides whether a new rule allows breaks (#15)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.label('Name', { exact: true }).fill('No breaks');
  await p.placeholder('Add a site, or paste a list…').fill('nobreak.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  // Breaks are asked with what happens, off as in the full editor; their cost comes from the
  // protection, chosen next.
  const breaks = p.role('switch', 'Allow breaks');
  await breaks.expectChecked(false);
  await breaks.click();
  await p.text(/depends on the protection you choose next/).expectVisible();
  await p.button('Next: protection').click();
  await p.role('radio', /^Wait/).click();
  // Back in what happens, breaks cost what the protection says until they are turned off.
  await p.button(/^What happens/).click();
  await breaks.expectChecked(true);
  await p.text(/A break costs: a 30 s wait/).expectVisible();
  await breaks.click();
  await breaks.expectChecked(false);
  await p.button('Next: protection').click();
  await p.button('Next: review').click();
  await p.text(/^No breaks\./).expectVisible();
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[cfg.groups.length - 1].pause.allowed).toBe(false);
  // The intervention page offers no break.
  const blocked = await expectBlocked(h, 'http://nobreak.test/');
  await blocked.button('Close the tab').expectVisible();
  await blocked.button(/Take a break/).expectCount(0);
});

test('the rule editor has a Breaks part only while one of the conditions blocks', async ({ h }) => {
  await setup(h);
  const video = (await h.rpc('config.get')).config.groups.find((g: any) => g.name === 'Video');
  const p = await h.page(`dashboard.html#/groups/${video.id}`);
  const part = p.button(/^Breaks/, { within: '.editor-steps' });
  // The rule asks first: no Breaks part, no breaks in its overview or its protection.
  await p.role('heading', PARTS.Overview).expectVisible();
  await part.expectCount(0);
  await p.text('Breaks', { exact: true, within: '.summary-list' }).expectCount(0);
  await openPart(p, 'Protection');
  await p.text(/^Loosening the rule makes you wait/).expectVisible();
  await p.text(/^Breaks cost/).expectCount(0);
  // Once it blocks, the part is there.
  await openPart(p, 'What happens');
  await p.role('radio', 'Block').click();
  await part.expectVisible();
  await openPart(p, 'Breaks');
  await p.role('heading', PARTS.Breaks).expectVisible();
  // The protection says what breaks take once they are allowed.
  await openPart(p, 'Protection');
  await p.text(/^Breaks cost/).expectCount(0);
  await openPart(p, 'Breaks');
  await p.role('switch', 'Breaks allowed').click();
  await openPart(p, 'Protection');
  await p.text(/^Breaks cost/).expectVisible();
});

test('only a rule that blocks gets breaks from the wizard (#15)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.label('Name', { exact: true }).fill('Counted');
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
  // Nor does the protection say what breaks would take.
  await p.button('Next: protection').click();
  await p.role('radio', /^Reminder/).click();
  await p.text('Loosening the rule asks for a confirmation.').expectVisible();
  await p.text('Breaks cost a confirmation.').expectCount(0);
  await p.button('Next: review').click();
  // The review does not mention breaks at all.
  await p.text(/^Loosening this rule later takes: Reminder\./).expectVisible();
  await p.text(/breaks? cost/i).expectCount(0);
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[cfg.groups.length - 1].pause.allowed).toBe(false);
});

test('the daily time of a new rule can be any amount, not only the usual ones (#13)', async ({ h }) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.label('Name', { exact: true }).fill('Clips');
  await p.placeholder('Add a site, or paste a list…').fill('clips.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.role('radio', /^After some time/).click();
  await p.role('radio', '30 min').expectChecked();
  await p.role('radio', 'Other').click();
  await p.label('Time allowed').fill('75');
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  await toReview(p);
  await p.get('.plan-text').expectText('After 1 h 15 min a day on clips.test');
  // Going back to the step keeps "Other" and the amount typed.
  await p.button(/^When/).click();
  await p.role('radio', 'Other').expectChecked();
  await p.label('Time allowed').expectValue('75');
  await p.button('Next: what happens').click();
  await toReview(p);
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
  await p.label('Name', { exact: true }).fill('Clips');
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
  await toReview(p);
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
  await setup(h, REMINDER);
  const cfg = (await h.rpc('config.get')).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[0].id}?step=when`);
  await p.get({ css: '.policy-sentence', nth: 1 }).click();
  await p.label('Time allowed', { exact: true }).expectValue('30');
  await p.label('Time allowed: unit').select('hours');
  await p.label('Period').select('every');
  await p.label('Every', { exact: true }).expectValue('2');
  await p.label('Every: unit').expectValue('hours');
  // 30 hours every 2 hours would never be reached.
  await p.text('This limit is as long as its period or longer, so it is never reached.').expectVisible();
  await p.label('Every: unit').select('days');
  await p.text('This limit is as long as its period or longer, so it is never reached.').expectCount(0);
  await p.button('Save changes').click();
  await p.button('Yes, continue').click();
  await expect
    .poll(async () => (await h.rpc('config.get')).config.groups[0].policies[1].budget)
    .toMatchObject({ type: 'time', minutes: 30 * 60, period: { kind: 'days', n: 2 } });
});

test("first run, welcome → the rule wizard's steps → done", async ({ h }) => {
  const p = await h.page('dashboard.html#/welcome');
  await p.role('heading', 'Welcome to WebHandbrake').expectVisible();
  await p.button('Set up in about a minute').click();
  // The steps are the rule wizard's, after "Installed".
  await p.role('heading', 'Your first rule').expectVisible();
  await p.get('.wizard-progress li.done').expectText('Installed');
  await p.text('Step 1 of 5').expectVisible();
  await p.button('Next: when').expectEnabled(false);
  await p.button('Video', { exact: true }).click();
  await p.placeholder('Add a site, or paste a list…').fill('clips.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.role('radio', /^After some time/).click();
  await p.role('radio', '45 min').click();
  // The sites of the list share the time allowed unless each one gets its own.
  await p.text(/^The sites share the time allowed: 45 min in total/).expectVisible();
  await p.button('Next: what happens').click();
  // Nothing is pre-selected: we do not know why the extension was installed.
  await p.get('.choice[aria-checked="true"]').expectCount(0);
  await p.button('Next: protection').expectEnabled(false);
  await p.role('radio', 'Block').click();
  await toReview(p, 'Reminder');
  await p.get('.plan-text').expectText('After 45 min a day in total on');
  await p.label('Why does this rule matter to you?').fill('More evenings outside');
  await p.button('Create rule').click();
  await p.role('heading', 'You’re set').expectVisible();
  await p.text('“Video” is active.', { exact: false }).expectVisible();
  // Within its limit the site opens normally: no "Try it", which would show it open.
  await p
    .text(/opens normally: WebHandbrake steps in once the time or the visits allowed are used up/)
    .expectVisible();
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
  await p.label('Name', { exact: true }).fill('Casino');
  await p.placeholder('Add a site, or paste a list…').fill('casino.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Back').click();
  await p.role('heading', 'Welcome to WebHandbrake').expectVisible();
  await p.button('Set up in about a minute').click();
  await p.label('Name', { exact: true }).expectValue('Casino');
  await p.text('casino.test', { within: '.target-row' }).expectVisible();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  await p.button('Next: protection').click();
  // Nothing is pre-selected: the rule's protection is an active choice.
  await p.button('Next: review').expectEnabled(false);
  await p.get('.choice').expectCount(6);
  await p.role('radio', /^Wait/).click();
  // A short wait is not a firm protection; a long one blocks the browser's own pages too, and says so.
  const pages = p.text(/the browser’s extension and settings pages are blocked too/);
  await pages.expectCount(0);
  await p.role('radio', '24 h').click();
  await pages.expectVisible();
  await p.button('Next: review').click();
  await p.button('Create rule').click();
  await p.role('heading', 'You’re set').expectVisible();
  await p.button('Try it').expectVisible();
  await expectBlocked(h, 'http://casino.test/');
  expect((await h.rpc('config.get')).config.groups.map((g: any) => g.protection)).toEqual([wait(86_400)]);
});

test('the wizard hands its draft to the full editor', async ({ h }) => {
  await setup(h);
  const p = await h.page('dashboard.html#/groups/new?template=video');
  await p.get('.target-row .value').expectVisible();
  await p.button('Use the full editor').click();
  await p.role('heading', 'This rule at a glance').expectVisible();
  await p.get('.plan-name').expectText('Video');
  await openPart(p, 'Sites');
  expect(await p.get({ css: '.target-row' }).count()).toBeGreaterThan(0);
  await openPart(p, 'Details');
  await p.label('Name', { exact: true }).expectValue('Video');
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

test('the pencil corrects an address and its note in place', async ({ h }) => {
  await setup(h, REMINDER);
  const cfg = (await h.rpc('config.get')).config;
  const p = await h.page(`dashboard.html#/groups/${cfg.groups[1].id}?step=sites`);
  await p.button('Edit video.test').click();
  await p.label('Address').expectValue('video.test');
  await p.label('Address').fill('two.test three.test');
  await p.button('Save', { exact: true }).click();
  await p.text('Enter one address. To add more, use the box above.').expectVisible();
  await p.label('Address').fill('vide0.test');
  await p.label('Note (optional)').fill('typo fixed');
  await p.button('Save', { exact: true }).click();
  await p.text('vide0.test', { within: '.target-row' }).expectVisible();
  await p.text('typo fixed').expectVisible();
  await p.text('video.test', { within: '.target-row' }).expectCount(0);
  await p.button('Save changes').click();
  // The old address is removed (a loosening) and the new one added, not a note change.
  await p.button('Yes, continue').click();
  await p.text('Done: your change is applied.').expectVisible();
  const after = (await h.rpc('config.get')).config.groups[1].targets;
  expect(after.map((t: any) => [t.value, t.note])).toEqual([['vide0.test', 'typo fixed']]);
  await expectBlocked(h, 'http://vide0.test/');
  await expectAllowed(h, 'http://video.test/');
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
  // A day hour by hour.
  await insights.role('radio', 'Day').click();
  await insights.text('Hour by hour', { exact: true }).expectVisible();
  await insights.role('img', 'Time on limited sites per hour').expectVisible();
  expect(await insights.get('.bars .col').count()).toBe(24);
  const today = await h.page('dashboard.html#/today');
  await today.text('Video', { within: 'main' }).expectVisible();
});
