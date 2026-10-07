/**
 * Focus sessions in a real browser (FOC-01…FOC-09, API-01, API-02): from the popup, the dashboard,
 * the keyboard shortcut and the context menu; allowlist mode, delayed start, extension, early end.
 */

import { expect, test } from './harness';
import { group, policy, TRACK, target } from './harness/config';
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

test('FOC-01: a focus session starts from the popup in two taps and blocks the rules', async ({ h }) => {
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
  // The open tab of a rule in the session is blocked at once (ENF-02).
  await open.expectIntervention(true, 5000);
  await open.role('heading', /You are in a focus session until/).expectVisible();
  await expectAllowed(h, 'http://work.test/');
  const ov = await h.rpc('overview.get');
  expect(Math.round((ov.sessions[0].endAt - ov.sessions[0].startAt) / 60_000)).toBe(50);
  expect(ov.today.sessions).toBe(1);
});

test('FOC-02: an allowlist session from the dashboard blocks everything else, with a preview first', async ({
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

test('FOC-04: a delayed session starts by itself and restricts the open tabs', async ({ h }) => {
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

test('FOC-05: extending is immediate; ending early costs what the level says', async ({ h }) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
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
  // At the Strict level a session cannot be ended early.
  await h.configure((c) => {
    c.settings.protection.level = 'strict';
  });
  const second = await h.rpc('session.start', session());
  expect(await h.rpc('session.end', { id: second.id })).toMatchObject({ refused: 'session.error.strict' });
  expect(id).toBeTruthy();
});

test('FOC-03: a session that cannot be interrupted refuses to end and says so', async ({ h }) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
  });
  const { id } = await h.rpc('session.start', session({ locked: true }));
  expect(await h.rpc('session.end', { id })).toMatchObject({ refused: 'session.error.locked' });
  const p = await expectBlocked(h, 'http://games.test/');
  await p.text('This session cannot be interrupted.').expectVisible();
  const popup = await h.popup(p);
  await popup.text('Cannot be interrupted').expectVisible();
  await popup.button('End now').expectCount(0);
  // Extending stays possible (FOC-05).
  await popup.button('+15 min').click();
  const s = (await h.rpc('overview.get')).sessions[0];
  expect(Math.round((s.endAt - s.startAt) / 60_000)).toBe(45);
});

test('FOC-07: the end of a session is notified with a summary', async ({ h, browserName }) => {
  test.skip(
    browserName === 'chromium',
    'Chromium asks for optional permissions in a browser prompt that automation cannot answer',
  );
  await h.configure((c) => {
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
  });
  // NOT-04: the permission is asked when notifications are turned on.
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

test('API-01: the keyboard shortcut starts a 25-minute session; API-02: so does the context menu', async ({
  h,
}) => {
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

test('FOC-02: the global allowlist stays open during an allowlist session', async ({ h }) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
  });
  await h.configure((c) => {
    c.allowlist = [target('bank.test')];
  });
  await h.rpc('session.start', session({ kind: 'allowlist', allow: [target('docs.test')] }));
  await expectAllowed(h, 'http://bank.test/');
  await expectAllowed(h, 'http://docs.test/');
  await expectBlocked(h, 'http://other.test/');
});
