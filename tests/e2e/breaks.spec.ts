/**
 * Breaks in a real browser (BRK-01…BRK-10): scopes, durations, costs verified in the background,
 * budgets, metered breaks, expiry with immediate re-application, from the block page and the popup.
 */

import { expect, type Harness, test } from './harness';
import { BLOCK, group, pauseFree, policy } from './harness/config';
import { expectAllowed, expectBlocked, sleep, useUntil } from './helpers';

const pause = (more: Record<string, unknown> = {}) => ({ ...pauseFree, ...more });

async function startBreak(h: Harness, args: Record<string, unknown>, extra: { password?: string } = {}) {
  const r = await h.rpc('pause.start', args);
  if (r.error) return r;
  if (r.ticket) await h.completeTicket(r.ticket, extra);
  return r;
}

test('BRK-07 / BRK-09 / ENF-02: a break unblocks; ending it re-blocks the open tabs at once', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)], { pause: pause() })];
  });
  const p = await expectBlocked(h, 'http://news.test/article');
  await startBreak(h, { url: 'http://news.test/article', scope: 'site', minutes: 5 });
  // The intervention page notices and offers to reopen (ENF-04).
  await p.button('Reopen the page').click();
  await p.expectReal('news.test/article');
  expect((await h.rpc('overview.get')).pauses).toHaveLength(1);
  const t0 = Date.now();
  await h.rpc('pause.cancel', { all: true });
  await p.expectIntervention(true, 5000);
  expect(Date.now() - t0).toBeLessThan(3000);
  await p.expectUrl('#http://news.test/article');
});

test('BRK-07: a break ends by itself and the page is restricted again', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)], { pause: pause() })];
  });
  await startBreak(h, { url: 'http://news.test/', scope: 'site', minutes: 1 });
  const p = await expectAllowed(h, 'http://news.test/');
  await h.clock.advance(61_000);
  await p.expectIntervention(true, 5000);
});

test('BRK-02: a break for this page, this site, the rule or everything', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test', 'paper.test'], [policy(BLOCK)], { pause: pause() }),
      group('Games', ['games.test'], [policy(BLOCK)], { pause: pause() }),
      group('Strict', ['strict.test'], [policy(BLOCK)], { pause: pause({ allowed: false }) }),
    ];
  });
  await startBreak(h, { url: 'http://news.test/a', scope: 'page', minutes: 5 });
  await expectAllowed(h, 'http://news.test/a');
  await expectBlocked(h, 'http://news.test/b');
  await h.rpc('pause.cancel', { all: true });

  await startBreak(h, { url: 'http://news.test/a', scope: 'site', minutes: 5 });
  await expectAllowed(h, 'http://www.news.test/b');
  await expectBlocked(h, 'http://paper.test/');
  await h.rpc('pause.cancel', { all: true });

  await startBreak(h, { url: 'http://news.test/a', scope: 'group', minutes: 5 });
  await expectAllowed(h, 'http://paper.test/');
  await expectBlocked(h, 'http://games.test/');
  await h.rpc('pause.cancel', { all: true });

  await startBreak(h, { url: 'http://news.test/a', scope: 'all', minutes: 5 });
  await expectAllowed(h, 'http://games.test/');
  // A rule that allows no breaks is not covered by a break of everything (BRK-01).
  await expectBlocked(h, 'http://strict.test/');
});

test('BRK-03 / BRK-05: a break from the block page, with its cost, returns to the page', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK)], {
        pause: pause({
          cost: { type: 'confirm' },
          duration: { mode: 'choices', minutes: 10, choices: [5, 10] },
        }),
      }),
    ];
  });
  const p = await expectBlocked(h, 'http://news.test/story');
  await p.get('.break-link').expectText('a confirmation');
  await p.button('Take a break').click();
  await p.role('radio', 'news.test').expectChecked();
  await p.role('radio', '10 min').click();
  await p.button('Start the break').click();
  await p.text('Do you really want to go ahead?').expectVisible();
  await p.button('Yes, continue').click();
  await p.expectReal('news.test/story');
  const g = (await h.rpc('overview.get')).pauses[0];
  expect(Math.round((g.until - (await h.clock.now())) / 60_000)).toBe(10);
});

test('BRK-05: a break that costs a wait cannot be taken before the wait is over (PRO-14)', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK)], {
        pause: pause({ cost: { type: 'delay', seconds: 3 } }),
      }),
    ];
  });
  const r = await h.rpc('pause.start', { url: 'http://news.test/', scope: 'site', minutes: 5 });
  expect(r.ticket.step.type).toBe('wait');
  expect(await h.rpc('ticket.answer', { id: r.ticket.id, answer: '' })).toMatchObject({
    status: 'error',
    error: 'ticket.error.notYet',
  });
  await sleep(3200);
  expect((await h.rpc('ticket.answer', { id: r.ticket.id, answer: '' })).status).toBe('done');
  await expectAllowed(h, 'http://news.test/');
});

test('BRK-05 / PRO-05: a break that costs the password', async ({ h }) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
  });
  const set = await h.rpc('password.change', { password: 'correct horse' });
  expect(set.ticket).toBeNull();
  await h
    .configure((c) => {
      c.groups = [
        group('News', ['news.test'], [policy(BLOCK)], { pause: pause({ cost: { type: 'password' } }) }),
      ];
    })
    .catch(() => undefined);
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.settings.protection.access.passwordHash).toMatch(/^pbkdf2-sha256\$/);
  const r = await h.rpc('pause.start', { url: 'http://news.test/', scope: 'site', minutes: 5 });
  expect(r.ticket.step.type).toBe('password');
  expect(await h.rpc('ticket.answer', { id: r.ticket.id, answer: 'wrong' })).toMatchObject({
    status: 'error',
    error: 'ticket.error.wrongPassword',
  });
  expect((await h.rpc('ticket.answer', { id: r.ticket.id, answer: 'correct horse' })).status).toBe('done');
  await expectAllowed(h, 'http://news.test/');
});

test('BRK-06: a required reason is asked and recorded', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)], { pause: pause({ reason: 'required' }) })];
  });
  const p = await expectBlocked(h, 'http://news.test/');
  await p.button('Take a break').click();
  await p.button('Start the break').click();
  await p.text('Please give a reason.').expectVisible();
  await p.label('Reason').fill('Checking the train strike');
  await p.button('Start the break').click();
  await p.expectReal('news.test/');
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const stats = await h.rpc('stats.get', { from: day, to: day });
  expect(stats.pauses[0].reason).toBe('Checking the train strike');
  expect(stats.counters.pauses).toBe(1);
});

test('BRK-04: breaks are limited per rule and overall', async ({ h }) => {
  await h.configure((c) => {
    c.settings.pauseLimit = { count: 2, period: { kind: 'day' } };
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK)], {
        pause: pause({ limit: { count: 1, period: { kind: 'day' } } }),
      }),
      group('Games', ['games.test'], [policy(BLOCK)], { pause: pause() }),
    ];
  });
  await startBreak(h, { url: 'http://news.test/', scope: 'site', minutes: 1 });
  await h.rpc('pause.cancel', { all: true });
  const again = await h.rpc('pause.options', { url: 'http://news.test/' });
  expect(again).toMatchObject({ available: false, reason: 'pause.unavailable.noneLeft' });
  const p = await expectBlocked(h, 'http://news.test/');
  await p.text('No breaks left for this period.').expectVisible();
  await startBreak(h, { url: 'http://games.test/', scope: 'site', minutes: 1 });
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

test('BRK-08: a metered break is used only while on the site', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)], { pause: pause({ metered: true }) })];
  });
  await startBreak(h, { url: 'http://news.test/', scope: 'site', minutes: 1 });
  const remaining = async () => (await h.rpc('overview.get')).pauses[0]?.remaining as number;
  expect(await remaining()).toBe(60);
  const p = await expectAllowed(h, 'http://news.test/');
  await useUntil(p, async () => false, 4000);
  const used = 60 - (await remaining());
  expect(used).toBeGreaterThan(2);
  expect(used).toBeLessThan(7);
  // Leaving the site stops the break's clock.
  await p.goto('http://other.test/');
  await p.expectReal('other.test/');
  await useUntil(p, async () => false, 3000);
  expect(60 - (await remaining())).toBeLessThan(used + 1.5);
});

test('FOC-09: no breaks during a focus session that forbids them', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy({ type: 'track' })], { pause: pause() })];
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

test('BRK-10: a break is visible in the popup, which can end it', async ({ h }) => {
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
