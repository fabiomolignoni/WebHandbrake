import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { group, policy } from './fixtures';
import { type Harness, launch } from './harness';

let h: Harness;
test.beforeEach(async () => {
  h = await launch();
});
test.afterEach(async () => {
  await h.close();
});

const ROUTES = [
  'today',
  'groups',
  'groups/new',
  'focus',
  'later',
  'insights',
  'protection',
  'settings/general',
  'settings/data',
  'help',
  'welcome',
];

function summary(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
}

for (const theme of ['light', 'dark']) {
  test(`A11Y-01: WCAG 2.2 AA checks pass on the dashboard (${theme})`, async () => {
    await h.configure((c) => {
      c.settings.theme = theme;
      c.groups = [group('Social', ['social.test'], [policy({ type: 'block' })])];
    });
    const cfg = ((await h.rpc('config.get')) as any).config;
    const p = await h.page('dashboard.html#/today');
    const all: string[] = [];
    for (const route of [...ROUTES, `groups/${cfg.groups[0].id}`]) {
      await p.evaluate((r) => {
        location.hash = `#/${r}`;
      }, route);
      await p.waitForTimeout(500);
      const r = await new AxeBuilder({ page: p })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      all.push(...summary(r.violations).map((s) => `${route}: ${s}`));
    }
    // Interactive states of the redesign: a rule open with the friction picker, an open menu.
    await p.locator('.policy-sentence').first().click();
    await p.waitForTimeout(200);
    const rule = await new AxeBuilder({ page: p })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    all.push(...summary(rule.violations).map((s) => `rule editor: ${s}`));
    await p.evaluate(() => {
      location.hash = '#/groups';
    });
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /More actions for Social/ }).click();
    const menu = await new AxeBuilder({ page: p })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    all.push(...summary(menu.violations).map((s) => `group menu: ${s}`));
    await p.keyboard.press('Escape');
    // Every step of the creation wizard.
    await p.evaluate(() => {
      location.hash = '#/groups/new?template=social';
    });
    for (const step of ['when', 'what happens', 'review']) {
      if (step === 'review') await p.getByRole('radio', { name: 'Ask first' }).click();
      await p.getByRole('button', { name: `Next: ${step}` }).click();
      await p.waitForTimeout(200);
      const r = await new AxeBuilder({ page: p })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      all.push(...summary(r.violations).map((s) => `wizard ${step}: ${s}`));
    }
    // Every screen of the first run.
    await p.evaluate(() => {
      sessionStorage.clear();
      location.hash = '#/welcome';
    });
    await p.getByRole('button', { name: 'Set up in about a minute' }).click();
    const screens = ['goal', 'sites', 'details', 'plan'];
    for (const [i, screen] of screens.entries()) {
      if (screen === 'sites') await p.getByRole('radio', { name: /Stop opening sites out of habit/ }).click();
      if (screen === 'details') await p.getByRole('button', { name: /^Social media/ }).click();
      if (screen === 'plan') await p.getByRole('radio', { name: 'Wait' }).click();
      if (i > 0) await p.getByRole('button', { name: /^Next:/ }).click();
      await p.waitForTimeout(200);
      const r = await new AxeBuilder({ page: p })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      all.push(...summary(r.violations).map((s) => `first run ${screen}: ${s}`));
    }
    expect(all).toEqual([]);
  });
}

test('A11Y-01: popup and intervention page pass WCAG checks', async () => {
  await h.configure((c) => {
    c.groups = [
      group(
        'Social',
        ['social.test'],
        [policy({ type: 'delay', seconds: 30, grant: { scope: 'site', mode: 'visit' } })],
      ),
    ];
  });
  const iv = await h.open('http://social.test/');
  const r1 = await new AxeBuilder({ page: iv }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  const popup = await h.page('popup.html');
  await popup.waitForTimeout(500);
  const r2 = await new AxeBuilder({ page: popup }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  // The popup of a web page, with the "Block this site" panel open.
  const site = await h.open('http://other.test/');
  await popup.evaluate(async () => {
    const [tab] = (await chrome.tabs.query({})).filter((x) => x.url?.includes('other.test'));
    if (tab?.id) await chrome.tabs.update(tab.id, { active: true });
  });
  await popup.reload();
  await popup.getByRole('button', { name: 'Block site' }).click();
  const r3 = await new AxeBuilder({ page: popup }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  await site.close();
  expect([...summary(r1.violations), ...summary(r2.violations), ...summary(r3.violations)]).toEqual([]);
});
