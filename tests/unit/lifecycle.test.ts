import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileConfig } from '../../src/engine/compile';
import { defaultConfig } from '../../src/engine/defaults';
import { INACTIVE_GAP_MS } from '../../src/engine/limits';
import { configChecksum } from '../../src/engine/schema';
import { type FakeBrowser, installFakeBrowser } from './fake-browser';
import { BLOCK, group } from './helpers';

const T0 = new Date(2026, 9, 5, 10).getTime();

let fake: FakeBrowser;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: T0 });
  fake = installFakeBrowser({ tabs: [{ id: 1, url: 'https://a.test/', active: true, incognito: false }] });
});
afterEach(() => vi.useRealTimers());

/** Lets the background's promise chains settle (storage, reconciliation). */
async function settle() {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
}

describe('start-up', () => {
  it('an install opens the welcome page and records the version', async () => {
    await import('../../src/background/index');
    const { store } = await import('../../src/background/store');
    await settle();
    fake.events.onInstalled.fire({ reason: 'install' });
    await settle();
    expect(fake.created.map((x) => x.url)).toEqual(['chrome-extension://test/dashboard.html#/welcome']);
    expect(store.meta).toMatchObject({ installedAt: T0, version: '1.0.0' });
    expect(fake.alarms.get('whb-periodic')).toEqual({ periodInMinutes: 1 });
  });

  it('a start after a long time without the extension, and no browser start-up, is a protection event', async () => {
    const state = {
      ...(await import('../../src/engine/defaults')).defaultState(),
      lastAlive: T0 - INACTIVE_GAP_MS - 60_000,
    };
    const config = defaultConfig();
    fake.local.set('config', { data: config, sum: configChecksum(config), v: 2 });
    fake.local.set('state', state);
    await import('../../src/background/index');
    const { store } = await import('../../src/background/store');
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.state.tamper.map((e) => e.kind)).toEqual(['inactive-gap']);
  });

  it('a browser start-up is not', async () => {
    const config = defaultConfig();
    fake.local.set('config', { data: config, sum: configChecksum(config), v: 2 });
    fake.local.set('state', { lastAlive: T0 - INACTIVE_GAP_MS * 10 });
    await import('../../src/background/index');
    fake.events.onStartup.fire();
    const { store } = await import('../../src/background/store');
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.state.tamper).toEqual([]);
  });
});

describe('the periodic alarm', () => {
  it('runs the daily tasks once per day: minute counters, retention, a backup, private windows', async () => {
    const { store } = await import('../../src/background/store');
    const { periodic } = await import('../../src/background/periodic');
    await store.ready();
    store.usage.add('g:A', T0 - 3 * 86_400_000, 10, 1, store.cc.cal);
    await periodic();
    expect(store.meta.lastDaily).toBe('2026-10-05');
    expect(store.usage.minutes['g:A']).toBeUndefined();
    expect((await store.getBackupIndex()).daily).toHaveLength(1);
    expect(store.meta.incognitoAllowed).toBe(true);
    await periodic();
    expect((await store.getBackupIndex()).daily).toHaveLength(1);
  });
});

describe('explaining a URL', () => {
  it('with the rules saved, or with a rule being edited', async () => {
    const { store } = await import('../../src/background/store');
    const { explainDraft } = await import('../../src/background/explain');
    await store.ready();
    store.config = { ...store.config, groups: [group('A', ['a.test'], [{ intervention: BLOCK }])] };
    store.cc = compileConfig(store.config);
    expect(explainDraft('https://b.test/', undefined, false).intervention.type).toBe('allow');
    const draft = group('B', ['b.test'], [{ intervention: BLOCK }]);
    expect(explainDraft('https://b.test/', draft, false).primary?.groupId).toBe('B');
    const edited = { ...store.config.groups[0], enabled: false };
    expect(explainDraft('https://a.test/', edited, false).intervention.type).toBe('allow');
  });
});

describe('browser filters', () => {
  it('when the browser refuses the rules, the ones that cannot fail are kept and the error is shown', async () => {
    const { store } = await import('../../src/background/store');
    const { syncRules, dnrStatus } = await import('../../src/background/dnr-sync');
    await store.ready();
    store.config = {
      ...store.config,
      groups: [group('A', ['a.test', 'b.test/path'], [{ intervention: BLOCK }])],
    };
    store.cc = compileConfig(store.config);
    const dnr = (globalThis as any).chrome.declarativeNetRequest;
    const update = dnr.updateDynamicRules;
    let calls = 0;
    dnr.updateDynamicRules = async (o: { addRules?: chrome.declarativeNetRequest.Rule[] }) => {
      if (calls++ === 0) throw new Error('too complex');
      return update(o);
    };
    await syncRules(true);
    expect(dnrStatus.lastError).toBe('too complex');
    expect(
      [...fake.rules.values()].every((r) => !r.condition.regexFilter || r.condition.regexFilter === '^(.*)$'),
    ).toBe(true);
    expect(fake.rules.size).toBe(1);
  });

  it('an expression the browser does not support is left to the intervention page', async () => {
    const { store } = await import('../../src/background/store');
    const { syncRules, dnrStatus } = await import('../../src/background/dnr-sync');
    await store.ready();
    store.config = { ...store.config, groups: [group('A', ['b.test/path'], [{ intervention: BLOCK }])] };
    store.cc = compileConfig(store.config);
    (globalThis as any).chrome.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: false });
    await syncRules();
    expect(fake.rules.size).toBe(0);
    expect(dnrStatus.overflow).toHaveLength(1);
  });

  it('the self-test rule is installed and removed apart from the others', async () => {
    const { installSelftestRule, removeSelftestRule, SELFTEST_RULE_ID } = await import(
      '../../src/background/dnr-sync'
    );
    await installSelftestRule();
    expect([...fake.rules.keys()]).toEqual([SELFTEST_RULE_ID]);
    await removeSelftestRule();
    expect(fake.rules.size).toBe(0);
  });
});

describe('storage', () => {
  it('backups of earlier builds, kept in one key, are split into one key each', async () => {
    const config = defaultConfig();
    fake.local.set('backups', {
      recent: [{ at: 1, reason: 'edit', data: config }],
      daily: [{ at: 2, reason: 'daily', data: config }],
    });
    const { store } = await import('../../src/background/store');
    await store.ready();
    const index = await store.getBackupIndex();
    expect(index.recent.map((m) => [m.at, m.reason, m.groups])).toEqual([[1, 'edit', 0]]);
    expect(fake.local.has('backups')).toBe(false);
    expect((await store.loadSnapshot(index.daily[0]))?.data).toEqual(config);
  });

  it('days outside the memory are read from storage', async () => {
    fake.local.set('u:2020-01-01', { t: { 'a:': [5, 0] }, c: {} });
    const { store } = await import('../../src/background/store');
    await store.ready();
    expect(await store.allDayKeys()).toEqual(['2020-01-01']);
    expect((await store.loadDays(['2020-01-01', '2020-01-02'])).get('2020-01-01')?.t['a:']).toEqual([5, 0]);
  });
});

describe('the Date headers of web responses', () => {
  it('are sampled from main documents not served from a cache', async () => {
    const { store } = await import('../../src/background/store');
    const { initClockObserver } = await import('../../src/background/clock');
    await store.ready();
    initClockObserver();
    const ahead = new Date(T0 - 30 * 60_000).toUTCString();
    for (const host of ['a.test', 'b.test', 'c.test'])
      fake.events.onHeadersReceived.fire({
        url: `https://${host}/`,
        responseHeaders: [{ name: 'Date', value: ahead }],
      });
    fake.events.onHeadersReceived.fire({
      url: 'https://d.test/',
      fromCache: true,
      responseHeaders: [{ name: 'Date', value: 'x' }],
    });
    expect(store.state.clockOffset).toBe(-30 * 60_000);
  });
});
