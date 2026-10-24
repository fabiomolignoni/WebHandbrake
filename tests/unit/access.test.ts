import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, Group } from '../../src/engine/types';
import { installFakeBrowser } from './fake-browser';
import { BLOCK, group, lockedUntil, PERMANENT, REMINDER, wait } from './helpers';

/** Few iterations: the tests check the routing, not the cost of guessing. */
const ITERATIONS = 1000;
const HOUR = 3_600_000;

function pausable(g: Group, cost: Group['pause']['cost']): Group {
  g.pause = { ...g.pause, allowed: true, cost };
  return g;
}

/** A rule that restricts nothing right now (its only condition has no time window). */
const idle = (name: string, extra: Partial<Group>) =>
  group(
    name,
    [`${name.toLowerCase()}.test`],
    [{ intervention: BLOCK, schedule: { mode: 'during', windows: [] } }],
    extra,
  );

async function setup(groups: Group[]) {
  // Only the decisions are under test: browser side effects (filters, alarms) are skipped.
  vi.doMock('../../src/background/reconcile', () => ({ reconcile: async () => {} }));
  const { store } = await import('../../src/background/store');
  const protection = await import('../../src/background/protection');
  const tickets = await import('../../src/background/tickets');
  const pauses = await import('../../src/background/pauses');
  const sessions = await import('../../src/background/sessions');
  const crypto = await import('../../src/background/crypto');
  const totp = await import('../../src/background/totp');
  const { compileConfig } = await import('../../src/engine/compile');
  await store.ready();
  store.config = { ...store.config, groups };
  store.cc = compileConfig(store.config);
  const propose = (mutate: (c: Config) => void) => {
    const next = structuredClone(store.config);
    mutate(next);
    return protection.proposeConfig(next, 'test');
  };
  /** The steps of a ticket, in order. */
  const steps = async (id: string | undefined) => (await tickets.getTicket(id ?? ''))?.steps ?? [];
  const types = async (id: string | undefined) => (await steps(id)).map((s) => s.type);
  /** Answers a ticket step by step; the last answer's result is returned. */
  const answer = async (id: string, ...answers: string[]) => {
    let r = { status: 'error' } as Awaited<ReturnType<typeof tickets.answerTicket>>;
    for (const a of answers) r = await tickets.answerTicket(id, a);
    return r;
  };
  const hash = (password: string) => crypto.hashPassword(password, ITERATIONS);
  /** The code of the partner's app now, `ahead` steps later. */
  const code = (secret: string, ahead = 0) => totp.totp(secret, totp.timeStep(Date.now()) + ahead);
  /** A partner code set up for a rule (or a draft) through the dialog's two steps. */
  const partner = async (groupId: string, breaks = true) => {
    const { secret } = await protection.beginPartnerSetup(groupId, 'Rule');
    const r = await protection.verifyPartnerSetup(groupId, await code(secret), breaks);
    if (!('partner' in r)) throw new Error(r.error);
    return r.partner;
  };
  return { store, protection, tickets, pauses, sessions, propose, steps, types, answer, hash, code, partner };
}

describe('the protection of each rule', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });
  afterEach(() => vi.doUnmock('../../src/background/reconcile'));

  it('Reminder asks for a confirmation; a change that loosens nothing applies at once', async () => {
    const t = await setup([
      group('A', ['a.test', 'b.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
    ]);
    const r = await t.propose((c) => c.groups[0].targets.pop());
    expect(await t.steps(r.ticket?.id)).toEqual([{ type: 'confirm' }]);
    expect(await t.answer(r.ticket?.id ?? '', '')).toMatchObject({ status: 'done' });
    expect(t.store.config.groups[0].targets).toHaveLength(1);
    expect((await t.propose((c) => (c.groups[0].name = 'Renamed'))).applied).toHaveLength(1);
  });

  it('a short Wait is spent in the dialog; a long one is a pending change, confirmed once it is over', async () => {
    const t = await setup([
      group('Short', ['short.test'], [{ intervention: BLOCK }], { protection: wait(30) }),
      group('Long', ['long.test'], [{ intervention: BLOCK }], { protection: wait(3600) }),
    ]);
    const short = await t.propose((c) => (c.groups[0].targets = []));
    expect(await t.steps(short.ticket?.id)).toEqual([{ type: 'wait', seconds: 30 }]);
    expect(await t.tickets.answerTicket(short.ticket?.id ?? '', '')).toMatchObject({
      error: 'ticket.error.notYet',
    });

    const long = await t.propose((c) => (c.groups[1].targets = []));
    expect(long.ticket).toBeNull();
    const p = t.store.state.pending[0];
    expect(long.pending?.id).toBe(p.id);
    expect(p.readyAt - p.createdAt).toBe(HOUR);
    expect(await t.protection.confirmPending(p.id)).toEqual({
      ticket: null,
      error: 'pending.error.notReady',
    });
    // An hour later it needs only a confirmation.
    t.store.state.clockOffset = HOUR + 1000;
    const confirm = await t.protection.confirmPending(p.id);
    expect(await t.steps(confirm.ticket?.id)).toEqual([{ type: 'confirm' }]);
    expect(await t.answer(confirm.ticket?.id ?? '', '')).toMatchObject({ status: 'done' });
    expect(t.store.config.groups[1].targets).toEqual([]);
  });

  it('Locked refuses every loosening until its date, then asks only for a reminder', async () => {
    const until = Date.now() + 2 * 24 * HOUR;
    const t = await setup([
      group('A', ['a.test'], [{ intervention: BLOCK }], { protection: lockedUntil(until) }),
    ]);
    expect((await t.propose((c) => (c.groups[0].enabled = false))).refused).toMatchObject({
      reason: 'locked',
      until,
    });
    // Stricter changes still apply.
    const add = await t.propose((c) =>
      c.groups[0].targets.push({ id: 'x', type: 'domain', value: 'b.test' }),
    );
    expect(add.applied).toHaveLength(1);
    t.store.state.clockOffset = 2 * 24 * HOUR + 1000;
    expect((await t.propose((c) => (c.groups[0].enabled = false))).ticket?.step.type).toBe('confirm');
  });

  it('Permanent refuses every loosening, with no date, even years later', async () => {
    const t = await setup([idle('Bets', { protection: PERMANENT })]);
    for (const loosen of [
      (c: Config) => (c.groups[0].targets = []),
      (c: Config) => (c.groups[0].enabled = false),
      (c: Config) => (c.groups[0].protection = lockedUntil(Date.now() + HOUR)),
      (c: Config) => (c.settings.dayStart = 240),
    ]) {
      const r = await t.propose(loosen);
      expect(r.refused).toMatchObject({ reason: 'permanent', until: null });
      expect(r.ticket).toBeNull();
      expect(r.pending).toBeNull();
    }
    t.store.state.clockOffset = 10 * 365 * 24 * HOUR;
    expect((await t.propose((c) => (c.groups[0].targets = []))).refused?.reason).toBe('permanent');
  });

  it('a change to several rules takes what each asks: a refusal first, then secrets and the longest wait', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
      group('B', ['b.test'], [{ intervention: BLOCK }], { protection: wait(30) }),
      group('C', ['c.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
    ]);
    t.store.config.groups[2].protection = { kind: 'password', hash: await t.hash('pw-c') };
    const day = await t.propose((c) => (c.settings.dayStart = 240));
    expect(await t.steps(day.ticket?.id)).toEqual([
      { type: 'rulePassword', groups: ['C'], names: ['C'] },
      { type: 'wait', seconds: 30 },
    ]);
    // A long wait among them: a pending change.
    t.store.config.groups[1].protection = wait(86_400);
    const pending = await t.propose((c) => (c.settings.dayStart = 240));
    expect((pending.pending?.readyAt ?? 0) - (pending.pending?.createdAt ?? 0)).toBe(24 * HOUR);
    // A Locked rule among them: refused.
    t.store.config.groups[0].protection = lockedUntil(Date.now() + HOUR);
    expect((await t.propose((c) => (c.settings.dayStart = 240))).refused?.reason).toBe('locked');
  });

  it('Permanent wins over Locked when a change loosens both; Locked gives its last date', async () => {
    const early = Date.now() + 1000 * HOUR;
    const late = Date.now() + 2000 * HOUR;
    const t = await setup([
      group('Early', ['early.test'], [{ intervention: BLOCK }], { protection: lockedUntil(early) }),
      group('Late', ['late.test'], [{ intervention: BLOCK }], { protection: lockedUntil(late) }),
      group('Forever', ['forever.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
    ]);
    expect((await t.propose((c) => (c.settings.dayStart = 240))).refused).toMatchObject({
      reason: 'locked',
      until: late,
    });
    t.store.config.groups[2].protection = PERMANENT;
    expect((await t.propose((c) => (c.settings.dayStart = 240))).refused).toMatchObject({
      reason: 'permanent',
      until: null,
    });
  });

  it('a firmer protection applies at once; any other change of protection costs the current one', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER })]);
    const set = (p: Group['protection']) => t.propose((c) => (c.groups[0].protection = p));
    expect((await set(wait(60))).applied).toHaveLength(1);
    // A shorter wait costs the current wait.
    expect(await t.steps((await set(wait(10))).ticket?.id)).toEqual([{ type: 'wait', seconds: 60 }]);
    const pw = { kind: 'password', hash: await t.hash('pw') } as const;
    // A wait and a password cannot be compared: the current wait is the cost.
    expect(await t.steps((await set(pw)).ticket?.id)).toEqual([{ type: 'wait', seconds: 60 }]);
    t.store.config.groups[0].protection = pw;
    expect(await t.types((await set(REMINDER)).ticket?.id)).toEqual(['rulePassword']);
    expect((await set(lockedUntil(Date.now() + HOUR))).applied).toHaveLength(1);
    expect((await set(PERMANENT)).applied).toHaveLength(1);
    expect((await set(REMINDER)).refused?.reason).toBe('permanent');
    // A rule that is off restricts nothing: its protection changes freely.
    t.store.config.groups[0].enabled = false;
    expect((await set(REMINDER)).applied).toHaveLength(1);
  });

  it('by default the browser pages are blocked while a firm rule restricts, not for a short wait', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: wait(30) })]);
    expect(t.store.config.settings.protection.internalPages).toBe('auto');
    const { internalPagesBlocked } = await import('../../src/background/enforce');
    expect(internalPagesBlocked()).toBe(false);
    const firm: Group['protection'][] = [
      wait(3600),
      PERMANENT,
      lockedUntil(Date.now() + HOUR),
      { kind: 'password', hash: 'h' },
    ];
    for (const p of firm) {
      t.store.config.groups[0].protection = p;
      expect(internalPagesBlocked(), p.kind).toBe(true);
    }
  });

  it('the emergency exit sets every rule to Reminder, passwords and partner codes included', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ intervention: BLOCK }], { protection: PERMANENT }),
      group('B', ['b.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
      group('C', ['c.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
    ]);
    t.store.config.groups[1].protection = { kind: 'password', hash: await t.hash('pw') };
    t.store.config.groups[2].protection = await t.partner('C');
    await t.protection.requestEmergency();
    if (t.store.state.emergency) t.store.state.emergency.readyAt = 0;
    const start = await t.protection.startEmergency();
    expect(await t.answer(start.ticket?.id ?? '', t.protection.emergencyPhrase())).toMatchObject({
      status: 'done',
    });
    expect(t.store.config.groups.map((g) => g.protection)).toEqual([REMINDER, REMINDER, REMINDER]);
    expect((await t.propose((c) => (c.groups[0].targets = []))).ticket?.step.type).toBe('confirm');
  });
});

describe('changes that follow the emergency exit', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });
  afterEach(() => vi.doUnmock('../../src/background/reconcile'));

  it('loosening a setting of the protection waits the hours of the emergency exit, then takes a sentence', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: PERMANENT })]);
    expect(t.store.config.settings.protection.internalPages).toBe('auto');
    // Stricter is immediate, as always.
    expect((await t.propose((c) => (c.settings.protection.internalPages = 'always'))).applied).toHaveLength(
      1,
    );
    const r = await t.propose((c) => (c.settings.protection.internalPages = 'never'));
    // Permanent refuses the rule's own loosening, not this one.
    expect(r.refused).toBeNull();
    expect(r.ticket).toBeNull();
    const p = r.pending;
    expect(p).toMatchObject({ emergency: true });
    expect((p?.readyAt ?? 0) - (p?.createdAt ?? 0)).toBe(24 * HOUR);
    expect(await t.protection.confirmPending(p?.id ?? '')).toEqual({
      ticket: null,
      error: 'pending.error.notReady',
    });
    t.store.state.clockOffset = 24 * HOUR + 1000;
    const confirm = await t.protection.confirmPending(p?.id ?? '');
    const phrase = t.protection.pendingPhrase();
    expect(await t.steps(confirm.ticket?.id)).toEqual([{ type: 'phrase', phrase }]);
    expect(await t.answer(confirm.ticket?.id ?? '', phrase)).toMatchObject({ status: 'done' });
    expect(t.store.config.settings.protection.internalPages).toBe('never');
    // Only that change followed the emergency exit: the rule keeps its protection.
    expect(t.store.config.groups[0].protection).toEqual(PERMANENT);
  });

  it('with Reminder rules too; the other settings follow the rules, and nothing waits without an active rule', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER })]);
    t.store.config.settings.protection.emergencyHours = 48;
    for (const mutate of [
      (c: Config) => (c.settings.clock.useDateHeaders = false),
      (c: Config) => (c.settings.protection.internalPagesFollowPause = true),
      // Shortening the wait waits as long as it does now.
      (c: Config) => (c.settings.protection.emergencyHours = 4),
    ]) {
      const r = await t.propose(mutate);
      expect(r.pending).toMatchObject({ emergency: true });
      expect((r.pending?.readyAt ?? 0) - (r.pending?.createdAt ?? 0)).toBe(48 * HOUR);
    }
    expect(await t.steps((await t.propose((c) => (c.settings.dayStart = 240))).ticket?.id)).toEqual([
      { type: 'confirm' },
    ]);
    t.store.config.groups[0].enabled = false;
    expect((await t.propose((c) => (c.settings.clock.useDateHeaders = false))).applied).toHaveLength(1);
  });
});

describe('the Password protection', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });
  afterEach(() => vi.doUnmock('../../src/background/reconcile'));

  it('is hashed in the background; choosing it is stricter; loosening asks for it, once when shared', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
      group('B', ['b.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
    ]);
    const { hash } = await t.protection.passwordHash('only my sister knows');
    expect(hash).toMatch(/^pbkdf2-sha256\$600000\$/);
    expect(hash).not.toContain('only my sister knows');
    const shared = { kind: 'password', hash: await t.hash('pw') } as const;
    const set = await t.propose((c) => {
      c.groups[0].protection = shared;
      c.groups[1].protection = shared;
    });
    expect(set.applied).toHaveLength(2);
    const r = await t.propose((c) => (c.groups[0].targets = []));
    expect(r.ticket?.step).toEqual({ type: 'rulePassword', names: ['A'] });
    expect(await t.tickets.answerTicket(r.ticket?.id ?? '', 'nope')).toMatchObject({
      error: 'ticket.error.wrongPassword',
    });
    expect(await t.answer(r.ticket?.id ?? '', 'pw')).toMatchObject({ status: 'done' });
    expect(t.store.config.groups[0].targets).toEqual([]);
    // A setting loosens both rules: their shared password is asked once.
    const day = await t.propose((c) => (c.settings.dayStart = 240));
    expect(await t.steps(day.ticket?.id)).toEqual([
      { type: 'rulePassword', groups: ['A', 'B'], names: ['A', 'B'] },
    ]);
    // Another password is a loosening that needs the current one.
    const other = { kind: 'password', hash: await t.hash('other') } as const;
    expect(await t.types((await t.propose((c) => (c.groups[0].protection = other))).ticket?.id)).toEqual([
      'rulePassword',
    ]);
  });

  it("a break that costs a password asks for the rule's own, or a long code without one", async () => {
    const t = await setup([
      pausable(group('A', ['a.test', 'both.test'], [{ intervention: BLOCK }]), { type: 'password' }),
      pausable(group('B', ['b.test', 'both.test'], [{ intervention: BLOCK }]), { type: 'password' }),
    ]);
    t.store.config.groups[0].protection = { kind: 'password', hash: await t.hash('pw-a') };
    const own = await t.pauses.startPause({ groupId: 'A', minutes: 5 });
    expect(await t.steps(own.ticket?.id)).toEqual([{ type: 'rulePassword', groups: ['A'], names: ['A'] }]);
    const none = await t.pauses.startPause({ groupId: 'B', minutes: 5 });
    expect(await t.steps(none.ticket?.id)).toEqual([{ type: 'text', length: 32 }]);
    // A break on a page of both rules covers both.
    const both = await t.pauses.startPause({ url: 'https://both.test/', minutes: 5 });
    expect(await t.types(both.ticket?.id)).toEqual(['rulePassword', 'text']);
    expect(await t.answer(own.ticket?.id ?? '', 'pw-a')).toMatchObject({ status: 'done' });
  });

  it('exports without secrets, shared rules and merged imports carry none; restoring takes them back', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ intervention: BLOCK }]),
      group('B', ['b.test'], [{ intervention: BLOCK }]),
    ]);
    t.store.config.groups[0].protection = { kind: 'password', hash: await t.hash('pw-a') };
    t.store.config.groups[1].protection = await t.partner('B', false);
    const { exportData } = await import('../../src/background/data');
    const { detectAndImport, exportGroup, mergeImport } = await import('../../src/engine/importers');
    const plain = (await exportData(false, false)).text;
    expect(JSON.parse(plain).config.groups.map((g: Group) => g.protection)).toEqual([
      { kind: 'password' },
      { kind: 'partner', breaks: false },
    ]);
    const full = (await exportData(false, true)).text;
    const current = t.store.config.groups.map((g) => g.protection);
    expect((JSON.parse(full).config as Config).groups.map((g) => g.protection)).toEqual(current);
    expect(JSON.parse(exportGroup(t.store.config, 'A') ?? '{}').group.protection).toEqual({
      kind: 'password',
    });
    // Restoring an export without secrets takes them from the rules it replaces.
    const restored = mergeImport(
      t.store.config,
      detectAndImport(plain, Date.now(), t.store.config),
      'replace',
    );
    expect(restored.groups.map((g) => g.protection)).toEqual(current);
    // Without them (another device), the rules ask for a reminder: replacing is then a loosening.
    const elsewhere = mergeImport(t.store.config, detectAndImport(plain), 'replace');
    expect(elsewhere.groups.map((g) => g.protection)).toEqual([REMINDER, REMINDER]);
    // A rule from a file never brings a secret that the person does not know.
    const merged = mergeImport(t.store.config, detectAndImport(full), 'merge');
    expect(merged.groups.slice(2).map((g) => g.protection)).toEqual([REMINDER, REMINDER]);
  });
});

describe('the Partner code protection', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });
  afterEach(() => vi.doUnmock('../../src/background/reconcile'));

  it("is set up with the code that the partner's app shows, for the rule or the draft it was started for", async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    const started = await t.protection.beginPartnerSetup('A');
    expect(started.uri).toBe(`otpauth://totp/WebHandbrake%3AA?secret=${started.secret}&issuer=WebHandbrake`);
    const { secret, uri } = await t.protection.beginPartnerSetup('draft', 'Gambling');
    expect(uri).toContain('WebHandbrake%3AGambling?');
    expect(await t.protection.verifyPartnerSetup('draft', '000000', true)).toHaveProperty('error');
    expect(await t.protection.verifyPartnerSetup('other', await t.code(secret), true)).toHaveProperty(
      'error',
    );
    expect(await t.protection.verifyPartnerSetup('draft', await t.code(secret), false)).toEqual({
      partner: { kind: 'partner', secret, breaks: false },
    });
    // The setup is used up.
    expect(await t.protection.verifyPartnerSetup('draft', await t.code(secret, 1), false)).toHaveProperty(
      'error',
    );
  });

  it("loosening needs a fresh code, each accepted once; another partner needs the current one's", async () => {
    const t = await setup([
      group('A', ['a.test', 'b.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
      group('B', ['c.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
    ]);
    const p = await t.partner('A');
    expect((await t.propose((c) => (c.groups[0].protection = p))).applied).toHaveLength(1);
    const r = await t.propose((c) => c.groups[0].targets.pop());
    expect(r.ticket?.step).toEqual({ type: 'partner', names: ['A'] });
    // The code typed during the setup was spent there.
    expect(await t.tickets.answerTicket(r.ticket?.id ?? '', await t.code(p.secret))).toMatchObject({
      error: 'ticket.error.partnerCode',
    });
    const next = await t.code(p.secret, 1);
    expect(await t.answer(r.ticket?.id ?? '', next)).toMatchObject({ status: 'done' });
    // That code cannot be used again.
    const again = await t.propose((c) => (c.groups[0].targets = []));
    expect(await t.tickets.answerTicket(again.ticket?.id ?? '', next)).toMatchObject({ status: 'error' });
    await t.tickets.cancelTicket(again.ticket?.id ?? '');
    // Another rule, and a change that loosens nothing, need no code.
    expect((await t.propose((c) => (c.groups[1].targets = []))).ticket?.step.type).toBe('confirm');
    expect((await t.propose((c) => (c.settings.theme = 'dark'))).applied).toHaveLength(1);
    // Another partner, or no longer asking the code for breaks, needs the current partner's code.
    const other = await t.partner('A');
    expect(await t.types((await t.propose((c) => (c.groups[0].protection = other))).ticket?.id)).toEqual([
      'partner',
    ]);
    const noBreaks = await t.propose((c) => (c.groups[0].protection = { ...p, breaks: false }));
    expect(await t.types(noBreaks.ticket?.id)).toEqual(['partner']);
  });

  it("the rule's breaks need it unless turned off, and so do pending changes; ending a focus session does not", async () => {
    const t = await setup([
      pausable(group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER }), {
        type: 'confirm',
      }),
      pausable(group('B', ['b.test'], [{ intervention: BLOCK }], { protection: REMINDER }), {
        type: 'confirm',
      }),
      idle('Long', { protection: wait(3600) }),
    ]);
    const p = await t.partner('A');
    t.store.config.groups[0].protection = p;
    const brk = await t.pauses.startPause({ groupId: 'A', minutes: 5 });
    expect(await t.types(brk.ticket?.id)).toEqual(['confirm', 'partner']);
    const other = await t.pauses.startPause({ groupId: 'B', minutes: 5 });
    expect(await t.types(other.ticket?.id)).toEqual(['confirm']);
    t.store.config.groups[0].protection = { ...p, breaks: false };
    const free = await t.pauses.startPause({ groupId: 'A', minutes: 5 });
    expect(await t.types(free.ticket?.id)).toEqual(['confirm']);

    const session = await t.sessions.startSession({
      kind: 'groups',
      groups: ['A'],
      allow: [],
      minutes: 60,
      locked: false,
      noPauses: false,
    } as never);
    expect(await t.types((await t.sessions.endSession(session.id)).ticket?.id)).toEqual(['confirm']);

    // A setting loosens the partner's rule and the rule with a long wait: a pending change, whose
    // confirmation needs the partner's code.
    t.store.state.sessions = [];
    const r = await t.propose((c) => (c.settings.dayStart = 240));
    const pending = t.store.state.pending.find((x) => x.id === r.pending?.id);
    if (pending) pending.createdAt = pending.readyAt = 0;
    const confirm = await t.protection.confirmPending(r.pending?.id ?? '');
    expect(await t.types(confirm.ticket?.id)).toEqual(['partner', 'confirm']);
  });
});

describe('costs are checked again when they are paid', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });
  afterEach(() => vi.doUnmock('../../src/background/reconcile'));

  it('a cost paid for one rule does not apply a change that now loosens a Locked rule (regression)', async () => {
    const t = await setup([
      group('S', ['s.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
      group('R', ['r.test'], [{ intervention: BLOCK }], {
        protection: lockedUntil(Date.now() + HOUR),
        enabled: false,
      }),
    ]);
    // A setting touches the active rules, S only: a confirmation.
    const r = await t.propose((c) => (c.settings.dayStart = 240));
    expect(r.ticket?.step.type).toBe('confirm');
    // Meanwhile, in another tab, the Locked rule is turned on (stricter).
    expect((await t.propose((c) => (c.groups[1].enabled = true))).applied).toHaveLength(1);
    expect(await t.tickets.answerTicket(r.ticket?.id ?? '', '')).toMatchObject({
      status: 'error',
      error: 'ticket.error.changed',
    });
    expect(t.store.config.settings.dayStart).toBe(0);
  });

  it('a requirement added after the cost was shown is asked before anything applies', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER })]);
    const r = await t.propose((c) => (c.groups[0].targets = []));
    t.store.config.groups[0].protection = { kind: 'password', hash: await t.hash('pw-a') };
    expect(await t.tickets.answerTicket(r.ticket?.id ?? '', '')).toMatchObject({
      error: 'ticket.error.changed',
    });
    expect(t.store.config.groups[0].targets).toHaveLength(1);
    // A fresh proposal asks for the password.
    expect((await t.propose((c) => (c.groups[0].targets = []))).ticket?.step.type).toBe('rulePassword');
  });

  it('a password shared by several rules, typed once, still covers the rules left after a change made elsewhere', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ intervention: BLOCK }]),
      group('B', ['b.test'], [{ intervention: BLOCK }]),
    ]);
    const shared = { kind: 'password', hash: await t.hash('pw-shared') } as const;
    t.store.config.groups[0].protection = shared;
    t.store.config.groups[1].protection = shared;
    const r = await t.propose((c) => {
      c.groups[0].targets = [];
      c.groups[1].targets = [];
    });
    expect(await t.steps(r.ticket?.id)).toEqual([
      { type: 'rulePassword', groups: ['A', 'B'], names: ['A', 'B'] },
    ]);
    // Meanwhile, in another tab, the site of A is removed: only the change to B is left.
    t.store.config = structuredClone(t.store.config);
    t.store.config.groups[0].targets = [];
    expect(await t.answer(r.ticket?.id ?? '', 'pw-shared')).toMatchObject({ status: 'done' });
    expect(t.store.config.groups[1].targets).toEqual([]);
  });

  it('changes made in the same save (a new rule) do not count as changes made elsewhere', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER })]);
    const r = await t.propose((c) => {
      c.groups.push(group('New', ['new.test'], [{ intervention: BLOCK }], { protection: PERMANENT }));
      c.settings.dayStart = 240;
    });
    // The rule applies at once; the setting costs what the rules in force asked.
    expect(r.applied.map((u) => u.kind)).toEqual(['group.add']);
    expect(await t.answer(r.ticket?.id ?? '', '')).toMatchObject({ status: 'done' });
    expect(t.store.config.settings.dayStart).toBe(240);
  });

  it('a pending change follows a firmer protection chosen since: a longer wait, Locked, Permanent', async () => {
    const t = await setup([idle('S', { protection: wait(3600) })]);
    const r = await t.propose((c) => (c.groups[0].targets = []));
    const p = t.store.state.pending[0];
    expect(r.pending?.id).toBe(p.id);
    t.store.state.clockOffset = HOUR + 1000;
    // A longer wait counts from the request.
    t.store.config.groups[0].protection = wait(2 * 3600);
    expect(await t.protection.confirmPending(p.id)).toEqual({
      ticket: null,
      error: 'pending.error.notReady',
    });
    t.store.config.groups[0].protection = lockedUntil(Date.now() + 10 * HOUR);
    expect(await t.protection.confirmPending(p.id)).toEqual({ ticket: null, error: 'pending.error.locked' });
    t.store.config.groups[0].protection = PERMANENT;
    expect(await t.protection.confirmPending(p.id)).toEqual({
      ticket: null,
      error: 'pending.error.permanent',
    });
    // And it is checked again at the last step.
    t.store.config.groups[0].protection = wait(3600);
    const confirm = await t.protection.confirmPending(p.id);
    t.store.config.groups[0].protection = PERMANENT;
    expect(await t.answer(confirm.ticket?.id ?? '', '')).toMatchObject({ error: 'pending.error.permanent' });
    expect(t.store.config.groups[0].targets).toHaveLength(1);
  });

  it('a session ended with a confirmation does not depend on the protection of its rules', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER })]);
    const s = await t.sessions.startSession({
      kind: 'groups',
      groups: ['A'],
      allow: [],
      minutes: 60,
      locked: false,
      noPauses: false,
    } as never);
    const end = await t.sessions.endSession(s.id);
    expect(end.ticket?.step.type).toBe('confirm');
    t.store.config.groups[0].protection = PERMANENT;
    expect(await t.answer(end.ticket?.id ?? '', '')).toMatchObject({ status: 'done' });
    expect(t.store.state.sessions[0].endAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('every rule on a page', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });
  afterEach(() => vi.doUnmock('../../src/background/reconcile'));

  const TAB = { tab: { id: 1, incognito: false } } as never;
  const URL = 'https://video.test/watch';
  const MIN = 60_000;

  /** Rules that each ask something on video.test; the challenge's access lasts 90 minutes. */
  const rules = () => [
    group(
      'Wait',
      ['video.test'],
      [{ intervention: { type: 'delay', seconds: 1800, grant: { scope: 'page', mode: 'visit' } } }],
    ),
    group(
      'Quick',
      ['video.test'],
      [
        {
          intervention: {
            type: 'challenge',
            kind: 'math',
            grant: { scope: 'group', mode: 'minutes', minutes: 90 },
          },
        },
      ],
    ),
    group(
      'Same',
      ['video.test'],
      [
        {
          intervention: {
            type: 'delay',
            seconds: 5,
            grant: { scope: 'group', mode: 'minutes', minutes: 1440 },
          },
        },
      ],
    ),
  ];

  /** Whether every rule now lets the page through. */
  async function open() {
    const { decideUrl } = await import('../../src/background/engine');
    const { isNav } = await import('../../src/engine/severity');
    return !isNav(decideUrl(URL, false));
  }

  /** Passes the intervention shown, as a person would: waits are waited, sums are worked out. */
  async function pass(t: Awaited<ReturnType<typeof setup>>, ticketId: string | undefined, lateMs = 0) {
    const ticket = await t.tickets.getTicket(ticketId ?? '');
    if (!ticket) throw new Error('no ticket');
    const step = ticket.steps[ticket.index];
    if (step.type === 'wait') t.store.state.clockOffset += step.seconds * 1000 + lateMs;
    expect(await t.answer(ticket.id, step.type === 'math' ? String(ticket.active.answer) : '')).toMatchObject(
      {
        status: 'done',
      },
    );
    return ticket;
  }

  it('each rule asks in turn, the strictest first; the page opens once every rule has let it through', async () => {
    const t = await setup(rules());
    const { interventionModel } = await import('../../src/background/intervention');
    const shown: string[] = [];
    expect((await interventionModel(URL, TAB)).others.map((o) => o.name)).toEqual(['Wait', 'Same']);
    while (!(await open()) && shown.length < 5) {
      const m = await interventionModel(URL, TAB);
      shown.push(`${m.group?.name} ${m.kind}`);
      const ticket = await pass(t, m.ticket?.id);
      // The access opens only the rule shown: a quick sum never opens a long wait.
      expect(ticket.purpose.kind === 'pass' && ticket.purpose.groups).toEqual([m.group?.id]);
    }
    expect(shown).toEqual(['Quick challenge', 'Wait delay', 'Same delay']);
    // The 90 minutes of the sum start when the page opens, not half an hour earlier.
    const at = Date.now() + t.store.state.clockOffset;
    const quick = t.store.state.grants.find((g) => g.kind === 'pass' && g.groups.includes('Quick'));
    expect(quick?.until).toBeGreaterThan(at + 89 * MIN);
  });

  it('an access already used does not start again', async () => {
    const t = await setup(rules());
    const { interventionModel } = await import('../../src/background/intervention');
    const { usageKeys } = await import('../../src/engine/usage');
    const first = await interventionModel(URL, TAB);
    await pass(t, first.ticket?.id);
    // The sum's access opened the rule's other sites, and time was counted there.
    const used = Date.now() + t.store.state.clockOffset + 1000;
    t.store.state.activity[usageKeys.group('Quick')] = { last: used };
    const quick = t.store.state.grants.find((g) => g.kind === 'pass' && g.groups.includes('Quick'));
    const until = quick?.until;
    for (let i = 0; i < 2; i++) await pass(t, (await interventionModel(URL, TAB)).ticket?.id);
    expect(await open()).toBe(true);
    expect(quick?.until).toBe(until);
  });

  it('a wait of an hour or more can still be completed (regression)', async () => {
    const t = await setup([
      group(
        'Long',
        ['video.test'],
        [{ intervention: { type: 'delay', seconds: 3600, grant: { scope: 'site', mode: 'visit' } } }],
      ),
    ]);
    const { interventionModel } = await import('../../src/background/intervention');
    // Continue is clicked a little after the hour.
    await pass(t, (await interventionModel(URL, TAB)).ticket?.id, 30_000);
    expect(await open()).toBe(true);
  });

  it('a break is offered only when it can open the page', async () => {
    const free = pausable(group('Breaks', ['video.test'], [{ intervention: BLOCK }]), { type: 'none' });
    const strict = group('Strict', ['video.test'], [{ intervention: BLOCK }]);
    strict.pause = { ...strict.pause, allowed: false };
    const t = await setup([free, strict]);
    const { interventionModel } = await import('../../src/background/intervention');
    const { compileConfig } = await import('../../src/engine/compile');
    const m = await interventionModel(URL, TAB);
    expect(m.group?.id).toBe('Breaks');
    expect(m.others.map((o) => o.id)).toEqual(['Strict']);
    expect(m.pause).toMatchObject({ available: false, reason: 'pause.unavailable.otherRule' });
    // A wait of the other rule still lets a break help: the wait comes next.
    t.store.config.groups[1].policies[0].intervention = {
      type: 'delay',
      seconds: 5,
      grant: { scope: 'site', mode: 'visit' },
    };
    t.store.cc = compileConfig(t.store.config);
    expect((await interventionModel(URL, TAB)).pause?.available).toBe(true);
  });
});

describe('guessing passwords and partner codes', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });
  afterEach(() => vi.doUnmock('../../src/background/reconcile'));

  it('wrong answers are counted across tickets: a new cost does not start a new count', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    t.store.config.groups[0].protection = { kind: 'password', hash: await t.hash('pw-a') };
    const loosen = async () => (await t.propose((c) => (c.groups[0].targets = []))).ticket?.id ?? '';
    for (let i = 0; i < 4; i++)
      expect(await t.tickets.answerTicket(await loosen(), 'guess')).toMatchObject({
        error: 'ticket.error.wrongPassword',
      });
    // A right answer resets the count.
    expect(await t.tickets.answerTicket(await loosen(), 'pw-a')).toMatchObject({ status: 'done' });
    t.store.config.groups[0].targets = [{ id: 'a', type: 'domain', value: 'a.test' }];
    for (let i = 0; i < 5; i++) await t.tickets.answerTicket(await loosen(), 'guess');
    // The fifth wrong answer locks every password and partner code, even in a new ticket.
    expect(await t.tickets.answerTicket(await loosen(), 'pw-a')).toMatchObject({
      error: 'ticket.error.tooManySecrets',
    });
    expect(t.store.state.secretFailures.lockedUntil).toBeGreaterThan(Date.now());
  });

  it('a stored hash that declares too many iterations is never checked', async () => {
    const { verifyPassword } = await import('../../src/background/crypto');
    const { normalizeConfig } = await import('../../src/engine/schema');
    const { defaultConfig } = await import('../../src/engine/defaults');
    const huge = 'pbkdf2-sha256$999999999$c2FsdA==$aGFzaA==';
    const started = performance.now();
    expect(await verifyPassword('anything', huge)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
    const raw = defaultConfig() as unknown as Record<string, any>;
    raw.groups = [
      { id: 'g', name: 'G', targets: [], policies: [], protection: { kind: 'password', hash: huge } },
    ];
    expect(normalizeConfig(raw).config.groups[0].protection).toEqual(REMINDER);
    // Nor is a password of an earlier version that a rule would take over.
    raw.settings.protection.access = { passwordHash: huge };
    raw.groups = [{ id: 'g', name: 'G', targets: [], policies: [], passwordHash: huge, protection: 'soft' }];
    expect(normalizeConfig(raw).config.groups[0].protection).toEqual(REMINDER);
  });
});
