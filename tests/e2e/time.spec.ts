/**
 * Time accounting and limits in a real browser: the content script reports active
 * time, the background credits it, budgets run out and the restriction applies at once.
 */

import { expect, type Harness, type Tab, test } from './harness';
import { BLOCK, group, pauseFree, policy, TRACK, timeBudget, visitBudget } from './harness/config';
import { expectAllowed, expectBlocked, sleep, useUntil } from './helpers';

/** Seconds counted today on the sites of every rule ("on limited sites today"). */
async function counted(h: Harness): Promise<number> {
  await h.rpc('test.flush');
  return (await h.rpc('overview.get')).today.seconds;
}

/** Seconds counted today for one rule. */
async function groupSeconds(h: Harness, name: string): Promise<number> {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const stats = await h.rpc('stats.get', { from: day, to: day });
  return stats.groups.find((g: any) => g.name === name)?.seconds ?? 0;
}

async function use(tab: Tab, ms: number) {
  await useUntil(tab, async () => false, ms);
}

test('active time is counted and an exhausted budget applies within seconds', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(0.1) })])];
  });
  // Counting starts as soon as the page loads: the time is measured from before it opens.
  const t0 = Date.now();
  const p = await expectAllowed(h, 'http://video.test/watch');
  await useUntil(p, () => p.isIntervention(), 20_000);
  await p.expectIntervention(true, 3000);
  const elapsed = Date.now() - t0;
  expect(elapsed).toBeGreaterThan(4500);
  expect(elapsed).toBeLessThan(15_000);
  expect(await counted(h)).toBeGreaterThanOrEqual(5);
  // The badge and the popup say why.
  const why = await h.rpc('explain', { url: 'http://video.test/other' });
  expect(why.primary.policies[0].budget.exhausted).toBe(true);
});

test('a tab in the background is not counted', async ({ h, browserName }) => {
  test.skip(
    browserName === 'chromium',
    'Headless Chromium reports every tab as visible and focused (not the extension: Firefox checks it)',
  );
  await h.configure((c) => {
    c.groups = [group('Social', ['social.test'], [policy(TRACK)])];
  });
  const p = await expectAllowed(h, 'http://social.test/');
  await use(p, 3000);
  const before = await groupSeconds(h, 'Social');
  const other = await expectAllowed(h, 'http://other.test/');
  await use(other, 5000);
  expect(await groupSeconds(h, 'Social')).toBeLessThan(before + 2);
});

test('no time is counted while the user is idle on the page', async ({ h }) => {
  await h.configure((c) => {
    c.settings.tracking.idleSeconds = 15;
    c.groups = [group('Social', ['social.test'], [policy(TRACK)])];
  });
  const p = await expectAllowed(h, 'http://social.test/');
  await use(p, 3000);
  const active = await groupSeconds(h, 'Social');
  expect(active).toBeGreaterThan(1);
  // No input on the page for longer than the idle time: counting stops.
  await p.front();
  await sleep(20_000);
  const idle = await groupSeconds(h, 'Social');
  expect(idle - active).toBeLessThan(17);
  expect(idle - active).toBeGreaterThan(8);
});

test('time on an exception is not counted for the rule', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test', '+news.test/work'], [policy(TRACK)])];
  });
  const p = await expectAllowed(h, 'http://news.test/work/report');
  await use(p, 4000);
  expect(await groupSeconds(h, 'News')).toBe(0);
});

test('visits per day; a new visit starts after the visit gap', async ({ h }) => {
  await h.configure((c) => {
    c.settings.tracking.visitGapMinutes = 1;
    c.groups = [group('Mail', ['mail.test'], [policy(BLOCK, { budget: visitBudget(2) })])];
  });
  const visit = async () => {
    const p = await expectAllowed(h, 'http://mail.test/inbox');
    await use(p, 2500);
    await p.close();
    await h.rpc('test.flush');
    await h.clock.advance(2 * 60_000);
  };
  await visit();
  await visit();
  const why = await h.rpc('explain', { url: 'http://mail.test/' });
  expect(why.primary.policies[0].budget.used).toBe(2);
  await expectBlocked(h, 'http://mail.test/inbox');
});

test('"Stop now" in the popup gives up the rest of the budget at once', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(30) })])];
  });
  const site = await expectAllowed(h, 'http://video.test/');
  const popup = await h.popup(site);
  await popup.button('Stop now').click();
  await popup.text('Give up the time left on Video for this period?').expectVisible();
  await popup.button('Yes, stop now').click();
  await site.expectIntervention(true, 5000);
  await expectBlocked(h, 'http://video.test/later');
});

test('the badge shows the time left on the current site', async ({ h }) => {
  await h.configure((c) => {
    c.settings.badge.thresholdMinutes = 60;
    c.groups = [group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(30) })])];
  });
  const p = await expectAllowed(h, 'http://video.test/');
  await use(p, 2500);
  const id = await p.id();
  await expect
    .poll(() => h.control.eval((tabId: number) => chrome.action.getBadgeText({ tabId }), id))
    .toBe('30m');
  const title = await h.control.eval((tabId: number) => chrome.action.getTitle({ tabId }), id);
  expect(title).toContain('Video');
});

test('the timer appears near the limit, names the rule, and can be hidden for the visit', async ({ h }) => {
  await h.configure((c) => {
    c.settings.timer.thresholdMinutes = 5;
    c.groups = [group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(2) })])];
  });
  const p = await expectAllowed(h, 'http://video.test/');
  await use(p, 2500);
  const chip = p.get({ role: 'timer', within: 'webhandbrake-overlay' });
  await chip.expectVisible();
  await chip.expectText('left · Video');
  expect(await chip.text()).toMatch(/1:5\d/);
  // Accessible name with the rule and the time.
  expect(await chip.attr('aria-label')).toMatch(/^Video: 1:5\d left$/);
  await p.button('Hide for this visit', { within: 'webhandbrake-overlay' }).click();
  await chip.expectHidden();
});

test('a warning comes before the restriction', async ({ h }) => {
  await h.configure((c) => {
    c.settings.warningSeconds = 60;
    c.groups = [group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(0.5) })])];
  });
  const p = await expectAllowed(h, 'http://video.test/');
  await use(p, 2000);
  await p.text(/Video will be restricted in \d+ s\./, { within: 'webhandbrake-overlay' }).expectVisible();
});

test('typing in a page gives a grace period with a countdown and a copy button', async ({ h }) => {
  await h.configure((c) => {
    c.settings.interventions.graceSeconds = 4;
    c.groups = [group('Forum', ['forum.test'], [policy(BLOCK)], { pause: pauseFree })];
  });
  const start = await h.rpc('pause.start', { url: 'http://forum.test/', minutes: 10 });
  if (start.ticket) await h.completeTicket(start.ticket);
  const p = await expectAllowed(h, 'http://forum.test/thread');
  await p.label('Comment').type('a long comment I do not want to lose');
  await sleep(300);
  const t0 = Date.now();
  await h.rpc('pause.cancel', { all: true });
  const dialog = p.get({ role: 'alertdialog', within: 'webhandbrake-overlay' });
  await dialog.expectVisible();
  await dialog.expectText('Time is up for this site. Finish or copy what you are writing.');
  await dialog.expectText(/The page will be replaced in [1-4] s\./);
  await p.button('Copy my draft', { within: 'webhandbrake-overlay' }).expectVisible();
  expect(await p.isIntervention()).toBe(false);
  await p.expectIntervention(true, 12_000);
  expect(Date.now() - t0).toBeGreaterThan(3500);
});
