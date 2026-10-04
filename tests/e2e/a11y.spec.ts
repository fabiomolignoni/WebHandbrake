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
  expect([...summary(r1.violations), ...summary(r2.violations)]).toEqual([]);
});
