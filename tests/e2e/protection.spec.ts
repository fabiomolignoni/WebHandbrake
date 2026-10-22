/**
 * Protection in a real browser: the protection of each rule (a reminder, a
 * wait, a password, a partner code, Locked, Permanent), pending changes, the emergency exit,
 * protected browser pages and clock tampering. Every cost is a ticket verified by the background.
 */

import { timeStep, totp } from '../../src/background/totp';
import { expect, type Harness, test } from './harness';
import {
  BLOCK,
  group,
  lockedUntil,
  PERMANENT,
  pauseFree,
  policy,
  REMINDER,
  TRACK,
  target,
  wait,
} from './harness/config';
import { expectAllowed, expectBlocked, openPart, sleep } from './helpers';

const HOUR = 3_600_000;
test('stricter changes always apply at once, even to a Locked rule that refuses every loosening', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)])];
  });
  const until = (await h.clock.now()) + 24 * HOUR;
  // From a wait to Locked is stricter: at once.
  expect((await h.configure((c) => (c.groups[0].protection = lockedUntil(until)))).applied).toHaveLength(1);
  const add = await h.configure((c) => {
    c.groups[0].targets.push(target('b.test'));
  });
  expect(add.applied).toHaveLength(1);
  await expectBlocked(h, 'http://b.test/');
  const remove = await h.configure((c) => {
    c.groups[0].targets = c.groups[0].targets.filter((t: any) => t.value !== 'a.test');
  });
  expect(remove.refused).toMatchObject({ reason: 'locked', until });
  await expectBlocked(h, 'http://a.test/');
});

test('a long wait makes a loosening a pending change, confirmed in Protection once it is over', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Evenings', ['late.test'], [policy(BLOCK)], { protection: wait(24 * 3600) })];
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
  await p.button('Yes, continue', { exact: true, within: 'dialog' }).click();
  await p.text('Change applied.').expectVisible();
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[0].targets.map((t: any) => t.value)).toEqual(['other.test']);
});

test('a pending change can be cancelled, and expires when not confirmed in time', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Evenings', ['late.test'], [policy(BLOCK)], { protection: wait(24 * 3600) })];
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
  // 24 h of waiting + 48 h to confirm.
  await h.clock.advance(73 * HOUR);
  await h.alarm('periodic');
  expect((await h.rpc('overview.get')).pending).toHaveLength(0);
  const cfg = (await h.rpc('config.get')).config;
  expect(cfg.groups[0].targets.map((t: any) => t.value)).toContain('late.test');
});

test('with Reminder the editor asks for a confirmation, and "Keep my rules" keeps them', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test', 'b.test'], [policy(BLOCK)], { protection: REMINDER })];
  });
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const p = await h.page(`dashboard.html#/groups/${id}?step=sites`);
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

test('a short Wait costs a wait in the dialog that cannot be skipped', async ({ h }) => {
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

test('a Locked rule refuses every loosening until its date, then asks only for a reminder', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)])];
  });
  const until = (await h.clock.now()) + 2 * 24 * HOUR;
  await h.configure((c) => {
    for (const g of c.groups) g.protection = lockedUntil(until);
  });
  const weaken = (c: any) => {
    c.groups[0].enabled = false;
  };
  const r = await h.configure(weaken);
  expect(r.refused).toMatchObject({ reason: 'locked', until });
  const p = await h.page('dashboard.html#/protection');
  // Protection lists the protection of each rule.
  await p.role('list', 'Protection of your rules').expectVisible();
  await p.text(/Locked until/, { within: '.list' }).expectVisible();
  // After the date a confirmation is enough.
  await h.clock.advance(2 * 24 * HOUR + 60_000);
  const model = await h.rpc('config.get');
  expect(model.groups[model.config.groups[0].id].protection).toEqual(REMINDER);
  const after = await h.configure(weaken);
  expect(after.refused).toBeNull();
  await expectAllowed(h, 'http://a.test/');
});

test('a change that loosens nothing applies at once, even for a Permanent rule', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('News', ['news.test'], [policy(BLOCK)], { protection: REMINDER }),
      group('Gambling', ['bet.test'], [policy(BLOCK)], { protection: PERMANENT }),
    ];
  });
  // A new name loosens nothing: no cost, even for the Permanent rule.
  const id = (await h.rpc('config.get')).config.groups[1].id;
  const p = await h.page(`dashboard.html#/groups/${id}?step=details`);
  await p.label('Name', { exact: true }).fill('Betting');
  await p.button('Save changes').click();
  await p.text('Rename or restyle Betting').expectVisible();
  expect((await h.rpc('config.get')).config.groups[1].name).toBe('Betting');
  await expectBlocked(h, 'http://bet.test/');
});

test('a Permanent rule, chosen after a preview, refuses every loosening with no end date until the emergency exit', async ({
  h,
}) => {
  const p = await h.page('dashboard.html#/groups/new');
  await p.placeholder('Add a site, or paste a list…').fill('casino.test poker.test');
  await p.button('Add', { exact: true }).click();
  await p.button('Next: when').click();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').click();
  await p.button('Next: details').click();
  await p.label('Name', { exact: true }).fill('Casino');
  await p.button('Next: protection').click();
  await p.role('radio', /^Permanent/).click();
  // A preview first, with an explicit acknowledgement and no date to choose.
  await p.role('heading', 'Make this rule permanent').expectVisible();
  await p.label('Locked until').expectCount(0);
  await p.button('Make permanent').expectEnabled(false);
  await p.label('I understand that only the emergency exit can loosen this rule.').click();
  await p.button('Make permanent').click();
  expect(await p.role('radio', /^Permanent/).checked()).toBe(true);
  await p.button('Next: summary').click();
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const created = (await h.rpc('config.get')).config.groups.find((g: any) => g.name === 'Casino');
  expect(created.protection).toEqual(PERMANENT);
  await expectBlocked(h, 'http://casino.test/');

  // Every loosening is refused, and the editor says why.
  const editor = await h.page(`dashboard.html#/groups/${created.id}?step=sites`);
  await editor.button('Remove casino.test').click();
  await editor.button('Save changes').click();
  await editor.text(/A rule this change loosens is permanent/).expectVisible();
  // A year later, nothing has changed.
  await h.clock.advance(400 * 24 * HOUR);
  const later = await h.configure((c) => {
    c.groups[0].enabled = false;
  });
  expect(later.refused).toMatchObject({ reason: 'permanent', until: null });
  const protection = await h.page('dashboard.html#/protection');
  await protection.text('Permanent', { exact: true, within: '.list' }).expectVisible();

  // Only the emergency exit removes it.
  await h.rpc('emergency.request');
  await h.clock.advance(24 * HOUR + 60_000);
  const start = await h.rpc('emergency.start');
  await h.completeTicket(start.ticket);
  expect((await h.rpc('config.get')).config.groups[0].protection).toEqual(REMINDER);
  const after = await h.configure((c) => {
    c.groups[0].enabled = false;
  });
  expect(after.refused).toBeNull();
  await expectAllowed(h, 'http://casino.test/');
});

test('the emergency exit always works: request, wait, type a sentence', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Games', ['games.test'], [policy(TRACK)])];
  });
  await h.configure((c) => {
    for (const g of c.groups) g.protection = lockedUntil(Date.now() + 30 * 24 * HOUR);
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
  await p.text(/Requested. You can complete it from/).expectVisible();
  expect(await h.rpc('emergency.start')).toMatchObject({ error: 'emergency.error.notReady' });
  await h.clock.advance(24 * HOUR + 60_000);
  await p.reload();
  await p.button('Complete the emergency exit').click();
  await p.label('Sentence').type('I understand that this removes my protections.');
  await p.button('Continue', { exact: true, within: 'dialog' }).click();
  await p.text('Emergency exit done. Every rule now has the Reminder protection.').expectVisible();
  const ov = await h.rpc('overview.get');
  expect(ov.sessions).toHaveLength(0);
  expect((await h.rpc('config.get')).config.groups[0].protection).toEqual(REMINDER);
  await expectAllowed(h, 'http://games.test/');
  const tamper = (await h.state()).state.tamper.map((e: any) => `${e.kind}:${e.detail}`);
  expect(tamper).toEqual(expect.arrayContaining(['emergency:requested', 'emergency:completed']));
});

test('browser settings pages are protected as the mode says; loosening it follows the emergency exit', async ({
  h,
  browserName,
}) => {
  const internal = browserName === 'chromium' ? 'chrome://extensions/' : 'about:addons';
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)], { protection: REMINDER })];
    c.settings.protection.internalPages = 'always';
  });
  const blocked = await h.open(internal);
  await blocked.expectIntervention(true, 8000);
  await blocked
    .role('heading', 'The browser’s extension and settings pages are blocked right now.')
    .expectVisible();
  await blocked.close();
  // The rule asks only for a reminder: this setting waits as long as the emergency exit instead.
  const p = await h.page('dashboard.html#/protection');
  await p.label('Block the browser’s extension and settings pages').select('never');
  await p.text(/so it waits 24 h, like the emergency exit/).expectVisible();
  await p.button('OK', { within: 'dialog' }).click();
  await p.text(/Follows the emergency exit: confirm it by typing a sentence/).expectVisible();
  await h.clock.advance(24 * HOUR + 60_000);
  await p.reload();
  await p.button('Confirm the change').click();
  await p.label('Sentence').type('I understand that this change loosens my protection.');
  await p.button('Continue', { exact: true, within: 'dialog' }).click();
  await p.text('Change applied.').expectVisible();
  const open = await h.open(internal);
  await sleep(1500);
  expect(await open.isIntervention()).toBe(false);
});

test('a clock set backwards is detected and time does not go back', async ({ h }) => {
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

test('a clock set forward is corrected with the Date of web responses (no extra request)', async ({ h }) => {
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

test('the Password protection is chosen in the editor, asked to loosen the rule and for its breaks', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [
      group('Gambling', ['bet.test', 'casino.test'], [policy(BLOCK)], {
        protection: REMINDER,
        pause: { ...pauseFree, cost: { type: 'password' } },
      }),
      group('News', ['news.test'], [policy(BLOCK)], { protection: REMINDER }),
    ];
  });
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const p = await h.page(`dashboard.html#/groups/${id}?step=protection`);
  await p.role('radio', /^Password/).click();
  await p.label('New password').type('only my sister knows');
  await p.label('Repeat the password').type('only my sister knows');
  await p.button('Save', { exact: true, within: 'dialog' }).click();
  await p.text(/Password set/).expectVisible();
  // From a reminder to a password is stricter: saving applies it at once.
  await p.button('Save changes').click();
  await p.text('Change the protection of Gambling').expectVisible();
  const stored = (await h.rpc('config.get')).config.groups[0];
  expect(stored.protection.hash).toMatch(/^pbkdf2-sha256\$/);
  expect(JSON.stringify(stored)).not.toContain('only my sister knows');

  // Loosening the rule asks for its password, and only for it.
  await openPart(p, 'Sites');
  await p.button('Remove casino.test').click();
  await p.button('Save changes').click();
  await p.text('Type the password of the rule Gambling.').expectVisible();
  await p.label('Password of Gambling').type('wrong');
  await p.button('Continue', { exact: true, within: 'dialog' }).click();
  await p.text('Wrong password.').expectVisible();
  await p.label('Password of Gambling').fill('only my sister knows');
  await p.button('Continue', { exact: true, within: 'dialog' }).click();
  await p.text('Done: your change is applied.').expectVisible();
  await expectAllowed(h, 'http://casino.test/');

  // Another rule keeps its own protection.
  const news = await h.configure((c) => {
    c.groups[1].targets = [];
  });
  expect(news.ticket?.step.type).toBe('confirm');

  // A break of the rule asks for its password.
  const r = await h.rpc('pause.start', { url: 'http://bet.test/', minutes: 5 });
  expect(r.ticket.step).toEqual({ type: 'rulePassword', names: ['Gambling'] });
  expect((await h.rpc('ticket.answer', { id: r.ticket.id, answer: 'only my sister knows' })).status).toBe(
    'done',
  );
  await expectAllowed(h, 'http://bet.test/');
});

/** The code that the partner's app shows now, or `ahead` steps of 30 seconds later. */
async function partnerCode(h: Harness, secret: string, ahead = 0): Promise<string> {
  return totp(secret, timeStep(await h.clock.now()) + ahead);
}

test("the Partner code protection is set up with a code from the partner's app; loosening needs a fresh code", async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [
      group('Social', ['a.test', 'b.test'], [policy(BLOCK)], { protection: REMINDER }),
      group('News', ['news.test'], [policy(BLOCK)], { protection: REMINDER }),
    ];
  });
  const id = (await h.rpc('config.get')).config.groups[0].id;
  const p = await h.page(`dashboard.html#/groups/${id}?step=protection`);
  await p.role('radio', /^Partner code/).click();
  await p.role('heading', 'Set up a partner code for Social').expectVisible();
  await p.role('img', 'QR code for your partner’s authenticator app').expectVisible();
  expect(await p.axe()).toEqual([]);
  const secret = (await p.get('.partner-key').text()).replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await p.label('Code from your partner’s app').fill('000000');
  await p.button('Confirm', { exact: true, within: 'dialog' }).click();
  await p.text(/That code does not match/).expectVisible();
  // Breaks need the partner's code only when asked for.
  const breaks = p.role('checkbox', 'Breaks also need the partner’s code');
  await breaks.expectChecked(false);
  await breaks.click();
  const first = await partnerCode(h, secret);
  await p.label('Code from your partner’s app').fill(first);
  await p.button('Confirm', { exact: true, within: 'dialog' }).click();
  await p.text('Your partner’s app shows the codes for this rule.').expectVisible();
  await p.button('Save changes').click();
  await p.text('Change the protection of Social').expectVisible();
  expect((await h.rpc('config.get')).config.groups[0].protection).toEqual({
    kind: 'partner',
    secret,
    breaks: true,
  });
  // Protection lists it with the rule.
  const protection = await h.page('dashboard.html#/protection');
  await protection.text('Partner code', { exact: true, within: '.list' }).expectVisible();

  // Loosening the rule needs the partner's code; the code used for the setup does not work again.
  await p.front();
  await openPart(p, 'Sites');
  await p.button('Remove b.test').click();
  await p.button('Save changes').click();
  await p.text(/Ask the partner of the rule Social for the code/).expectVisible();
  await p.label('Code from your partner’s app').fill(first);
  await p.button('Continue', { exact: true, within: 'dialog' }).click();
  await p.text(/wrong or already used/).expectVisible();
  await p.label('Code from your partner’s app').fill(await partnerCode(h, secret, 1));
  await p.button('Continue', { exact: true, within: 'dialog' }).click();
  await p.text('Done: your change is applied.').expectVisible();
  await expectAllowed(h, 'http://b.test/');

  // Another rule keeps its own protection.
  const news = await h.configure((c) => {
    c.groups[1].targets = [];
  });
  expect(news.ticket?.step.type).toBe('confirm');

  // Going back to a reminder is a loosening too: it needs another code, half a minute later.
  await h.clock.advance(30_000);
  const cfg = (await h.rpc('config.get')).config;
  cfg.groups[0].protection = REMINDER;
  const r = await h.rpc('config.save', { config: cfg });
  expect(r.ticket.step).toEqual({ type: 'partner', names: ['Social'] });
  const code = await partnerCode(h, secret, 1);
  expect((await h.rpc('ticket.answer', { id: r.ticket.id, answer: code })).status).toBe('done');
  expect((await h.rpc('config.get')).config.groups[0].protection).toEqual(REMINDER);
});

test('the protections of the rules keep their names on a phone-sized screen (regression)', async ({
  h,
  browserName,
}) => {
  await h.configure((c) => {
    c.groups = [
      group('Social media and chats', ['social.test'], [policy(BLOCK)], { protection: REMINDER }),
      group('Games', ['games.test'], [policy(BLOCK)], { protection: wait(24 * 3600) }),
    ];
  });
  const p = await h.page('dashboard.html#/protection');
  for (const width of [1280, 360]) {
    await p.viewport(width, 900);
    if (browserName === 'chromium') expect(await p.eval(() => window.innerWidth)).toBe(width);
    await p.text('Social media and chats', { exact: true }).waitFor('visible');
    // Each name is readable, and Change stays inside the list.
    const rows = await p.eval(() =>
      [...document.querySelectorAll('[aria-label="Protection of your rules"] li')].map((li) => {
        const list = li.parentElement!.getBoundingClientRect();
        const name = li.querySelector('strong')!.getBoundingClientRect();
        const link = li.querySelector('a')!.getBoundingClientRect();
        return { name: Math.round(name.width) > 40, inside: link.right <= list.right + 0.5 };
      }),
    );
    expect(rows, `at ${width}px`).toEqual([
      { name: true, inside: true },
      { name: true, inside: true },
    ]);
    expect(await p.overflowX(), `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
});
