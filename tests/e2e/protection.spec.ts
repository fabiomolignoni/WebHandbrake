/**
 * Protection in a real browser (PRO-01…PRO-15, SCH-07): levels, cooling-off and confirmation,
 * access requirements, the emergency exit, protected browser pages and clock tampering. Every
 * cost is a ticket verified by the background (PRO-14).
 */

import { expect, type Harness, test } from './harness';
import { BLOCK, during, group, policy, TRACK, target, window } from './harness/config';
import { expectAllowed, expectBlocked, sleep } from './helpers';

const HOUR = 3_600_000;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** A rule active only on the other days of the week (so it is not active now). */
function inactiveSchedule() {
  const today = new Date().getDay();
  const days = EVERY_DAY.filter((d) => d !== today && d !== (today + 6) % 7);
  return during(window(days, 0, 60));
}

/** The code shown by the newest ticket of a kind (drawn on a canvas, read from the background). */
async function ticketCode(h: Harness, purpose: string): Promise<string> {
  await expect
    .poll(async () => {
      const tickets: any[] = await h.control.eval(() =>
        chrome.storage.session.get('tickets').then((r) => (r.tickets as unknown[]) ?? []),
      );
      return tickets.filter((t) => t.purpose.kind === purpose).length;
    })
    .toBeGreaterThan(0);
  const tickets: any[] = await h.control.eval(() =>
    chrome.storage.session.get('tickets').then((r) => (r.tickets as unknown[]) ?? []),
  );
  return tickets.filter((t) => t.purpose.kind === purpose).pop().active.text;
}

test('PRO-02: under Strict, strengthening is immediate and weakening an active rule is refused', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)])];
  });
  await h.configure((c) => {
    c.settings.protection.level = 'strict';
  });
  const add = await h.configure((c) => {
    c.groups[0].targets.push(target('b.test'));
  });
  expect(add.applied).toHaveLength(1);
  await expectBlocked(h, 'http://b.test/');
  const remove = await h.configure((c) => {
    c.groups[0].targets = c.groups[0].targets.filter((t: any) => t.value !== 'a.test');
  });
  expect(remove.refused?.reason).toBe('lockedNow');
  await expectBlocked(h, 'http://a.test/');
});

test('PRO-03: a weakening waits for the cooling-off, then needs a typed confirmation in Protection', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Evenings', ['late.test'], [policy(BLOCK, { schedule: inactiveSchedule() })])];
  });
  await h.configure((c) => {
    c.settings.protection.level = 'strict';
  });
  const r = await h.configure((c) => {
    c.groups[0].targets = [target('other.test')];
  });
  expect(r.applied.map((u: any) => u.kind)).toEqual(['target.add']);
  expect(r.pending.units.map((u: any) => u.kind)).toEqual(['target.remove']);
  const pending = (await h.rpc('overview.get')).pending[0];
  expect(Math.round((pending.readyAt - pending.createdAt) / HOUR)).toBe(24);
  expect(await h.rpc('pending.confirm', { id: pending.id })).toMatchObject({
    error: 'pending.error.notReady',
  });
  const p = await h.page('dashboard.html#/protection');
  await p.text(/can be confirmed in/).expectVisible();
  await p.button('Confirm the change').expectEnabled(false);
  await h.clock.advance(24 * HOUR + 60_000);
  await p.reload();
  await p.text(/ready: confirm it before/).expectVisible();
  await p.button('Confirm the change').click();
  const code = await ticketCode(h, 'pending');
  expect(code).toHaveLength(24);
  await p.label('Characters').type(code);
  await p.button('Continue', { exact: true, within: 'dialog' }).click();
  await p.text('Change applied.').expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[0].targets.map((t: any) => t.value)).toEqual(['other.test']);
});

test('PRO-03: a pending change can be cancelled, and expires when not confirmed in time', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Evenings', ['late.test'], [policy(BLOCK, { schedule: inactiveSchedule() })])];
  });
  await h.configure((c) => {
    c.settings.protection.level = 'strict';
  });
  await h.configure((c) => {
    c.groups[0].targets = [];
  });
  await h.configure((c) => {
    c.groups[0].targets = [target('x.test')];
  });
  let pending = (await h.rpc('overview.get')).pending;
  expect(pending).toHaveLength(2);
  const p = await h.page('dashboard.html#/protection');
  await p.button('Cancel the change').click();
  await p.text('Change cancelled: your rules stay as they are.').expectVisible();
  pending = (await h.rpc('overview.get')).pending;
  expect(pending).toHaveLength(1);
  // 24 h of cooling-off + 48 h to confirm.
  await h.clock.advance(73 * HOUR);
  await h.alarm('periodic');
  expect((await h.rpc('overview.get')).pending).toHaveLength(0);
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[0].targets.map((t: any) => t.value)).toContain('late.test');
});

test('PRO-01: at the Soft level the editor asks for a confirmation, and "Keep my rules" keeps them', async ({
  h,
}) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
    c.groups = [group('Social', ['a.test', 'b.test'], [policy(BLOCK)])];
  });
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const p = await h.page(`dashboard.html#/groups/${id}`);
  await p.button('Remove a.test').click();
  await p.button('Save changes').click();
  await p.role('heading', 'Loosen your rules?').expectVisible();
  await p.button('Keep my rules').click();
  await p.text('Your rules stay as they are.').expectVisible();
  expect((await h.rpc('config.get')).config.groups[0].targets).toHaveLength(2);
  // The editor is back to the saved rule.
  await p.button('Remove a.test').expectVisible();
  await p.button('Save changes').expectEnabled(false);
  await p.button('Remove a.test').click();
  await p.button('Save changes').click();
  await p.button('Yes, continue').click();
  await p.text('Done: your change is applied.').expectVisible();
  expect((await h.rpc('config.get')).config.groups[0].targets.map((t: any) => t.value)).toEqual(['b.test']);
  await expectAllowed(h, 'http://a.test/');
});

test('PRO-01: at the Balanced level a weakening costs a wait that cannot be skipped', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)])];
  });
  const cfg = (await h.rpc('config.get')).config;
  cfg.groups[0].enabled = false;
  const r = await h.rpc('config.save', { config: cfg });
  expect(r.ticket.step).toMatchObject({ type: 'wait', seconds: 30 });
  expect(await h.rpc('ticket.answer', { id: r.ticket.id, answer: '' })).toMatchObject({
    error: 'ticket.error.notYet',
  });
  await h.rpc('ticket.cancel', { id: r.ticket.id });
  await expectBlocked(h, 'http://a.test/');
});

test('PRO-01: the Locked level refuses every weakening until its date, then falls back', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)])];
  });
  const until = (await h.clock.now()) + 2 * 24 * HOUR;
  await h.configure((c) => {
    c.settings.protection.level = 'locked';
    c.settings.protection.lockedUntil = until;
  });
  const weaken = (c: any) => {
    c.groups[0].enabled = false;
  };
  const r = await h.configure(weaken);
  expect(r.refused).toMatchObject({ reason: 'locked', until });
  const p = await h.page('dashboard.html#/protection');
  await p.text(/Locked until/).expectVisible();
  // After the date the level falls back to Strict: still refused while the rule is active.
  await h.clock.advance(2 * 24 * HOUR + 60_000);
  expect((await h.rpc('overview.get')).level).toBe('strict');
  const after = await h.configure(weaken);
  expect(after.refused?.reason).toBe('lockedNow');
  await expectBlocked(h, 'http://a.test/');
});

test('PRO-05: a settings password is asked by the background for every change but strengthening', async ({
  h,
}) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)])];
  });
  await h.rpc('password.change', { password: 's3cret pass' });
  // Strengthening stays immediate.
  const cfg = (await h.rpc('config.get')).config;
  cfg.groups[0].targets.push(target('b.test'));
  const add = await h.rpc('config.save', { config: cfg });
  expect(add.ticket).toBeNull();
  expect(add.applied).toHaveLength(1);
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const p = await h.page(`dashboard.html#/groups/${id}`);
  await p.label('Name', { exact: true }).fill('Renamed');
  await p.button('Save changes').click();
  await p.label('Password').type('wrong');
  await p.button('Continue', { exact: true, within: 'dialog' }).click();
  await p.text('Wrong password.').expectVisible();
  await p.label('Password').fill('s3cret pass');
  await p.button('Continue', { exact: true, within: 'dialog' }).click();
  await p.text('Done: your change is applied.').expectVisible();
  expect((await h.rpc('config.get')).config.groups[0].name).toBe('Renamed');
  // The hash only: never the password (SEC-01).
  const stored = JSON.stringify(await h.control.eval(() => chrome.storage.local.get('config')));
  expect(stored).not.toContain('s3cret pass');
  expect(stored).toMatch(/pbkdf2-sha256\$600000\$/);
});

test('PRO-05: settings can be locked at certain hours (strengthening still allowed)', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)])];
  });
  await h.configure((c) => {
    c.settings.protection.access.lockWindows = [window(EVERY_DAY, 0, 1440)];
  });
  const remove = await h.configure((c) => {
    c.groups[0].enabled = false;
  });
  expect(remove.refused?.reason).toBe('accessWindow');
  const add = await h.configure((c) => {
    c.groups[0].targets.push(target('b.test'));
  });
  expect(add.applied).toHaveLength(1);
  await expectBlocked(h, 'http://b.test/');
});

test('PRO-12 / DAT-06: importing a looser configuration or resetting is protected like any change', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)])];
  });
  await h.configure((c) => {
    c.settings.protection.level = 'strict';
  });
  const empty = JSON.stringify({
    format: 'webhandbrake',
    version: 1,
    config: { ...(await h.rpc('config.get')).config, groups: [] },
  });
  const imp = await h.rpc('data.import', { text: empty, mode: 'replace' });
  expect(imp.refused?.reason).toBe('lockedNow');
  const reset = await h.rpc('data.reset');
  expect(reset.refused?.reason).toBe('lockedNow');
  await expectBlocked(h, 'http://a.test/');
});

test('PRO-15: the emergency exit always works: request, wait, type a sentence', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
  });
  await h.configure((c) => {
    c.settings.protection.level = 'locked';
    c.settings.protection.lockedUntil = Date.now() + 30 * 24 * HOUR;
  });
  await h.rpc('session.start', {
    kind: 'groups',
    groups: [],
    allow: [],
    minutes: 8 * 60,
    locked: true,
    noPauses: true,
  });
  await expectBlocked(h, 'http://games.test/');
  const p = await h.page('dashboard.html#/protection');
  await p.button('Request the emergency exit').click();
  await p.button('Request the emergency exit', { within: 'dialog' }).click();
  await p.text(/Emergency exit requested: it can be completed from/).expectVisible();
  expect(await h.rpc('emergency.start')).toMatchObject({ error: 'emergency.error.notReady' });
  await h.clock.advance(24 * HOUR + 60_000);
  await p.reload();
  await p.button('Complete the emergency exit').click();
  await p.label('Sentence').type('I understand that this removes my protections.');
  await p.button('Continue', { exact: true, within: 'dialog' }).click();
  await p.text('Emergency exit completed: protections are now Soft.').expectVisible();
  const ov = await h.rpc('overview.get');
  expect(ov.level).toBe('soft');
  expect(ov.sessions).toHaveLength(0);
  await expectAllowed(h, 'http://games.test/');
  const tamper = (await h.state()).state.tamper.map((e: any) => `${e.kind}:${e.detail}`);
  expect(tamper).toEqual(expect.arrayContaining(['emergency:requested', 'emergency:completed']));
});

test('PRO-08: browser settings pages are protected while strict rules are active', async ({
  h,
  browserName,
}) => {
  const internal = browserName === 'chromium' ? 'chrome://extensions/' : 'about:addons';
  await h.configure((c) => {
    c.settings.protection.internalPages = 'always';
  });
  const p = await h.open(internal);
  await p.expectIntervention(true, 8000);
  await p.role('heading', 'Browser settings are protected while your blocks are active.').expectVisible();
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
  });
  await h.configure((c) => {
    c.settings.protection.internalPages = 'never';
  });
  const q = await h.open(internal);
  await sleep(1500);
  expect(await q.isIntervention()).toBe(false);
});

test('PRO-13 / SCH-07: a clock set backwards is detected and time does not go back', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)])];
  });
  const later = Date.now() + 3 * HOUR;
  await h.clock.set(later);
  await h.rpc('overview.get');
  // The system clock goes back to the real time: a backward jump of 3 hours.
  const back = await h.rpc('test.clock', { set: Date.now(), detect: true });
  expect(back.now).toBeGreaterThanOrEqual(later);
  const state = (await h.state()).state;
  expect(state.tamper.map((e: any) => e.kind)).toContain('clock-backward');
  const ov = await h.rpc('overview.get');
  expect(ov.warnings.map((w: any) => w.kind)).toContain('tamper');
  const p = await h.page('dashboard.html#/protection');
  await p.text(/clock/i, { within: 'main' }).expectVisible();
});

test('SCH-07: a clock set forward is corrected with the Date of web responses (no extra request)', async ({
  h,
}) => {
  const ahead = new Date(Date.now() + 2 * HOUR).toUTCString();
  for (const host of ['one.test', 'two.test', 'three.test'])
    h.server.route(host, { headers: { Date: ahead }, body: `<h1 id="real">REAL ${host}</h1>` });
  const before = h.server.requests.length;
  for (const host of ['one.test', 'two.test', 'three.test'])
    await (await h.open(`http://${host}/`)).expectReal(host);
  // Only the three pages were requested.
  expect(h.server.requests.length - before).toBeLessThanOrEqual(6);
  await expect.poll(async () => (await h.state()).state.clockOffset).toBeGreaterThan(HOUR + 50 * 60_000);
  const ov = await h.rpc('overview.get');
  const clock = ov.warnings.find((w: any) => w.kind === 'clock');
  expect(Number(clock.detail)).toBeGreaterThanOrEqual(119);
  expect((await h.state()).state.tamper.map((e: any) => e.kind)).toContain('clock-skew');
});
