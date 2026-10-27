/**
 * Private windows in Chrome, where the extension runs a second background of its own that relays
 * to the main one (src/background/bridge.ts): the intervention page opens there, its ways in work,
 * and the rules, the state and the time are the same as in the other windows.
 */

import { expect, test } from './harness';
import { BLOCK, delay, group, pauseFree, policy, timeBudget } from './harness/config';
import { expectAllowed, expectBlocked, useUntil } from './helpers';

test.skip(({ browserName }) => browserName !== 'chromium', 'Chrome only: Firefox has one background');

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('the intervention page opens in a private window, where the popup, a wait and a break work', async ({
  h,
}) => {
  await h.allowPrivateWindows();
  await h.configure((c) => {
    c.groups = [
      group('Wait', ['wait.test'], [policy(delay(2))]),
      group('News', ['news.test'], [policy(BLOCK)], {
        pause: { ...pauseFree, cost: { type: 'confirm' }, maxMinutes: 10 },
      }),
    ];
  });
  // Normal windows are unchanged.
  const normal = await expectBlocked(h, 'http://news.test/front');
  await normal.close();

  // The page is replaced by the intervention page (not Chrome's error page), without a request.
  const p = await h.openPrivate('http://news.test/story');
  await p.expectIntervention();
  await p.get('main.intervention:not([aria-busy])').waitFor('attached');
  await p.role('heading', 'This page is blocked right now.').expectVisible();
  expect(h.server.hits('news.test').filter((r) => r.path === '/story')).toEqual([]);

  // The popup of the private window is about its active tab, which only the private background sees.
  const popup = await h.newTab(() =>
    p.eval((url: string) => chrome.tabs.create({ url, active: false }), `${h.origin}/popup.html`),
  );
  await popup.get('.hero').expectText('news.test');
  await popup.get('.hero').expectText('private');
  await popup.text('Blocked', { exact: true, within: '.hero' }).expectVisible();
  await popup.close();

  // A break taken there, with its cost, is the break of every window.
  await p.button('Take a break').click();
  await p.button('Start the break').click();
  await p.button('Yes, continue').click();
  await p.expectReal('news.test/story');
  expect((await h.rpc('overview.get')).pauses).toHaveLength(1);
  // Ending it from the dashboard restricts the private tab again at once.
  await h.rpc('pause.cancel', { all: true });
  await p.expectIntervention(true, 5000);

  // A wait.
  const proceeded = async () => (await h.rpc('stats.get', { from: today(), to: today() })).counters.proceeded;
  const before = await proceeded();
  const w = await h.openPrivate('http://wait.test/a');
  await w.expectIntervention();
  const cont = w.button('Continue', { exact: true });
  await cont.expectEnabled(false);
  await cont.expectEnabled(true, 6000);
  await cont.click();
  await w.expectReal('wait.test/a');
  expect(await proceeded()).toBe(before + 1);
});

test('a short link to another site of the rule waits once in a private window too', async ({ h }) => {
  await h.allowPrivateWindows();
  await h.configure((c) => {
    c.groups = [group('Wait', ['short.test', 'video.test'], [policy(delay(1))])];
  });
  h.server.route('short.test', { status: 301, headers: { location: 'http://video.test/watch?v=abc' } });
  const p = await h.openPrivate('http://short.test/abc');
  await p.expectIntervention();
  await p.button('Continue', { exact: true }).click(6000);
  await p.expectReal('video.test/watch?v=abc');
});

test('time in a private window uses up the limit, and the page is replaced when it runs out', async ({
  h,
}) => {
  await h.allowPrivateWindows();
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(0.1) })])];
  });
  const p = await h.openPrivate('http://video.test/watch');
  await p.expectReal('video.test/watch');
  await useUntil(p, () => p.isIntervention(), 20_000);
  await p.expectIntervention(true, 3000);
  // The same limit in a normal window.
  await expectBlocked(h, 'http://video.test/other');
  // Private windows keep no sites in the statistics, only the time.
  const stats = await h.rpc('stats.get', { from: today(), to: today() });
  expect(stats.groups.find((g: any) => g.name === 'Video')?.seconds).toBeGreaterThanOrEqual(5);
  await expectAllowed(h, 'http://elsewhere.test/');
});

test('the two backgrounds wake each other up when the browser has stopped them', async ({ h }) => {
  await h.allowPrivateWindows();
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)], { pause: pauseFree })];
  });
  const p = await h.openPrivate('http://news.test/story');
  await p.expectIntervention();
  await p.get('main.intervention:not([aria-busy])').waitFor('attached');
  // The private page asks the main background, through the private one.
  expect(await h.stopBackground()).toBe(true);
  await p.button('Take a break').click();
  await p.button('Start the break').click();
  await p.expectReal('news.test/story');
  // The main background acts on the private tab, through the private background.
  expect(await h.stopBackground()).toBe(true);
  await h.rpc('pause.cancel', { all: true });
  await p.expectIntervention(true, 5000);
});
