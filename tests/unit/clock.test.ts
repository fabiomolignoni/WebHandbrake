import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK_SKEW_THRESHOLD_MS } from '../../src/engine/limits';
import { installFakeBrowser } from './fake-browser';

const T0 = new Date(2026, 9, 5, 10).getTime();
const HOUR = 3_600_000;

async function load() {
  const { store } = await import('../../src/background/store');
  const clock = await import('../../src/background/clock');
  await store.ready();
  return { store, clock };
}

describe('the trusted clock', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    vi.setSystemTime(T0);
    installFakeBrowser();
  });
  afterEach(() => vi.useRealTimers());

  it('follows the system clock and remembers the highest time seen', async () => {
    const { store, clock } = await load();
    expect(clock.now()).toBe(T0);
    vi.setSystemTime(T0 + 5000);
    expect(clock.now()).toBe(T0 + 5000);
    expect(store.state.lastWall).toBe(T0 + 5000);
    expect(store.state.tamper).toEqual([]);
  });

  it('never goes back when the system clock is set back, and records it once', async () => {
    const { store, clock } = await load();
    clock.now();
    vi.setSystemTime(T0 - HOUR);
    const t = clock.now();
    expect(t).toBeGreaterThanOrEqual(T0);
    clock.now();
    clock.now();
    expect(store.state.tamper.map((e) => [e.kind, e.detail])).toEqual([['clock-backward', '60']]);
    // A small step back (a correction of the system clock) is not a jump.
    vi.setSystemTime(t + 10_000);
    clock.now();
    vi.setSystemTime(t);
    expect(clock.now()).toBe(t);
    expect(store.state.tamper).toHaveLength(1);
  });

  it('after a restart, the highest time seen is the floor', async () => {
    const { store, clock } = await load();
    store.state.lastWall = T0 + 2 * HOUR;
    expect(clock.now()).toBe(T0 + 2 * HOUR);
    expect(store.state.tamper[0]).toMatchObject({ kind: 'clock-backward', detail: '120' });
  });

  it('a clock set forward is corrected when several sites agree on their Date headers', async () => {
    const { store, clock } = await load();
    const ahead = -(CLOCK_SKEW_THRESHOLD_MS + 20 * 60_000);
    clock.addSample('a.test', ahead);
    clock.addSample('b.test', ahead + 1000);
    expect(store.state.clockOffset).toBe(0);
    // The same host twice counts once.
    clock.addSample('b.test', ahead + 2000);
    expect(store.state.clockOffset).toBe(0);
    clock.addSample('c.test', ahead - 1000);
    expect(store.state.clockOffset).toBe(ahead);
    expect(store.state.tamper.map((e) => e.kind)).toEqual(['clock-skew']);
    expect(clock.now()).toBe(T0 + ahead);
    // Once the system clock is right again, the correction goes.
    for (const host of ['a.test', 'b.test', 'c.test']) clock.addSample(host, 500);
    expect(store.state.clockOffset).toBe(0);
  });

  it('a clock that was ahead and was put right counts again once the sites confirm it', async () => {
    const { store, clock } = await load();
    // The system clock is two hours ahead for a minute (before it synchronizes), then put right.
    vi.setSystemTime(T0 + 2 * HOUR);
    clock.now();
    vi.advanceTimersByTime(60_000);
    vi.setSystemTime(T0 + 60_000);
    expect(clock.now()).toBe(T0 + 2 * HOUR + 60_000);
    expect(store.state.tamper.map((e) => [e.kind, e.detail])).toEqual([['clock-backward', '120']]);
    // Two sites are not enough.
    clock.addSample('a.test', 0);
    clock.addSample('b.test', -500);
    expect(clock.now()).toBe(T0 + 2 * HOUR + 60_000);
    clock.addSample('c.test', 500);
    expect(store.state.clockOffset).toBe(0);
    expect(store.state.lastWall).toBe(T0 + 60_000);
    expect(store.state.tamper.map((e) => [e.kind, e.detail])).toEqual([
      ['clock-backward', '120'],
      ['clock-realigned', '120'],
    ]);
    vi.advanceTimersByTime(3 * HOUR);
    expect(clock.now()).toBe(Date.now());
    expect(store.state.tamper).toHaveLength(2);
    // Once is enough: the sites that agree again change nothing.
    clock.addSample('d.test', 0);
    expect(store.state.tamper).toHaveLength(2);
  });

  it('a time ahead by less than the threshold stays the floor', async () => {
    const { store, clock } = await load();
    vi.setSystemTime(T0 + CLOCK_SKEW_THRESHOLD_MS - 60_000);
    clock.now();
    vi.setSystemTime(T0);
    for (const host of ['a.test', 'b.test', 'c.test']) clock.addSample(host, 0);
    expect(clock.now()).toBe(T0 + CLOCK_SKEW_THRESHOLD_MS - 60_000);
    expect(store.state.tamper.map((e) => e.kind)).toEqual(['clock-backward']);
  });

  it('a correction that the system clock made useless does not leave the time ahead', async () => {
    const { store, clock } = await load();
    // The system clock is two hours behind: the sites correct it.
    vi.setSystemTime(T0 - 2 * HOUR);
    for (const host of ['a.test', 'b.test', 'c.test']) clock.addSample(host, 2 * HOUR);
    expect(clock.now()).toBe(T0);
    // Put right, it is two hours ahead with the correction, until the sites tell.
    vi.setSystemTime(T0 + 60_000);
    expect(clock.now()).toBe(T0 + 2 * HOUR + 60_000);
    for (const host of ['a.test', 'b.test', 'c.test']) clock.addSample(host, 0);
    expect(store.state.clockOffset).toBe(0);
    expect(clock.now()).toBe(T0 + 60_000);
    // No backward jump of the system clock to report: the correction went.
    expect(store.state.tamper.map((e) => [e.kind, e.detail])).toEqual([
      ['clock-skew', '120'],
      ['clock-realigned', '120'],
    ]);
  });

  it('the time goes back to the corrected one when the system clock is still wrong', async () => {
    const { store, clock } = await load();
    const ahead = -2 * HOUR;
    for (const host of ['a.test', 'b.test', 'c.test']) clock.addSample(host, ahead);
    expect(clock.now()).toBe(T0 + ahead);
    // The system clock goes three more hours ahead, then back.
    vi.setSystemTime(T0 + 3 * HOUR);
    clock.now();
    vi.setSystemTime(T0);
    expect(clock.now()).toBe(T0 + HOUR);
    for (const host of ['a.test', 'b.test', 'c.test']) clock.addSample(host, ahead);
    expect(store.state.clockOffset).toBe(ahead);
    expect(clock.now()).toBe(T0 + ahead);
    expect(store.state.tamper.map((e) => [e.kind, e.detail])).toEqual([
      ['clock-skew', '-120'],
      ['clock-backward', '180'],
      ['clock-realigned', '180'],
    ]);
  });

  it('sites that disagree, or a small difference, change nothing', async () => {
    const { store, clock } = await load();
    clock.addSample('a.test', -2 * HOUR);
    clock.addSample('b.test', 0);
    clock.addSample('c.test', 3 * HOUR);
    expect(store.state.clockOffset).toBe(0);
    for (const host of ['d.test', 'e.test', 'f.test']) clock.addSample(host, 60_000);
    expect(store.state.clockOffset).toBe(0);
  });

  it('a clock set back a day before a restart still finds the time of today', async () => {
    const first = await load();
    first.store.usage.add('g:x', first.clock.now(), 1800, 1, first.store.cc.cal);
    await first.store.flushAll();
    vi.resetModules();
    vi.setSystemTime(T0 - 24 * HOUR);
    const { store, clock } = await load();
    expect(clock.now()).toBe(T0);
    expect(store.usage.days.get('2026-10-05')?.t['g:x']).toEqual([1800, 1]);
  });

  it('the test clock exists only in the test build', async () => {
    const { clock } = await load();
    await clock.setTestClock(HOUR);
    expect(clock.testClockOffset()).toBe(0);
    expect(clock.now()).toBe(T0);
  });
});
