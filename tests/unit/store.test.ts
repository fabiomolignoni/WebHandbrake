import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Group } from '../../src/engine/types';
import { installFakeBrowser } from './fake-browser';

describe('store integrity', () => {
  let storage: ReturnType<typeof installFakeBrowser>;
  beforeEach(() => {
    vi.resetModules();
    storage = installFakeBrowser();
  });

  async function freshStore() {
    const { Store } = await import('../../src/background/store');
    const s = new Store();
    await s.ready();
    return s;
  }

  it('keeps a snapshot of the previous configuration on every write', async () => {
    const s = await freshStore();
    const { newGroup } = await import('../../src/engine/defaults');
    const a = JSON.parse(JSON.stringify(s.config));
    a.groups.push(newGroup({ name: 'First' }));
    await s.writeConfig(a, 'edit');
    const b = JSON.parse(JSON.stringify(a));
    b.groups.push(newGroup({ name: 'Second' }));
    await s.writeConfig(b, 'edit');
    const index = await s.getBackupIndex();
    expect(index.recent.map((x) => x.groups)).toEqual([1, 0]);
    expect(index.daily).toHaveLength(1);
    // The daily entry shares the first snapshot of the day: no duplicate data.
    expect(index.daily[0].key).toBe(index.recent[1].key);
    const stored = [...storage.local.keys()].filter((k) => k.startsWith('bk:'));
    // Two snapshots, and the one rule that they have, apart.
    expect(stored.filter((k) => !k.startsWith('bk:r:'))).toHaveLength(2);
    expect(stored.filter((k) => k.startsWith('bk:r:'))).toEqual(index.recent[0].rules);
    const first = await s.loadSnapshot(index.recent[0]);
    expect(first?.data.groups.map((g) => g.name)).toEqual(['First']);
    // The latest configuration is also stored a second time, the same, to restore it.
    expect(storage.local.get('config:last')).toEqual(storage.local.get('config'));
    // A daily snapshot when nothing changed does not touch the recent list.
    await s.snapshotDaily();
    expect((await s.getBackupIndex()).recent).toHaveLength(2);
  });

  async function twoChanges() {
    const s = await freshStore();
    const { newGroup } = await import('../../src/engine/defaults');
    const a = JSON.parse(JSON.stringify(s.config));
    a.groups.push(newGroup({ name: 'First' }));
    await s.writeConfig(a, 'edit');
    const b = JSON.parse(JSON.stringify(a));
    b.groups.push(newGroup({ name: 'Second' }));
    await s.writeConfig(b, 'edit');
  }

  /** A bad checksum. */
  function corrupt(key: string) {
    const stored = storage.local.get(key) as { data: unknown; sum: string };
    storage.local.set(key, { ...stored, sum: '00000000' });
  }

  it('restores the last configuration, with its last change, when the stored one is corrupted', async () => {
    await twoChanges();
    const { savedAt } = storage.local.get('config:last') as { savedAt: number };
    corrupt('config');
    vi.resetModules();
    const restored = await freshStore();
    expect(restored.config.groups.map((g) => g.name)).toEqual(['First', 'Second']);
    expect(restored.meta.restored?.snapshotAt).toBe(savedAt);
    expect(restored.pendingTamper[0]).toMatchObject({ kind: 'state-restored', detail: String(savedAt) });
    // Written back intact: the next start finds nothing to restore.
    vi.resetModules();
    expect((await freshStore()).pendingTamper).toEqual([]);
  });

  it('a snapshot that lost one of its rules is passed over for the one before', async () => {
    await twoChanges();
    corrupt('config');
    corrupt('config:last');
    vi.resetModules();
    const { Store } = await import('../../src/background/store');
    const index = await new Store().getBackupIndex();
    storage.local.delete(index.recent[0].rules?.[0] ?? '');
    const restored = await freshStore();
    // The snapshot before the first change, which had no rule.
    expect(restored.config.groups).toEqual([]);
    expect(restored.meta.restored?.snapshotAt).toBe(index.recent[1].at);
  });

  it('restores the latest valid snapshot when the last configuration is corrupted too', async () => {
    await twoChanges();
    corrupt('config');
    corrupt('config:last');
    vi.resetModules();
    const restored = await freshStore();
    expect(restored.config.groups.map((g) => g.name)).toEqual(['First']);
    expect(restored.meta.restored?.snapshotAt).toBeTypeOf('number');
    expect(restored.pendingTamper[0].kind).toBe('state-restored');
    // The restored configuration is the last one from now on.
    expect(storage.local.get('config:last')).toEqual(storage.local.get('config'));
  });

  it('keeps unknown fields written by newer versions', async () => {
    const { checksum } = await import('../../src/engine/schema');
    const { defaultConfig } = await import('../../src/engine/defaults');
    const data = { ...defaultConfig(), futureField: { x: 1 } } as Record<string, unknown>;
    storage.local.set('config', { data, sum: checksum(JSON.stringify(data)) });
    const s = await freshStore();
    expect((s.config as unknown as Record<string, unknown>).futureField).toEqual({ x: 1 });
  });

  it('a break of an earlier version that counted only the time on the site ends by the clock', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      const grant = { id: 'p', kind: 'pause', groups: ['A'], scope: 'site', createdAt: 0, severity: 99 };
      storage.local.set('state', { grants: [{ ...grant, remaining: 90 }] });
      const s = await freshStore();
      expect(s.state.grants).toEqual([{ ...grant, until: 1_090_000 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('migrates a configuration of an earlier schema once, keeping the previous one', async () => {
    const { configChecksum, CHECKSUM_VERSION } = await import('../../src/engine/schema');
    const { defaultConfig, newGroup } = await import('../../src/engine/defaults');
    const { SCHEMA_VERSION } = await import('../../src/engine/types');
    const site = (id: string, value: string, type = 'domain') => ({ id, type, value });
    const data = {
      ...defaultConfig(),
      schema: 1,
      groups: [{ ...newGroup({ name: 'Social' }), targets: [site('a', 'a.test')], lists: ['L'] }],
      lists: [{ id: 'L', name: 'List', rev: 1, updatedAt: 0, targets: [site('l', 'l.test')] }],
      allowlist: [site('w', 'a.test/docs', 'path')],
    };
    storage.local.set('config', { data, sum: configChecksum(data), v: CHECKSUM_VERSION });
    const s = await freshStore();
    const sites = s.config.groups[0].targets.map((t) => `${t.allow ? '+' : ''}${t.value}`);
    expect(sites).toEqual(['a.test', 'l.test', '+a.test/docs']);
    const stored = storage.local.get('config') as { data: Record<string, unknown> };
    expect(stored.data.schema).toBe(SCHEMA_VERSION);
    expect(stored.data).not.toHaveProperty('lists');
    expect(storage.local.get('config:last')).toEqual(stored);
    expect(storage.local.get('config:pre-migration')).toMatchObject({
      from: 1,
      data: { lists: [{ id: 'L' }] },
    });
    // Read again, it stays as it was written: the copies keep their ids.
    vi.resetModules();
    expect((await freshStore()).config.groups[0].targets).toEqual(s.config.groups[0].targets);
  });
});

describe('integrity with Chrome storage, which sorts object keys (regression)', () => {
  it('a configuration read back by a restarted service worker is intact, not "restored"', async () => {
    vi.resetModules();
    installFakeBrowser({ chrome: true });
    const { Store } = await import('../../src/background/store');
    const { newGroup } = await import('../../src/engine/defaults');
    const s = new Store();
    await s.ready();
    const a = JSON.parse(JSON.stringify(s.config));
    a.groups.push(newGroup({ name: 'First' }));
    await s.writeConfig(a, 'edit');
    const b = JSON.parse(JSON.stringify(a));
    b.groups.push(newGroup({ name: 'Second' }));
    await s.writeConfig(b, 'edit');
    // The service worker stops and starts again: the store is loaded from storage.
    vi.resetModules();
    const { Store: Again } = await import('../../src/background/store');
    const t = new Again();
    await t.ready();
    expect(t.config.groups.map((g) => g.name)).toEqual(['First', 'Second']);
    expect(t.meta.restored).toBeNull();
    expect(t.pendingTamper).toEqual([]);
  });

  it('accepts checksums written before (insertion order), in Chrome too', async () => {
    vi.resetModules();
    const storage = installFakeBrowser({ chrome: true });
    const { checksum, normalizeConfig } = await import('../../src/engine/schema');
    const { defaultConfig, newGroup } = await import('../../src/engine/defaults');
    const { config } = normalizeConfig({ ...defaultConfig(), groups: [newGroup({ name: 'Old' })] });
    storage.local.set('config', { data: config, sum: checksum(JSON.stringify(config)) });
    const { Store } = await import('../../src/background/store');
    const s = new Store();
    await s.ready();
    expect(s.config.groups.map((g) => g.name)).toEqual(['Old']);
    expect(s.meta.restored).toBeNull();
  });

  it('checks legacy checksums where the storage keeps the key order (Firefox)', async () => {
    const { checksum, configChecksum, storedConfigIntact } = await import('../../src/engine/schema');
    const data = { schema: 1, groups: [], settings: { b: 1, a: 2 } };
    const legacy = checksum(JSON.stringify(data));
    expect(storedConfigIntact({ data, sum: legacy }, true)).toBe(true);
    expect(storedConfigIntact({ data: { ...data, groups: [1] }, sum: legacy }, true)).toBe(false);
    // Chrome sorted the keys: an earlier checksum cannot be checked there.
    expect(storedConfigIntact({ data, sum: 'whatever' }, false)).toBe(true);
    // Version 2 is checked everywhere, whatever the order of the keys.
    const sorted = { groups: [], schema: 1, settings: { a: 2, b: 1 } };
    expect(storedConfigIntact({ data: sorted, sum: configChecksum(data), v: 2 }, false)).toBe(true);
    expect(
      storedConfigIntact({ data: { ...sorted, schema: 2 }, sum: configChecksum(data), v: 2 }, false),
    ).toBe(false);
  });

  it('still detects a damaged configuration', async () => {
    vi.resetModules();
    const storage = installFakeBrowser({ chrome: true });
    const { Store } = await import('../../src/background/store');
    const { newGroup } = await import('../../src/engine/defaults');
    const s = new Store();
    await s.ready();
    const a = JSON.parse(JSON.stringify(s.config));
    a.groups.push(newGroup({ name: 'First' }));
    await s.writeConfig(a, 'edit');
    const stored = storage.local.get('config') as { data: { groups: { name: string }[] }; sum: string };
    stored.data.groups[0].name = 'Tampered';
    vi.resetModules();
    const { Store: Again } = await import('../../src/background/store');
    const t = new Again();
    await t.ready();
    // The copy of the last configuration, as it was saved.
    expect(t.config.groups.map((g) => g.name)).toEqual(['First']);
    expect(t.pendingTamper[0].kind).toBe('state-restored');
  });
});

describe('snapshot rotation', () => {
  it('removes snapshots, and rules, that are no longer referenced, those of earlier builds too', async () => {
    vi.resetModules();
    const storage = installFakeBrowser();
    const { defaultConfig, newGroup } = await import('../../src/engine/defaults');
    // A snapshot of an earlier build keeps the whole configuration under its key.
    storage.local.set('bk:old', { ...defaultConfig(), groups: [newGroup({ name: 'Old' })] });
    storage.local.set('backups:index', {
      recent: [{ at: 1, reason: 'edit', groups: 1, key: 'bk:old' }],
      daily: [],
    });
    const { Store } = await import('../../src/background/store');
    const s = new Store();
    await s.ready();
    const old = (await s.getBackupIndex()).recent[0];
    expect((await s.loadSnapshot(old))?.data.groups.map((g) => g.name)).toEqual(['Old']);
    const kept = newGroup({ name: 'Kept' });
    for (let i = 0; i < 25; i++) {
      const next = JSON.parse(JSON.stringify(s.config));
      next.settings.badge.thresholdMinutes = 10 + i;
      next.groups = [kept, newGroup({ name: `Changed ${i}` })];
      await s.writeConfig(next, 'edit');
    }
    const index = await s.getBackupIndex();
    expect(index.recent).toHaveLength(20);
    const referenced = new Set([...index.recent, ...index.daily].flatMap((m) => [m.key, ...(m.rules ?? [])]));
    const stored = [...storage.local.keys()].filter((k) => k.startsWith('bk:'));
    expect(new Set(stored)).toEqual(referenced);
    expect(storage.local.has('bk:old')).toBe(false);
    // The rule that never changed, once; one changed rule for each of the 20 snapshots.
    const names = stored.flatMap((k) =>
      k.startsWith('bk:r:') ? [(storage.local.get(k) as Group).name] : [],
    );
    expect(names.filter((n) => n === 'Kept')).toHaveLength(1);
    expect(names).toHaveLength(21);
  });
});

describe('snapshots of a rule with a large list', () => {
  const sites = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`,
      type: 'domain' as const,
      value: `${prefix}${i}.test`,
    }));

  it('ten changes to a small rule store the large one once; every snapshot comes back as it was', async () => {
    vi.resetModules();
    const storage = installFakeBrowser();
    const { Store } = await import('../../src/background/store');
    const { newGroup } = await import('../../src/engine/defaults');
    const s = new Store();
    await s.ready();
    const big: Group = { ...newGroup({ name: 'Big' }), targets: sites(5000, 'big') };
    const first = JSON.parse(JSON.stringify(s.config));
    first.groups = [big, { ...newGroup({ name: 'Small' }), targets: sites(1, 'small') }];
    await s.writeConfig(first, 'edit');
    for (let i = 2; i <= 11; i++) {
      const next = JSON.parse(JSON.stringify(s.config));
      next.groups[1].targets = sites(i, 'small');
      await s.writeConfig(next, 'edit');
    }
    const bk = [...storage.local.keys()].filter((k) => k.startsWith('bk:'));
    const rules = bk.filter((k) => k.startsWith('bk:r:')).map((k) => storage.local.get(k) as Group);
    expect(rules.filter((g) => g.name === 'Big')).toHaveLength(1);
    expect(rules.filter((g) => g.name === 'Small').map((g) => g.targets.length)).toHaveLength(10);
    // All the backups take about one copy of the large rule (they took 11).
    const bytes = await (globalThis as any).chrome.storage.local.getBytesInUse(bk);
    expect(bytes).toBeLessThan(1.2 * JSON.stringify(big).length);
    // Newest first: before the last change the small rule had 10 sites, before the first one there was no rule.
    const index = await s.getBackupIndex();
    expect(index.recent).toHaveLength(11);
    for (const [i, meta] of index.recent.entries()) {
      const snap = await s.loadSnapshot(meta);
      if (i === 10) {
        expect(snap?.data.groups).toEqual([]);
        continue;
      }
      expect(snap?.data.groups.map((g) => [g.name, g.targets.length])).toEqual([
        ['Big', 5000],
        ['Small', 10 - i],
      ]);
      expect(snap?.data.groups[0]).toEqual(big);
      expect(snap?.data.settings).toEqual(s.config.settings);
    }
  });
});

describe('writing the runtime state', () => {
  const T0 = new Date(2026, 9, 5, 10).getTime();
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  async function load() {
    const { store } = await import('../../src/background/store');
    const clock = await import('../../src/background/clock');
    await store.ready();
    return { store, clock };
  }

  const local = () => (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local;

  /** The keys of the runtime state in each write to the storage from now on. */
  function stateWrites() {
    const set = vi.spyOn(local(), 'set');
    return () =>
      set.mock.calls
        .map(([items]) => Object.keys(items as object).filter((k) => k === 'state' || k === 'activity'))
        .filter((keys) => keys.length);
  }

  it('two saves without a change write once; a later time seen is written', async () => {
    const storage = installFakeBrowser();
    const { store, clock } = await load();
    const writes = stateWrites();
    await store.flushAll();
    await store.flushAll();
    expect(writes()).toEqual([['state', 'activity']]);
    // now() records the highest time seen without saying so.
    vi.setSystemTime(T0 + 60_000);
    clock.now();
    await store.flushAll();
    expect(writes()).toEqual([['state', 'activity'], ['state']]);
    expect(storage.local.get('state')).toMatchObject({ lastWall: T0 + 60_000 });
  });

  it('a background started again does not write what the storage holds (Chrome sorts the keys)', async () => {
    const storage = installFakeBrowser({ chrome: true });
    const first = await load();
    first.clock.now();
    first.store.addTamper({ at: T0, kind: 'clock-skew', detail: '5' });
    first.store.state.activity['g:A'] = { last: T0 };
    await first.store.flushAll();
    vi.resetModules();
    installFakeBrowser({ chrome: true, sharedWith: storage });
    const { store } = await load();
    const writes = stateWrites();
    await store.flushAll();
    expect(writes()).toEqual([]);
    store.state.activity['g:A'] = { last: T0 + 5000 };
    await store.flushAll();
    expect(writes()).toEqual([['activity']]);
  });

  it('a write that failed is tried again', async () => {
    const storage = installFakeBrowser();
    const { store } = await load();
    vi.spyOn(local(), 'set').mockRejectedValueOnce(new Error('quota'));
    await expect(store.saveState()).rejects.toThrow('quota');
    expect(storage.local.has('state')).toBe(false);
    await store.saveState();
    expect(storage.local.has('state')).toBe(true);
  });
});
