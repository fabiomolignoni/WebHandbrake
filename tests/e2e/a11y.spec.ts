/**
 * Accessibility in real browsers: axe-core WCAG 2.2 AA checks on every page and
 * interactive state, in the light and dark themes, keyboard use and focus. The accessible
 * alternative to the typed challenge is in interventions.spec.ts.
 */

import { expect, type Harness, type Tab, test } from './harness';
import { ask, BLOCK, challenge, delay, group, policy } from './harness/config';
import { expectBlocked, openPart } from './helpers';

/** Goes to a dashboard route and waits for it to render. */
async function go(p: Tab, route: string) {
  await p.eval(async (r: string) => {
    if (location.hash !== `#/${r}`) {
      const changed = new Promise((done) => addEventListener('hashchange', done, { once: true }));
      location.hash = `#/${r}`;
      await changed;
    }
    for (let i = 0; i < 2; i++) await new Promise((done) => requestAnimationFrame(done));
  }, route);
  await p.get('#main h1, #main .page-head').waitFor('visible');
}

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

/** WCAG checks of a page in the light theme, then of its colours in the dark one. */
async function check(p: Tab, what: string): Promise<string[]> {
  return [
    ...(await p.axe()).map((v) => `${what}: ${v}`),
    ...(await p.axeDark()).map((v) => `${what}, dark: ${v}`),
  ];
}

async function dashboard(h: Harness, route: string) {
  await h.configure((c) => {
    c.settings.theme = 'light';
    c.groups = [group('Social', ['social.test'], [policy(BLOCK)])];
  });
  const id = (await h.rpc('config.get')).config.groups[0].id as string;
  return { p: await h.page(`dashboard.html#/${route}`), id };
}

test('WCAG 2.2 AA on every dashboard page, in the light and the dark theme', async ({ h }) => {
  const { p, id } = await dashboard(h, 'today');
  const all: string[] = [];
  for (const route of [...ROUTES, `groups/${id}`]) {
    await go(p, route);
    all.push(...(await check(p, route)));
  }
  // An open menu.
  await go(p, 'groups');
  await p.button('More actions for Social').click();
  await p.role('menu').expectVisible();
  all.push(...(await check(p, 'rule menu')));
  expect(all).toEqual([]);
});

/** Opens every "Advanced options" of the page, so that their settings are checked too. */
async function openAdvanced(p: Tab) {
  await p.eval(() => {
    for (const d of Array.from(document.querySelectorAll('details.advanced')))
      (d as HTMLDetailsElement).open = true;
  });
}

test('WCAG 2.2 AA in every part of the rule editor, for a new rule and in the first run, in both themes', async ({
  h,
}) => {
  const { p, id } = await dashboard(h, 'today');
  const all: string[] = [];
  // Every part of a rule, with its advanced options open.
  await go(p, `groups/${id}`);
  for (const part of ['Sites', 'When', 'What happens', 'Protection', 'Details']) {
    await openPart(p, part);
    // What happens with its breaks allowed, so that their settings are shown.
    if (part === 'What happens') {
      await p.role('radiogroup', 'What happens').expectVisible();
      await p.role('switch', 'Allow breaks').expectChecked(true);
    }
    await openAdvanced(p);
    all.push(...(await check(p, `rule editor, ${part}`)));
  }
  // Every part of a new rule, in order.
  await go(p, 'groups/new?template=social');
  for (const step of ['when', 'what happens', 'protection', 'details', 'summary']) {
    if (step === 'protection') {
      // What happens with breaks, whose settings show under Block.
      await p.role('radio', 'Block').click();
      await p.role('switch', 'Allow breaks').click();
      await openAdvanced(p);
      all.push(...(await check(p, 'new rule what happens, breaks')));
      await p.role('radio', 'Ask first').click();
    }
    if (step === 'details') {
      await p.role('radio', /^Wait/).click();
      // A wait of any other length.
      await p.role('radio', 'Other').click();
      all.push(...(await check(p, 'new rule protection, another wait')));
    }
    await p.button(`Next: ${step}`).click();
    await openAdvanced(p);
    all.push(...(await check(p, `new rule ${step}`)));
    // When, with the settings of each answer.
    if (step === 'when') {
      for (const answer of [/^At certain times/, /^After some time/, /^After some visits/]) {
        await p.role('radio', answer).click();
        all.push(...(await check(p, `new rule when, ${answer.source}`)));
      }
      await p.role('radio', /^Every time/).click();
    }
  }
  // Every screen of the first run.
  await p.eval(() => {
    sessionStorage.clear();
    location.hash = '#/welcome';
  });
  await p.button('Set up in about a minute').click();
  all.push(...(await check(p, 'first run sites')));
  await p.button(/^Social media/).click();
  for (const step of ['when', 'what happens', 'protection', 'details', 'summary']) {
    if (step === 'protection') await p.role('radio', 'Ask first').click();
    if (step === 'details') await p.role('radio', /^Wait/).click();
    await p.button(`Next: ${step}`).click();
    all.push(...(await check(p, `first run ${step}`)));
  }
  expect(all).toEqual([]);
});

test('the popup and the intervention pages pass WCAG checks', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('Wait', ['wait.test'], [policy(delay(30))]),
      group('Type', ['type.test'], [policy(challenge({ length: 12 }))]),
      group('Ask', ['ask.test'], [policy(ask({ maxMinutes: 30 }))]),
    ];
  });
  const all: string[] = [];
  const wait = await expectBlocked(h, 'http://wait.test/');
  await wait.role('heading', 'Take a breath.').expectVisible();
  all.push(...(await wait.axe()).map((v) => `delay: ${v}`));
  await wait.button('Why?').click();
  all.push(...(await wait.axe()).map((v) => `delay why: ${v}`));
  const type = await expectBlocked(h, 'http://type.test/');
  await type.get('canvas.challenge-canvas').expectVisible();
  all.push(...(await type.axe()).map((v) => `challenge: ${v}`));
  // The question with its error and the typed duration.
  const askPage = await expectBlocked(h, 'http://ask.test/');
  await askPage.button('Continue for 5 min').click(15_000);
  await askPage.role('radio', 'Other').click();
  await askPage.label('How long?', { exact: true }).expectVisible();
  all.push(...(await askPage.axe()).map((v) => `ask: ${v}`));
  const popup = await h.popup(wait);
  await popup.get('.popup-head').expectVisible();
  all.push(...(await popup.axe()).map((v) => `popup: ${v}`));
  const site = await h.open('http://other.test/');
  const popup2 = await h.popup(site);
  await popup2.button('Block site').click();
  all.push(...(await popup2.axe()).map((v) => `popup add: ${v}`));
  expect(all).toEqual([]);
  // The checker itself reports what it should (no false pass).
  await popup2.eval(() => {
    const img = document.createElement('img');
    img.src = 'icons/icon-32.png';
    document.body.appendChild(img);
  });
  expect(await popup2.axe()).toContainEqual(expect.stringMatching(/^image-alt/));
});

test('the dashboard works with the keyboard (skip link, radio groups, dialogs)', async ({ h }) => {
  const p = await h.page('dashboard.html#/focus');
  await p.get('h1').waitFor('visible');
  // The first Tab reaches the skip link.
  await p.press('Tab');
  expect(await p.eval(() => document.activeElement?.textContent)).toBe('Skip to content');
  // Radio groups move with the arrow keys (roving tab index).
  await p.role('radio', '25 min').press('ArrowRight');
  await p.role('radio', '50 min').expectChecked();
  expect(await p.eval(() => document.activeElement?.textContent)).toBe('50 min');
  // A dialog traps the focus and Escape closes it.
  await p.role('radio', /Everything except a few sites/).click();
  await p.button('Start focus session').click();
  await p.role('dialog', 'Before you start').expectVisible();
  expect(await p.eval(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
  await p.press('Escape');
  await p.role('dialog', 'Before you start').expectCount(0);
});

test('the intervention page takes the focus and announces the countdown at a moderate pace', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Wait', ['wait.test'], [policy(delay(30))])];
  });
  const p = await expectBlocked(h, 'http://wait.test/');
  await p.role('heading', 'Take a breath.').expectVisible();
  // The focus is on the title, so a screen reader starts from it.
  await expect.poll(() => p.eval(() => document.activeElement?.tagName)).toBe('H1');
  // The live region counts down in steps of ten seconds, not every second.
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    seen.add(await p.eval(() => document.querySelector('.breathe ~ [role=status]')?.textContent ?? ''));
    await new Promise((r) => setTimeout(r, 250));
  }
  expect([...seen].every((s) => /^You can continue in (30|20) s\.$/.test(s))).toBe(true);
  // Tab moves through the actions, each with a visible focus indicator.
  await p.press('Tab');
  const outline = await p.eval(() => {
    const el = document.activeElement as HTMLElement;
    const style = getComputedStyle(el);
    return { tag: el.tagName, outline: style.outlineStyle !== 'none' || style.boxShadow !== 'none' };
  });
  expect(outline).toEqual({ tag: 'BUTTON', outline: true });
});
