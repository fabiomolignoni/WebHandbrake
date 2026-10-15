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
    vi.useFakeTimers({ toFake: ['Date'] });
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

  it('sites that disagree, or a small difference, change nothing', async () => {
    const { store, clock } = await load();
    clock.addSample('a.test', -2 * HOUR);
    clock.addSample('b.test', 0);
    clock.addSample('c.test', 3 * HOUR);
    expect(store.state.clockOffset).toBe(0);
    for (const host of ['d.test', 'e.test', 'f.test']) clock.addSample(host, 60_000);
    expect(store.state.clockOffset).toBe(0);
  });

  it('the test clock exists only in the test build', async () => {
    const { clock } = await load();
    await clock.setTestClock(HOUR);
    expect(clock.testClockOffset()).toBe(0);
    expect(clock.now()).toBe(T0);
  });
});
