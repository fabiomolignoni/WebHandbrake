import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(stored).toHaveLength(2);
    const first = await s.loadSnapshot(index.recent[0]);
    expect(first?.data.groups.map((g) => g.name)).toEqual(['First']);
    // A daily snapshot when nothing changed does not touch the recent list.
    await s.snapshotDaily();
    expect((await s.getBackupIndex()).recent).toHaveLength(2);
  });

  it('restores the latest valid snapshot when the configuration is corrupted', async () => {
    const s = await freshStore();
    const { newGroup } = await import('../../src/engine/defaults');
    const a = JSON.parse(JSON.stringify(s.config));
    a.groups.push(newGroup({ name: 'First' }));
    await s.writeConfig(a, 'edit');
    const b = JSON.parse(JSON.stringify(a));
    b.groups.push(newGroup({ name: 'Second' }));
    await s.writeConfig(b, 'edit');
    // Corrupt the stored configuration (bad checksum).
    const stored = storage.local.get('config') as { data: unknown; sum: string };
    storage.local.set('config', { ...stored, sum: '00000000' });
    vi.resetModules();
    const restored = await freshStore();
    expect(restored.config.groups.map((g) => g.name)).toEqual(['First']);
    expect(restored.meta.restored?.snapshotAt).toBeTypeOf('number');
    expect(restored.pendingTamper[0].kind).toBe('state-restored');
  });

  it('keeps unknown fields written by newer versions', async () => {
    const { checksum } = await import('../../src/engine/schema');
    const { defaultConfig } = await import('../../src/engine/defaults');
    const data = { ...defaultConfig(), futureField: { x: 1 } } as Record<string, unknown>;
    storage.local.set('config', { data, sum: checksum(JSON.stringify(data)) });
    const s = await freshStore();
    expect((s.config as unknown as Record<string, unknown>).futureField).toEqual({ x: 1 });
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
    expect(t.config.groups).toEqual([]);
    expect(t.pendingTamper[0].kind).toBe('state-restored');
  });
});

describe('snapshot rotation', () => {
  it('removes snapshots that are no longer referenced', async () => {
    vi.resetModules();
    const storage = installFakeBrowser();
    const { Store } = await import('../../src/background/store');
    const s = new Store();
    await s.ready();
    for (let i = 0; i < 25; i++) {
      const next = JSON.parse(JSON.stringify(s.config));
      next.settings.badge.thresholdMinutes = 10 + i;
      await s.writeConfig(next, 'edit');
    }
    const index = await s.getBackupIndex();
    expect(index.recent).toHaveLength(20);
    const referenced = new Set([...index.recent, ...index.daily].map((m) => m.key));
    const stored = [...storage.local.keys()].filter((k) => k.startsWith('bk:'));
    expect(new Set(stored)).toEqual(referenced);
  });
});
