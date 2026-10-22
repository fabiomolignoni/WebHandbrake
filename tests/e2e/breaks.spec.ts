/**
 * Breaks in a real browser: what they cover, durations, costs verified in the background,
 * budgets, expiry with immediate re-application, from the block page and the popup.
 */

import { expect, type Harness, test } from './harness';
import { BLOCK, delay, group, pauseFree, policy, REMINDER, TRACK, timeBudget } from './harness/config';
import { expectAllowed, expectBlocked, sleep } from './helpers';

const pause = (more: Record<string, unknown> = {}) => ({ ...pauseFree, ...more });

async function startBreak(h: Harness, args: Record<string, unknown>, extra: { password?: string } = {}) {
  const r = await h.rpc('pause.start', args);
  if (r.error) return r;
  if (r.ticket) await h.completeTicket(r.ticket, extra);
  return r;
}

test('a break unblocks; ending it re-blocks the open tabs at once', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)], { pause: pause() })];
  });
  const p = await expectBlocked(h, 'http://news.test/article');
  await startBreak(h, { url: 'http://news.test/article', minutes: 5 });
  // The intervention page notices and offers to reopen.
  await p.button('Reopen the page').click();
  await p.expectReal('news.test/article');
  expect((await h.rpc('overview.get')).pauses).toHaveLength(1);
  const t0 = Date.now();
  await h.rpc('pause.cancel', { all: true });
  await p.expectIntervention(true, 5000);
  expect(Date.now() - t0).toBeLessThan(3000);
  await p.expectUrl('#http://news.test/article');
});

test('a break ends by itself and the page is restricted again', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)], { pause: pause() })];
  });
  await startBreak(h, { url: 'http://news.test/', minutes: 1 });
  const p = await expectAllowed(h, 'http://news.test/');
  await h.clock.advance(61_000);
  await p.expectIntervention(true, 5000);
});

test('a break opens every site of the rule, and only of that rule', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test', 'paper.test'], [policy(BLOCK)], { pause: pause() }),
      group('Games', ['games.test'], [policy(BLOCK)], { pause: pause() }),
    ];
  });
  await startBreak(h, { url: 'http://news.test/a', minutes: 5 });
  await expectAllowed(h, 'http://news.test/a');
  await expectAllowed(h, 'http://www.news.test/b');
  await expectAllowed(h, 'http://paper.test/');
  await expectBlocked(h, 'http://games.test/');
});

test('breaks in progress on Today fit their card at 1280 and 360 px (regression)', async ({
  h,
  browserName,
}) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK)], { pause: pause() }),
      group(
        'Social media, chats, forums and every other place where time disappears',
        ['a-very-long-subdomain.social-network.test'],
        [policy(BLOCK)],
        { pause: pause() },
      ),
      group('Games', ['games.test'], [policy(BLOCK)], { pause: pause() }),
    ];
  });
  await startBreak(h, { url: 'http://news.test/', minutes: 5 });
  await startBreak(h, { url: 'http://a-very-long-subdomain.social-network.test/a/long/path', minutes: 5 });
  await startBreak(h, { url: 'http://games.test/', minutes: 10 });
  expect((await h.rpc('overview.get')).pauses).toHaveLength(3);
  const today = await h.page('dashboard.html#/today');
  for (const width of [1280, 360]) {
    await today.viewport(width, 900);
    // Firefox keeps a minimum window width: the narrowest it allows.
    if (browserName === 'chromium') expect(await today.eval(() => window.innerWidth)).toBe(width);
    await today.get('#pauses-title').waitFor('visible');
    // Every "End the break" button stays inside the card, and the page never scrolls sideways.
    const outside = await today.eval(() => {
      const card = document.querySelector('[aria-labelledby="pauses-title"]')!.getBoundingClientRect();
      return [...document.querySelectorAll('[aria-labelledby="pauses-title"] button')].map((b) => {
        const r = b.getBoundingClientRect();
        return Math.max(0, card.left - r.left, r.right - card.right);
      });
    });
    expect(outside, `buttons outside the card at ${width}px`).toEqual([0, 0, 0]);
    expect(await today.overflowX(), `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
});

test('a break from the block page, with its cost, returns to the page', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK)], {
        pause: pause({ cost: { type: 'confirm' }, maxMinutes: 10 }),
      }),
    ];
  });
  const p = await expectBlocked(h, 'http://news.test/story');
  await p.get('.break-offer').expectText('a confirmation');
  await p.button('Take a break').click();
  // It lasts the longest a break can, unless ended sooner: no length and no reason are asked.
  await p.text('Opens all the sites of News for 10 min. You can end it sooner.').expectVisible();
  await p.get({ role: 'textbox', within: 'dialog' }).expectCount(0);
  await p.get({ role: 'spinbutton', within: 'dialog' }).expectCount(0);
  await p.button('Start the break').click();
  await p.text('Do you want to go ahead?').expectVisible();
  await p.button('Yes, continue').click();
  await p.expectReal('news.test/story');
  const g = (await h.rpc('overview.get')).pauses[0];
  expect(Math.round((g.until - (await h.clock.now())) / 60_000)).toBe(10);
});

test('a break that costs a wait cannot be taken before the wait is over', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK)], {
        pause: pause({ cost: { type: 'delay', seconds: 3 } }),
      }),
    ];
  });
  const r = await h.rpc('pause.start', { url: 'http://news.test/', minutes: 5 });
  expect(r.ticket.step.type).toBe('wait');
  expect(await h.rpc('ticket.answer', { id: r.ticket.id, answer: '' })).toMatchObject({
    status: 'error',
    error: 'ticket.error.notYet',
  });
  // Once the wait is over the answer is taken (asked again until then: an early answer costs nothing).
  await sleep(3000);
  await expect
    .poll(async () => (await h.rpc('ticket.answer', { id: r.ticket.id, answer: '' })).status, {
      timeout: 5000,
    })
    .toBe('done');
  await expectAllowed(h, 'http://news.test/');
});

test("a break that costs the rule's password", async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK)], {
        protection: REMINDER,
        pause: pause({ cost: { type: 'password' } }),
      }),
    ];
  });
  // Without the Password protection, the rule's break costs a long code instead.
  const code = await h.rpc('pause.start', { url: 'http://news.test/', minutes: 5 });
  expect(code.ticket.step).toMatchObject({ type: 'text', length: 32 });
  await h.rpc('ticket.cancel', { id: code.ticket.id });
  const { hash } = await h.rpc('password.hash', { password: 'correct horse' });
  // From a reminder to a password is stricter: it applies at once.
  const set = await h.configure((c) => (c.groups[0].protection = { kind: 'password', hash }));
  expect(set.ticket).toBeNull();
  expect((await h.rpc('config.get')).config.groups[0].protection.hash).toMatch(/^pbkdf2-sha256\$/);
  const r = await h.rpc('pause.start', { url: 'http://news.test/', minutes: 5 });
  expect(r.ticket.step).toEqual({ type: 'rulePassword', names: ['News'] });
  expect(await h.rpc('ticket.answer', { id: r.ticket.id, answer: 'wrong' })).toMatchObject({
    status: 'error',
    error: 'ticket.error.wrongPassword',
  });
  expect((await h.rpc('ticket.answer', { id: r.ticket.id, answer: 'correct horse' })).status).toBe('done');
  await expectAllowed(h, 'http://news.test/');
});

test('a break ended sooner re-blocks the rule and counts only the minutes used', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)], { pause: pause({ maxMinutes: 20 }) })];
  });
  const p = await expectBlocked(h, 'http://news.test/');
  await p.button('Take a break').click();
  await p.button('Start the break').click();
  await p.expectReal('news.test/');
  await h.clock.advance(3 * 60_000);
  const today = await h.page('dashboard.html#/today');
  await today.button('End the break').click();
  await p.expectIntervention(true, 5000);
  const d = new Date(await h.clock.now());
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const stats = await h.rpc('stats.get', { from: day, to: day });
  expect(stats.pauses[0]).toMatchObject({ minutes: 20, used: 3 });
  expect(stats.pauses[0].reason).toBeUndefined();
  expect(stats.counters.pauses).toBe(1);
});

test('breaks are limited per rule and overall', async ({ h }) => {
  await h.configure((c) => {
    c.settings.pauseLimit = { count: 2, period: { kind: 'day' } };
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK)], {
        pause: pause({ limit: { count: 1, period: { kind: 'day' } } }),
      }),
      group('Games', ['games.test'], [policy(BLOCK)], { pause: pause() }),
    ];
  });
  // With the button: what a break costs and what is left, from the lowest limit, with its period.
  const before = await expectBlocked(h, 'http://news.test/');
  await before.get('.break-cost').expectText('No cost');
  await before.get('.break-left').expectText('1 break left today');
  await startBreak(h, { url: 'http://news.test/', minutes: 1 });
  await h.rpc('pause.cancel', { all: true });
  const again = await h.rpc('pause.options', { url: 'http://news.test/' });
  expect(again).toMatchObject({ available: false, reason: 'pause.unavailable.noneLeft' });
  const p = await expectBlocked(h, 'http://news.test/');
  await p.text('No breaks left for this period.').expectVisible();
  await startBreak(h, { url: 'http://games.test/', minutes: 1 });
  await h.rpc('pause.cancel', { all: true });
  // The global limit (2 a day) is reached too.
  expect(await h.rpc('pause.options', { url: 'http://games.test/' })).toMatchObject({ available: false });
  // The next day, breaks are available again.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  await h.clock.set(tomorrow);
  expect((await h.rpc('pause.options', { url: 'http://news.test/' })).available).toBe(true);
});

test('no breaks during a focus session that forbids them', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK, { budget: timeBudget(30) })], { pause: pause() }),
    ];
  });
  await h.rpc('session.start', {
    kind: 'groups',
    groups: [],
    allow: [],
    minutes: 30,
    locked: false,
    noPauses: true,
  });
  expect(await h.rpc('pause.options', { url: 'http://news.test/' })).toMatchObject({
    available: false,
    reason: 'pause.unavailable.session',
  });
  const p = await expectBlocked(h, 'http://news.test/');
  await p.role('heading', /focus session/).expectVisible();
  await p.button('Take a break').expectCount(0);
});

test('the popup offers a break only where a rule blocks the page', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('Read', ['read.test'], [policy(TRACK)], { pause: pause() }),
      group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(30) })], { pause: pause() }),
      group('Wait', ['wait.test'], [policy(delay(30))], { pause: pause() }),
      group('News', ['news.test'], [policy(BLOCK)], { pause: pause() }),
    ];
  });
  // Only counted, or within its limit: a break would change nothing.
  for (const [host, name] of [
    ['read.test', 'Read'],
    ['video.test', 'Video'],
  ]) {
    const popup = await h.popup(await expectAllowed(h, `http://${host}/`));
    await popup.text(name, { exact: true, within: '.hero' }).expectVisible();
    await popup.button(/Take a break/).expectCount(0);
  }
  // A wait has its own way in: neither its page nor the popup offers a break.
  const wait = await expectBlocked(h, 'http://wait.test/');
  await wait.button('Continue').expectVisible();
  await wait.button(/Take a break/).expectCount(0);
  await (await h.popup(wait)).button(/Take a break/).expectCount(0);
  const news = await expectBlocked(h, 'http://news.test/');
  await (await h.popup(news)).button(/Take a break/).expectVisible();
});

test('a break is visible in the popup, which can end it', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)], { pause: pause({ cost: { type: 'none' } }) })];
  });
  const site = await expectBlocked(h, 'http://news.test/');
  const popup = await h.popup(site);
  await popup.button(/Take a break/).click();
  await popup.button('Start the break').click();
  await site.button('Reopen the page').click();
  await site.expectReal('news.test/');
  const popup2 = await h.popup(site);
  await popup2.button('End the break').click();
  await site.expectIntervention(true, 5000);
});

test('during a break the popup extends it instead of taking another one (regression)', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK)], {
        pause: pause({
          maxMinutes: 15,
          limit: { count: 1, period: { kind: 'day' } },
        }),
      }),
    ];
  });
  const site = await expectBlocked(h, 'http://news.test/');
  await startBreak(h, { url: 'http://news.test/', minutes: 5 });
  await site.button('Reopen the page').click();
  await site.expectReal('news.test/');
  const popup = await h.popup(site);
  await popup.button(/Take a break/).expectCount(0);
  // Extending adds what is left of the longest break.
  await popup.button(/Extend the break/).click();
  await popup.text('Adds 10 min to your break (5 min so far), without using another break.').expectVisible();
  await popup.button('Extend the break', { within: 'dialog' }).click();
  await popup.text('Break extended by 10 minutes.').expectVisible();
  const o = await h.rpc('overview.get');
  expect(o.pauses).toHaveLength(1);
  expect(o.pauses[0].minutes).toBe(15);
  const today = await h.page('dashboard.html#/today');
  await today.get('[aria-labelledby="pauses-title"] strong').expectText('News');
});
