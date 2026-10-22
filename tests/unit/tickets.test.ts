import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TICKET_LOCK_MS, TICKET_MAX_FAILURES, TICKET_TTL_MS } from '../../src/engine/limits';
import { installFakeBrowser } from './fake-browser';

const T0 = new Date(2026, 9, 5, 10).getTime();

async function load() {
  const { store } = await import('../../src/background/store');
  const tickets = await import('../../src/background/tickets');
  await store.ready();
  const done: unknown[] = [];
  tickets.registerExecutor('session.end', async (t) => {
    done.push(t.purpose);
    return 'ok';
  });
  const purpose = { kind: 'session.end' as const, id: 's' };
  return { store, tickets, done, purpose };
}

describe('tickets: costs checked in the background', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    installFakeBrowser();
  });
  afterEach(() => vi.useRealTimers());

  it('without steps the purpose runs at once', async () => {
    const { tickets, done, purpose } = await load();
    expect(await tickets.createTicket(purpose, [])).toEqual({ view: null, result: 'ok' });
    expect(done).toEqual([purpose]);
  });

  it('a wait cannot be answered early; the last step runs the purpose once', async () => {
    const { tickets, done, purpose } = await load();
    const { view } = await tickets.createTicket(purpose, [
      { type: 'wait', seconds: 30 },
      { type: 'confirm' },
    ]);
    expect(view).toMatchObject({
      purpose: 'session.end',
      stepIndex: 0,
      stepCount: 2,
      step: { type: 'wait', readyAt: T0 + 30_000 },
    });
    expect(await tickets.answerTicket(view!.id, '')).toMatchObject({
      status: 'error',
      error: 'ticket.error.notYet',
    });
    vi.setSystemTime(T0 + 30_000);
    expect(await tickets.answerTicket(view!.id, '')).toMatchObject({
      status: 'next',
      ticket: { stepIndex: 1 },
    });
    expect(await tickets.answerTicket(view!.id, '')).toEqual({ status: 'done', result: 'ok' });
    expect(done).toHaveLength(1);
    expect(await tickets.answerTicket(view!.id, '')).toEqual({
      status: 'error',
      error: 'ticket.error.expired',
    });
  });

  it('typed codes, phrases and sums; the code is never in the step shown', async () => {
    const { tickets, purpose } = await load();
    const { view } = await tickets.createTicket(purpose, [
      { type: 'text', length: 12 },
      { type: 'phrase', phrase: 'I  choose to  wait' },
      { type: 'math' },
    ]);
    const ticket = await tickets.getTicket(view!.id);
    const code = ticket!.active.text!;
    expect(code).toMatch(/^[A-HJ-NP-Za-km-z2-9]{12}$/);
    expect(view!.step).toEqual({ type: 'text', text: code, length: 12 });
    expect(await tickets.answerTicket(view!.id, `${code}x`)).toMatchObject({
      error: 'ticket.error.mismatch',
    });
    expect(await tickets.answerTicket(view!.id, code)).toMatchObject({ status: 'next' });
    // Phrases ignore case and repeated spaces.
    expect(await tickets.answerTicket(view!.id, ' i choose TO wait ')).toMatchObject({ status: 'next' });
    const math = await tickets.getTicket(view!.id);
    expect(math!.active.question).toMatch(/^\d+ [+\-×] \d+$/);
    expect(await tickets.answerTicket(view!.id, String(math!.active.answer! + 1))).toMatchObject({
      error: 'ticket.error.wrongAnswer',
    });
    expect(await tickets.answerTicket(view!.id, ` ${math!.active.answer} `)).toMatchObject({
      status: 'done',
    });
  });

  it('wrong answers in a row lock the ticket for a while', async () => {
    const { tickets, purpose } = await load();
    const { view } = await tickets.createTicket(purpose, [{ type: 'phrase', phrase: 'yes' }]);
    for (let i = 0; i < TICKET_MAX_FAILURES; i++) await tickets.answerTicket(view!.id, 'no');
    expect(await tickets.answerTicket(view!.id, 'yes')).toMatchObject({ error: 'ticket.error.tooMany' });
    vi.setSystemTime(T0 + TICKET_LOCK_MS);
    expect(await tickets.answerTicket(view!.id, 'yes')).toMatchObject({ status: 'done' });
  });

  it('a reason long enough and minutes to go in', async () => {
    const { tickets, purpose } = await load();
    const { view } = await tickets.createTicket(purpose, [
      { type: 'intention', choices: [5, 10], maxMinutes: 20, seconds: 5, minLength: 4 },
    ]);
    expect(view!.step).toMatchObject({ type: 'intention', minLength: 4 });
    expect(await tickets.answerTicket(view!.id, 'x', 5)).toMatchObject({ error: 'ticket.error.notYet' });
    vi.setSystemTime(T0 + 5000);
    expect(await tickets.answerTicket(view!.id, '', 5)).toMatchObject({
      error: 'ticket.error.intentionRequired',
    });
    // Spaces around the reason do not count.
    expect(await tickets.answerTicket(view!.id, '  new  ', 5)).toMatchObject({
      error: 'ticket.error.intentionShort',
    });
    expect(await tickets.answerTicket(view!.id, 'news', 21)).toMatchObject({ error: 'ticket.error.minutes' });
    expect(await tickets.answerTicket(view!.id, 'news', 0)).toMatchObject({ error: 'ticket.error.minutes' });
    const t = await tickets.getTicket(view!.id);
    expect(await tickets.answerTicket(view!.id, 'news', 17)).toMatchObject({ status: 'done' });
    expect(t!.collected).toEqual({ intention: 'news', minutes: 17 });
  });

  it('expires an hour after its waits; can be cancelled', async () => {
    const { tickets, purpose } = await load();
    const a = (await tickets.createTicket(purpose, [{ type: 'wait', seconds: 600 }])).view!;
    const b = (await tickets.createTicket(purpose, [{ type: 'confirm' }])).view!;
    vi.setSystemTime(T0 + TICKET_TTL_MS + 1);
    expect(await tickets.getTicket(b.id)).toBeUndefined();
    expect(await tickets.getTicket(a.id)).toBeDefined();
    await tickets.cancelTicket(a.id);
    expect(await tickets.getTicket(a.id)).toBeUndefined();
  });

  it('survives a restart of the background, from session storage', async () => {
    const first = await load();
    const { view } = await first.tickets.createTicket(first.purpose, [{ type: 'confirm' }]);
    vi.resetModules();
    const second = await import('../../src/background/tickets');
    expect((await second.getTicket(view!.id))?.purpose).toEqual(first.purpose);
  });

  it('a code drawn on a canvas can be replaced by a phrase to type', async () => {
    const { tickets, purpose } = await load();
    const { view } = await tickets.createTicket(purpose, [{ type: 'text', length: 24 }]);
    const alt = await tickets.accessibleAlternative(view!.id, 'I am choosing this');
    expect(alt?.step).toEqual({ type: 'phrase', phrase: 'I am choosing this' });
    // Only a code is replaced.
    expect((await tickets.accessibleAlternative(view!.id, 'other'))?.step).toEqual(alt?.step);
    expect(await tickets.accessibleAlternative('missing', 'x')).toBeNull();
  });

  it('an error of the purpose is the error of the answer', async () => {
    const { tickets } = await load();
    tickets.registerExecutor('emergency.complete', async () => {
      throw new Error('emergency.error.notReady');
    });
    const { view } = await tickets.createTicket({ kind: 'emergency.complete' }, [{ type: 'confirm' }]);
    expect(await tickets.answerTicket(view!.id, '')).toEqual({
      status: 'error',
      error: 'emergency.error.notReady',
    });
  });
});

describe('costs', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  it('each cost of a break is its steps', async () => {
    const { costSteps } = await import('../../src/background/tickets');
    expect(costSteps({ type: 'none' })).toEqual([]);
    expect(costSteps({ type: 'confirm' })).toEqual([{ type: 'confirm' }]);
    expect(costSteps({ type: 'delay', seconds: 9 })).toEqual([{ type: 'wait', seconds: 9 }]);
    expect(costSteps({ type: 'challenge', kind: 'phrase', phrase: 'ok' })).toEqual([
      { type: 'phrase', phrase: 'ok' },
    ]);
    expect(costSteps({ type: 'challenge', kind: 'phrase' })).toEqual([{ type: 'text', length: 24 }]);
    expect(costSteps({ type: 'challenge', kind: 'math' })).toEqual([{ type: 'math' }]);
    expect(costSteps({ type: 'challenge', kind: 'random', length: 40 })).toEqual([
      { type: 'text', length: 40 },
    ]);
    expect(costSteps({ type: 'password' })).toEqual([{ type: 'text', length: 32 }]);
  });

  it('steps paid cover the steps needed: longer waits and codes, the phrase for a code', async () => {
    const { covers } = await import('../../src/background/tickets');
    expect(covers([{ type: 'wait', seconds: 60 }], [{ type: 'wait', seconds: 30 }])).toBe(true);
    expect(covers([{ type: 'wait', seconds: 10 }], [{ type: 'wait', seconds: 30 }])).toBe(false);
    expect(covers([{ type: 'wait', seconds: 10 }], [{ type: 'confirm' }])).toBe(true);
    expect(covers([{ type: 'phrase', phrase: 'x' }], [{ type: 'text', length: 24 }])).toBe(true);
    expect(covers([{ type: 'text', length: 8 }], [{ type: 'text', length: 24 }])).toBe(false);
    expect(covers([{ type: 'math' }], [{ type: 'math' }])).toBe(true);
    // Each step paid covers one step needed, the longest codes first.
    expect(
      covers(
        [
          { type: 'text', length: 40 },
          { type: 'text', length: 10 },
        ],
        [
          { type: 'text', length: 10 },
          { type: 'text', length: 30 },
        ],
      ),
    ).toBe(true);
    expect(covers([{ type: 'confirm' }], [{ type: 'confirm' }, { type: 'confirm' }])).toBe(false);
    expect(
      covers(
        [{ type: 'rulePassword', groups: ['A', 'B'], names: [] }],
        [{ type: 'rulePassword', groups: ['B'], names: [] }],
      ),
    ).toBe(true);
    expect(
      covers(
        [{ type: 'partner', groups: ['A'], names: [] }],
        [{ type: 'partner', groups: ['A', 'C'], names: [] }],
      ),
    ).toBe(false);
  });
});
