import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBrowser } from './fake-browser';

describe('deleting statistics never refills limits (STA-06)', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  it('keeps group totals, passes and break records; removes sites, counters, reasons and intentions', async () => {
    const { store } = await import('../../src/background/store');
    const { deleteStats } = await import('../../src/background/stats');
    const { dayKeyOf } = await import('../../src/engine/time');
    await store.ready();
    const now = Date.now();
    const today = dayKeyOf(now, store.cc.cal);
    store.usage.add('g:G', now, 1800, 2, store.cc.cal);
    store.usage.add('s:G:video.test', now, 1800, 2, store.cc.cal);
    store.usage.add('h:video.test', now, 1800, 2, store.cc.cal, false);
    store.usage.add('a:', now, 1800, 0, store.cc.cal);
    store.usage.count('shown:G', now, store.cc.cal);
    store.usage.count('proceeded:G', now, store.cc.cal);
    store.state.pauses.push({
      at: now,
      groups: ['G'],
      scope: 'site',
      minutes: 10,
      reason: 'private',
      grantId: 'x',
    });
    store.intentions.push({ at: now, groupId: 'G', text: 'secret', minutes: 5 });
    await store.flushUsage();

    await deleteStats('all');

    const rec = store.usage.days.get(today)!;
    expect(rec.t['g:G'][0]).toBe(1800);
    expect(rec.t['s:G:video.test'][0]).toBe(1800);
    expect(rec.t['h:video.test']).toBeUndefined();
    expect(rec.t['a:']).toBeUndefined();
    expect(rec.c).toEqual({ 'proceeded:G': 1 });
    expect(store.state.pauses).toHaveLength(1);
    expect(store.state.pauses[0].reason).toBeUndefined();
    expect(store.intentions).toEqual([]);
    expect(store.usage.minutes['g:G']).toBeDefined();
  });
});
