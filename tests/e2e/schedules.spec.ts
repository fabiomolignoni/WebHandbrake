/**
 * Schedules in a real browser, driven by the extension's test clock:
 * a test chooses the day and the hour, and the open tabs follow the transitions.
 * The calendar itself (overnight windows, the day start, "outside these times", the first
 * condition that holds) is unit tested in tests/unit/time.test.ts and engine.test.ts.
 */

import { expect, type Harness, test } from './harness';
import { BLOCK, during, group, policy, timeBudget, window } from './harness/config';
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

test('weekday hours block during the window only', async ({ h }) => {
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
  // The page says until when.
  await p.role('heading', /This space is protected until .*17:00/).expectVisible();
  await at(h, on(MON, 8, 30));
  await expectAllowed(h, 'http://social.test/early');
  await at(h, on(SAT, 10));
  await expectAllowed(h, 'http://social.test/weekend');
  await at(h, on(FRI, 16, 59));
  await expectBlocked(h, 'http://social.test/friday');
});

test('open tabs follow the start and the end of a window', async ({ h }) => {
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

test('a daily budget refills on the next day', async ({ h }) => {
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

test('"Test a URL" tells what applies now and what changes next', async ({ h }) => {
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
  // The editor's "Test a URL" panel shows the same answer.
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const editor = await h.page(`dashboard.html#/groups/${id}`);
  await editor.label('Address to test').fill('m.social.test/x');
  await editor.button('Test', { exact: true }).click();
  await editor.text(/Matched by .*social\.test/).expectVisible();
  await editor.text(/until .*17:00/).expectVisible();
});
