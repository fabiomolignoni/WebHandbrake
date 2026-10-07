/**
 * Accessibility in real browsers (A11Y-01…A11Y-05): axe-core WCAG 2.2 AA checks on every page and
 * interactive state, in the light and dark themes, and keyboard use.
 */

import { expect, type Tab, test } from './harness';
import { BLOCK, challenge, delay, group, policy } from './harness/config';
import { expectBlocked } from './helpers';

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

for (const theme of ['light', 'dark']) {
  test(`A11Y-01: WCAG 2.2 AA on every dashboard page and state (${theme})`, async ({ h }) => {
    await h.configure((c) => {
      c.settings.theme = theme;
      c.groups = [group('Social', ['social.test'], [policy(BLOCK)])];
    });
    const id = (await h.rpc('config.get')).config.groups[0].id;
    const p = await h.page('dashboard.html#/today');
    const all: string[] = [];
    for (const route of [...ROUTES, `groups/${id}`]) {
      await go(p, route);
      all.push(...(await p.axe()).map((v) => `${route}: ${v}`));
    }
    // A condition open with the friction picker.
    await p.get('.policy-sentence').click();
    await p.role('radiogroup', 'What happens').expectVisible();
    all.push(...(await p.axe()).map((v) => `rule editor: ${v}`));
    // An open menu.
    await go(p, 'groups');
    await p.button('More actions for Social').click();
    await p.role('menu').expectVisible();
    all.push(...(await p.axe()).map((v) => `rule menu: ${v}`));
    await p.press('Escape');
    // Every step of the rule wizard.
    await go(p, 'groups/new?template=social');
    for (const step of ['when', 'what happens', 'review']) {
      if (step === 'review') await p.role('radio', 'Ask first').click();
      await p.button(`Next: ${step}`).click();
      all.push(...(await p.axe()).map((v) => `wizard ${step}: ${v}`));
    }
    // Every screen of the first run.
    await p.eval(() => {
      sessionStorage.clear();
      location.hash = '#/welcome';
    });
    await p.button('Set up in about a minute').click();
    for (const [i, screen] of ['goal', 'sites', 'details', 'plan'].entries()) {
      if (screen === 'sites') await p.role('radio', /Stop opening sites out of habit/).click();
      if (screen === 'details') await p.button(/^Social media/).click();
      if (screen === 'plan') await p.role('radio', 'Wait').click();
      if (i > 0) await p.button(/^Next:/).click();
      all.push(...(await p.axe()).map((v) => `first run ${screen}: ${v}`));
    }
    expect(all).toEqual([]);
  });
}

test('A11Y-01: the popup and the intervention pages pass WCAG checks', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('Wait', ['wait.test'], [policy(delay(30))]),
      group('Type', ['type.test'], [policy(challenge({ length: 12 }))]),
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

test('A11Y-02: the dashboard works with the keyboard (skip link, radio groups, dialogs)', async ({ h }) => {
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

test('A11Y-02/03: the intervention page takes the focus and announces the countdown at a moderate pace', async ({
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
