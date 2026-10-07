/**
 * Schedules in a real browser (SCH, SEM-02, SEM-07, SEM-09), driven by the extension's test clock:
 * a test chooses the day and the hour, and the open tabs follow the transitions (ENF-02).
 */

import { expect, type Harness, test } from './harness';
import { BLOCK, delay, during, group, outside, policy, timeBudget, window } from './harness/config';
import { expectAllowed, expectBlocked } from './helpers';

const MON = 1;
const TUE = 2;
const SAT = 6;
const FRI = 5;

/** A Monday at least a week from now: every scenario happens in that week, in order. */
const WEEK = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 7 + ((1 - d.getDay() + 7) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
})();

/** A weekday (0 = Sunday … 6 = Saturday) of that week at hh:mm, local time. */
function on(weekday: number, hh: number, mm = 0, ss = 0): Date {
  const d = new Date(WEEK);
  d.setDate(d.getDate() + ((weekday + 6) % 7));
  d.setHours(hh, mm, ss, 0);
  return d;
}

async function at(h: Harness, when: Date) {
  await h.clock.set(when);
}

test('SCH-01 / SCH-03: weekday hours block during the window only', async ({ h }) => {
  await h.configure((c) => {
    c.settings.hour12 = '24';
    c.groups = [
      group(
        'Office',
        ['social.test'],
        [policy(BLOCK, { schedule: during(window([1, 2, 3, 4, 5], 9 * 60, 17 * 60)) })],
      ),
    ];
  });
  await at(h, on(MON, 10));
  const p = await expectBlocked(h, 'http://social.test/');
  // SEM-07: the page says until when.
  await p.role('heading', /This space is protected until .*17:00/).expectVisible();
  await at(h, on(MON, 8, 30));
  await expectAllowed(h, 'http://social.test/early');
  await at(h, on(SAT, 10));
  await expectAllowed(h, 'http://social.test/weekend');
  await at(h, on(FRI, 16, 59));
  await expectBlocked(h, 'http://social.test/friday');
});

test('ENF-02 / ENF-04: open tabs follow the start and the end of a window', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('Office', ['social.test'], [policy(BLOCK, { schedule: during(window([1], 9 * 60, 17 * 60)) })]),
    ];
  });
  await at(h, on(MON, 8, 59));
  const p = await expectAllowed(h, 'http://social.test/feed');
  await h.clock.advance(2 * 60_000);
  await p.expectIntervention(true, 5000);
  await p.expectUrl('#http://social.test/feed');
  await p.role('heading', /protected until/).expectVisible();
  await at(h, on(MON, 17, 1));
  await p.button('Reopen the page').click();
  await p.expectReal('social.test/feed');
});

test('SCH-03 / US-06: "allowed only in these windows" (news at lunch time)', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group(
        'News',
        ['news.test'],
        [policy(BLOCK, { schedule: outside(window([0, 1, 2, 3, 4, 5, 6], 12 * 60 + 30, 12 * 60 + 50)) })],
      ),
    ];
  });
  await at(h, on(TUE, 12, 40));
  await expectAllowed(h, 'http://news.test/');
  await at(h, on(TUE, 13, 0));
  await expectBlocked(h, 'http://news.test/again');
});

test('SCH-01: an overnight window belongs to the day it starts', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('Night', ['night.test'], [policy(BLOCK, { schedule: during(window([MON], 22 * 60, 2 * 60)) })]),
    ];
  });
  await at(h, on(MON, 23));
  await expectBlocked(h, 'http://night.test/a');
  await at(h, on(TUE, 1, 30));
  await expectBlocked(h, 'http://night.test/b');
  await at(h, on(TUE, 2, 30));
  await expectAllowed(h, 'http://night.test/c');
  // Tuesday night is not selected.
  await at(h, on(TUE, 23));
  await expectAllowed(h, 'http://night.test/d');
});

test('SEM-09: with days starting at 04:00, a night window belongs to the evening before', async ({ h }) => {
  // A later day start is a weakening: at the Soft level it costs a confirmation, not a wait.
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
  });
  await h.configure((c) => {
    c.settings.dayStart = 4 * 60;
    // Monday 01:00–03:00 of the "logical" Monday = the night after Monday.
    c.groups = [group('Late', ['late.test'], [policy(BLOCK, { schedule: during(window([MON], 60, 180)) })])];
  });
  await at(h, on(TUE, 2));
  await expectBlocked(h, 'http://late.test/');
  await at(h, on(MON, 2));
  await expectAllowed(h, 'http://late.test/early');
});

test('SEM-02 / SCH-04: the first rule whose condition holds applies', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group(
        'Video',
        ['video.test'],
        [policy(BLOCK, { schedule: during(window([1, 2, 3, 4, 5], 9 * 60, 17 * 60)) }), policy(delay(10))],
      ),
    ];
  });
  await at(h, on(MON, 10));
  const p = await expectBlocked(h, 'http://video.test/');
  await p.role('heading', /protected/).expectVisible();
  await at(h, on(MON, 18));
  const q = await expectBlocked(h, 'http://video.test/evening');
  await q.role('heading', 'Take a breath.').expectVisible();
  const why = await h.rpc('explain', { url: 'http://video.test/' });
  expect(why.primary.policyIndex).toBe(1);
  expect(why.primary.policies[0].scheduleActive).toBe(false);
});

test('LIM-01: a daily budget refills on the next day', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(30) })])];
  });
  await at(h, on(TUE, 20));
  const g = (await h.rpc('config.get')).config.groups[0];
  await h.rpc('budget.forfeit', { groupId: g.id });
  await expectBlocked(h, 'http://video.test/');
  const why = await h.rpc('explain', { url: 'http://video.test/' });
  expect(new Date(why.until).getHours()).toBe(0);
  await at(h, on(TUE + 1, 0, 1));
  await expectAllowed(h, 'http://video.test/tomorrow');
});

test('SEM-07: "Test a URL" tells what applies now and what changes next', async ({ h }) => {
  await h.configure((c) => {
    c.settings.hour12 = '24';
    c.groups = [
      group(
        'Office',
        ['social.test', '+social.test/help'],
        [policy(BLOCK, { schedule: during(window([1, 2, 3, 4, 5], 9 * 60, 17 * 60)) })],
      ),
    ];
  });
  const monday10 = on(MON, 10);
  await at(h, monday10);
  const d = await h.rpc('explain', { url: 'http://m.social.test/x' });
  expect(d.intervention.type).toBe('block');
  expect(d.primary.entry.value).toBe('social.test');
  const end = new Date(monday10);
  end.setHours(17, 0, 0, 0);
  expect(d.until).toBe(end.getTime());
  const e = await h.rpc('explain', { url: 'http://social.test/help/faq' });
  expect(e.excepted[0].entry.value).toBe('social.test/help');
  // The editor's "Test a URL" panel shows the same answer (MAT-16).
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const editor = await h.page(`dashboard.html#/groups/${id}`);
  await editor.label('Address to test').fill('m.social.test/x');
  await editor.button('Test', { exact: true }).click();
  await editor.text(/Matched by .*social\.test/).expectVisible();
  await editor.text(/until .*17:00/).expectVisible();
});
