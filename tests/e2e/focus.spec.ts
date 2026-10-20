/**
 * Focus sessions in a real browser: from the popup, the dashboard,
 * the keyboard shortcut and the context menu; allowlist mode, delayed start, extension, early end.
 */

import { expect, test } from './harness';
import { group, PERMANENT, policy, REMINDER, TRACK } from './harness/config';
import { expectAllowed, expectBlocked } from './helpers';

const session = (more: Record<string, unknown> = {}) => ({
  kind: 'groups',
  groups: [],
  allow: [],
  minutes: 30,
  locked: false,
  noPauses: false,
  ...more,
});

test('a focus session starts from the popup in two taps and blocks the rules', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('Games', ['games.test'], [policy(TRACK)]),
      group('Not in sessions', ['work.test'], [policy(TRACK)], {
        options: { privacy: 'all', embeds: false, tabs: 'all', timer: true, quickSession: false },
      }),
    ];
  });
  const open = await expectAllowed(h, 'http://games.test/');
  const popup = await h.popup(open);
  await popup.role('radio', '50 min').click();
  await popup.button('Start focus').click();
  await popup.text(/Focus until/).expectVisible();
  // The open tab of a rule in the session is blocked at once.
  await open.expectIntervention(true, 5000);
  await open.role('heading', /You are in a focus session until/).expectVisible();
  await expectAllowed(h, 'http://work.test/');
  const ov = await h.rpc('overview.get');
  expect(Math.round((ov.sessions[0].endAt - ov.sessions[0].startAt) / 60_000)).toBe(50);
  expect(ov.today.sessions).toBe(1);
});

test('an allowlist session from the dashboard blocks everything else, with a preview first', async ({
  h,
}) => {
  const p = await h.page('dashboard.html#/focus');
  await p.role('radio', /Everything except a few sites/).click();
  await p.placeholder('Add a site, or paste a list…').fill('docs.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Start focus session').click();
  await p.role('heading', 'Before you start').expectVisible();
  await p.text(/Every website except 1 site/).expectVisible();
  await p.button('Start focus session', { within: 'dialog' }).click();
  await p.text(/Focus session until/).expectVisible();
  await expectAllowed(h, 'http://docs.test/manual');
  await expectBlocked(h, 'http://anything.test/');
  await expectBlocked(h, 'http://news.test/');
});

test('a delayed session starts by itself and restricts the open tabs', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
  });
  await h.rpc('session.start', session({ startInMinutes: 5 }));
  const p = await expectAllowed(h, 'http://games.test/');
  const ov = await h.rpc('overview.get');
  expect(ov.upcoming.map((u: any) => u.label)).toContain('session-start');
  await h.clock.advance(5 * 60_000 + 2000);
  await p.expectIntervention(true, 5000);
});

test('extending is immediate; ending early costs a confirmation, whatever the protection of its rules', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
    for (const g of c.groups) g.protection = PERMANENT;
  });
  const { id } = await h.rpc('session.start', session({ minutes: 25 }));
  const p = await h.page('dashboard.html#/focus');
  await p.button('+15 min').click();
  const s = (await h.rpc('overview.get')).sessions[0];
  expect(Math.round((s.endAt - s.startAt) / 60_000)).toBe(40);
  const blocked = await expectBlocked(h, 'http://games.test/');
  await p.front();
  await p.button('End now').click();
  await p.text('Do you really want to go ahead?').expectVisible();
  await p.button('Yes, continue').click();
  await expect.poll(async () => (await h.rpc('overview.get')).sessions.length).toBe(0);
  await blocked.button('Reopen the page').click();
  await blocked.expectReal('games.test/');
  // Cancelling a session that has not started costs the same.
  const second = await h.rpc('session.start', session({ startInMinutes: 30 }));
  const end = await h.rpc('session.end', { id: second.id });
  expect(end.ticket.step).toEqual({ type: 'confirm' });
  expect(id).toBeTruthy();
});

test('a focus session can last any length, not only the quick ones (#18)', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
  });
  const p = await h.page('dashboard.html#/focus');
  await p.role('radio', 'Other…').click();
  // The length starts as 1 hour: the unit keeps the number, then 75 minutes are typed.
  await p.label('Length of the session: unit').expectValue('hours');
  await p.label('Length of the session: unit').select('minutes');
  await p.label('Length of the session', { exact: true }).fill('75');
  await p.text('1 h 15 min').expectVisible();
  await p.button('Start focus session').click();
  // Shown once the session has started and the browser filters follow it.
  await p.text(/Focus session until/).expectVisible();
  const s = (await h.rpc('overview.get')).sessions[0];
  expect(Math.round((s.endAt - s.startAt) / 60_000)).toBe(75);
  await expectBlocked(h, 'http://games.test/');
});

test('a session that cannot be interrupted refuses to end and says so', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
    for (const g of c.groups) g.protection = REMINDER;
  });
  const { id } = await h.rpc('session.start', session({ locked: true }));
  expect(await h.rpc('session.end', { id })).toMatchObject({ refused: 'session.error.locked' });
  const p = await expectBlocked(h, 'http://games.test/');
  await p.text('This session cannot be interrupted.').expectVisible();
  const popup = await h.popup(p);
  await popup.text('Cannot be interrupted').expectVisible();
  await popup.button('End now').expectCount(0);
  // Extending stays possible.
  await popup.button('+15 min').click();
  const s = (await h.rpc('overview.get')).sessions[0];
  expect(Math.round((s.endAt - s.startAt) / 60_000)).toBe(45);
});

test('the end of a session is notified with a summary', async ({ h, browserName }) => {
  test.skip(
    browserName === 'chromium',
    'Chromium asks for optional permissions in a browser prompt that automation cannot answer',
  );
  await h.configure((c) => {
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
  });
  // The permission is asked when notifications are turned on.
  const settings = await h.page('dashboard.html#/settings/feedback');
  await settings.role('switch', /notifications/i).click();
  await expect.poll(async () => (await h.rpc('diag.get')).permissions.notifications).toBe(true);
  await expect.poll(async () => (await h.rpc('config.get')).config.settings.notifications.enabled).toBe(true);
  await h.rpc('session.start', session({ minutes: 1 }));
  await expectBlocked(h, 'http://games.test/');
  await h.clock.advance(61_000);
  await h.alarm('periodic');
  await expect
    .poll(async () => (await h.state()).notifications.map((n: any) => `${n.title}: ${n.message}`))
    .toContainEqual(
      expect.stringMatching(/^Focus session over: 1 min of focus\. WebHandbrake stepped in once\./),
    );
});

test('the keyboard shortcut starts a 25-minute session; so does the context menu', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
  });
  // The browser dispatches shortcuts and menu clicks itself; the test calls the same handlers.
  await h.rpc('test.command', { command: 'start-session' });
  let sessions = (await h.rpc('overview.get')).sessions;
  expect(Math.round((sessions[0].endAt - sessions[0].startAt) / 60_000)).toBe(25);
  await expectBlocked(h, 'http://games.test/');
  await h.rpc('test.menu', { menuItemId: 'focus|90' });
  sessions = (await h.rpc('overview.get')).sessions;
  expect(sessions.map((s: any) => Math.round((s.endAt - s.startAt) / 60_000)).sort()).toEqual([25, 90]);
  // The commands are declared with their suggested keys.
  const commands = await h.control.eval(() => chrome.commands.getAll());
  expect(commands.map((c) => c.name)).toEqual(
    expect.arrayContaining(['_execute_action', 'start-session', 'block-site', 'open-dashboard']),
  );
});
