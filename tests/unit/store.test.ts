import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBrowser } from './fake-browser';

describe('store integrity (DAT-03, DAT-07)', () => {
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
      next.settings.accent = `#00000${i % 10}`;
      await s.writeConfig(next, 'edit');
    }
    const index = await s.getBackupIndex();
    expect(index.recent).toHaveLength(20);
    const referenced = new Set([...index.recent, ...index.daily].map((m) => m.key));
    const stored = [...storage.local.keys()].filter((k) => k.startsWith('bk:'));
    expect(new Set(stored)).toEqual(referenced);
  });
});
