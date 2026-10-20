import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileConfig } from '../../src/engine/compile';
import { MAX_IMPORT_BYTES, MAX_SESSION_MS } from '../../src/engine/limits';
import type { Group } from '../../src/engine/types';
import { type FakeBrowser, installFakeBrowser } from './fake-browser';
import { BLOCK, group, PERMANENT, REMINDER } from './helpers';

const T0 = new Date(2026, 9, 5, 10).getTime();

let fake: FakeBrowser;

async function setup(groups: Group[]) {
  vi.doMock('../../src/background/reconcile', () => ({ reconcile: async () => {}, broadcast: () => {} }));
  const { store } = await import('../../src/background/store');
  await store.ready();
  store.config = { ...store.config, groups };
  store.cc = compileConfig(store.config);
  return {
    store,
    data: await import('../../src/background/data'),
    later: await import('../../src/background/later'),
    pages: await import('../../src/background/pages'),
    sessions: await import('../../src/background/sessions'),
    budget: await import('../../src/background/budget'),
    protection: await import('../../src/background/protection'),
    tickets: await import('../../src/background/tickets'),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  fake = installFakeBrowser();
});
afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../../src/background/reconcile');
});

describe('data', () => {
  it('a preview tells what an import changes and how, before anything is applied', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER })]);
    const p = await t.data.previewImport('b.test\nnot a site', 'merge');
    expect(p).toMatchObject({
      format: 'list',
      groups: [{ name: 'Imported list', sites: 1, policies: 1 }],
      directions: ['strengthen'],
    });
    expect(p.warnings).toHaveLength(1);
    expect(t.store.config.groups).toHaveLength(1);
    expect(await t.data.previewImport('', 'merge')).toMatchObject({
      format: 'unknown',
      errors: ['The file is empty.'],
    });
  });

  it('whatever an import loosens follows the emergency exit; a large one is refused', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER })]);
    const empty = JSON.stringify({
      format: 'webhandbrake',
      version: 1,
      config: { groups: [], settings: {} },
      later: [
        { url: 'https://x.test', id: 'l', savedAt: 5 },
        3,
        { title: 'no address' },
        { url: 'javascript:alert(1)', id: 'js' },
      ],
    });
    const r = await t.data.applyImport(empty, 'replace');
    expect(r.ticket).toBeNull();
    expect(r.pending).toMatchObject({ emergency: true });
    // Only web pages, with the fields that the list reads.
    expect(t.store.later).toEqual([{ url: 'https://x.test', id: 'l', title: '', savedAt: 5 }]);
    const big = await t.data.applyImport('a'.repeat(MAX_IMPORT_BYTES + 1), 'merge');
    expect(big.errors?.[0]).toMatch(/10 MB/);
  });

  it('every change keeps a backup, which can be listed and restored; a reset follows the emergency exit', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: REMINDER })]);
    const next = structuredClone(t.store.config);
    next.groups[0].name = 'Renamed';
    await t.store.writeConfig(next, 'edit');
    const backups = await t.data.listBackups();
    expect(backups).toEqual([{ at: T0, reason: 'edit', groups: 1 }]);
    const restored = await t.data.restoreBackup(T0);
    // The name comes back, and a restored configuration is set up.
    expect(restored.applied.map((u) => u.kind)).toEqual(['group.field', 'setting']);
    expect(t.store.config.groups[0].name).toBe('A');
    expect((await t.data.restoreBackup(1)).errors).toEqual(['This backup no longer exists.']);
    expect((await t.data.resetConfig()).pending).toMatchObject({ emergency: true });
  });

  it('a restore applies at once what loosens nothing, and waits the emergency exit for the rest, whatever the rules ask', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }], { protection: PERMANENT })]);
    const next = structuredClone(t.store.config);
    next.groups[0].name = 'Renamed';
    next.groups[0].targets.push({ id: 'b', type: 'domain', value: 'b.test' });
    await t.store.writeConfig(next, 'edit');
    const r = await t.data.restoreBackup(T0);
    expect(r.refused).toBeNull();
    expect(r.applied.map((u) => u.kind)).toEqual(['group.field', 'setting']);
    expect(r.pending?.units.map((u) => u.kind)).toEqual(['target.remove']);
    expect((r.pending?.readyAt ?? 0) - T0).toBe(24 * 3_600_000);
    t.store.state.clockOffset = 24 * 3_600_000;
    const confirm = await t.protection.confirmPending(r.pending?.id ?? '');
    expect(
      await t.tickets.answerTicket(confirm.ticket?.id ?? '', t.protection.pendingPhrase()),
    ).toMatchObject({
      status: 'done',
    });
    expect(t.store.config.groups[0]).toMatchObject({ name: 'A', protection: PERMANENT });
    expect(t.store.config.groups[0].targets.map((x) => x.value)).toEqual(['a.test']);
  });

  it('exports: the configuration, statistics when asked, a rule as its own file', async () => {
    const t = await setup([group('Social media', ['a.test'], [{ intervention: BLOCK }])]);
    t.store.usage.add('g:x', T0, 5, 1, t.store.cc.cal);
    const plain = JSON.parse((await t.data.exportData(false, false)).text);
    expect(plain.statistics).toBeUndefined();
    const full = await t.data.exportData(true, true);
    expect(full.filename).toMatch(/^webhandbrake-2026-10-05_1000\.json$/);
    expect(Object.keys(JSON.parse(full.text).statistics)).toEqual(['2026-10-05']);
    const rule = await t.data.exportGroupFile('Social media');
    expect(rule.filename).toMatch(/^webhandbrake-group-social-media-/);
  });

  it('what is stored, grouped as the settings page shows it', async () => {
    const t = await setup([]);
    fake.local.set('u:2026-10-05', { t: {}, c: {} });
    fake.local.set('u:min', {});
    fake.local.set('bk:1', {});
    const usage = await t.data.storageUsage();
    expect(usage.keys.map((k) => k.name).sort()).toEqual(['backups', 'u:min', 'usage']);
    expect(usage.total).toBeGreaterThan(0);
  });
});

describe('saved for later', () => {
  it('a page is saved once, opened when allowed, and announced when it becomes available', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    t.store.config.settings.notifications.enabled = true;
    const item = await t.later.addLater('https://a.test/story#top', 'Story', 'A');
    expect(await t.later.addLater('https://www.a.test/story', 'Again', 'A')).toEqual(item);
    // A rule that always blocks never lets it open by itself.
    expect((await t.later.listLater()).items).toMatchObject([
      { id: item.id, allowedNow: false, availableAt: null },
    ]);
    expect(await t.later.openLater([item.id])).toBe(0);
    t.store.config.groups[0].enabled = false;
    t.store.cc = compileConfig(t.store.config);
    await t.later.announceAvailableLater();
    await t.later.announceAvailableLater();
    expect(fake.notifications.map((n) => n.id)).toEqual(['later']);
    expect(await t.later.openLater([item.id])).toBe(1);
    expect(fake.created.map((x) => x.url)).toEqual(['https://a.test/story#top']);
    expect(t.store.later).toEqual([]);
  });

  it('removing pages', async () => {
    const t = await setup([]);
    const a = await t.later.addLater('https://a.test/', undefined, undefined);
    await t.later.addLater('https://b.test/', 'B', undefined);
    await t.later.removeLater([a.id]);
    expect(t.store.later.map((i) => i.url)).toEqual(['https://b.test/']);
  });
});

describe('"Block this site / page"', () => {
  it('adds the entry to a rule, or creates one; an exception of the same entry gives way', async () => {
    const t = await setup([group('A', ['+a.test'], [{ intervention: BLOCK }], { protection: REMINDER })]);
    const r = await t.pages.addPage('https://www.a.test/x', 'domain', 'A');
    expect(r.applied.length).toBeGreaterThan(0);
    expect(t.store.config.groups[0].targets.map((x) => [x.type, x.value, Boolean(x.allow)])).toEqual([
      ['domain', 'a.test', false],
    ]);
    await t.pages.addPage('https://b.test/', 'domain', null, 'Later');
    expect(t.store.config.groups.map((g) => g.name)).toEqual(['A', 'Later']);
    expect(t.store.meta.lastAddGroup).toBe(t.store.config.groups[1].id);
    expect((await t.pages.addPage('about:config', 'domain', 'A')).errors).toHaveLength(1);
  });
});

describe('focus sessions and limits given up', () => {
  it('a session lasts the minutes asked, within a week, and covers the rules of quick sessions', async () => {
    const quick = group('Q', ['q.test'], [{ intervention: BLOCK }]);
    const other = group('O', ['o.test'], [{ intervention: BLOCK }]);
    other.options.quickSession = false;
    const t = await setup([quick, other]);
    const { id } = await t.sessions.startSession({
      kind: 'groups',
      groups: [],
      allow: [],
      minutes: 50,
      locked: false,
      noPauses: true,
    });
    const s = t.store.state.sessions.find((x) => x.id === id)!;
    expect(s).toMatchObject({ groups: ['Q'], startAt: T0, endAt: T0 + 50 * 60_000, noPauses: true });
    await t.sessions.startSession({
      kind: 'allowlist',
      groups: [],
      allow: [],
      until: T0 + 30 * 86_400_000,
      startInMinutes: 10,
      locked: true,
      noPauses: false,
    });
    const long = t.store.state.sessions[1];
    expect(long.endAt - long.startAt).toBe(MAX_SESSION_MS);
    await t.sessions.extendSession(id, 10);
    expect(s.endAt).toBe(T0 + 60 * 60_000);
    expect(t.store.usage.counterSum('sessions', ['2026-10-05'])).toBe(2);
  });

  it('ending early costs a confirmation; a session that cannot be interrupted refuses; a future one is cancelled', async () => {
    const t = await setup([]);
    const { tickets } = { tickets: await import('../../src/background/tickets') };
    const a = await t.sessions.startSession({
      kind: 'groups',
      groups: ['x'],
      allow: [],
      minutes: 30,
      locked: false,
      noPauses: false,
    });
    const locked = await t.sessions.startSession({
      kind: 'groups',
      groups: ['x'],
      allow: [],
      minutes: 30,
      locked: true,
      noPauses: false,
    });
    const later = await t.sessions.startSession({
      kind: 'groups',
      groups: ['x'],
      allow: [],
      minutes: 30,
      startInMinutes: 60,
      locked: false,
      noPauses: false,
    });
    expect(await t.sessions.endSession(locked.id)).toEqual({ ticket: null, refused: 'session.error.locked' });
    expect(await t.sessions.endSession('none')).toEqual({ ticket: null, refused: 'session.error.notFound' });
    const end = await t.sessions.endSession(a.id);
    expect(await tickets.answerTicket(end.ticket!.id, '')).toMatchObject({ status: 'done' });
    expect(t.store.state.sessions.find((s) => s.id === a.id)?.endAt).toBe(T0);
    const cancel = await t.sessions.endSession(later.id);
    await tickets.answerTicket(cancel.ticket!.id, '');
    expect(t.store.state.sessions.some((s) => s.id === later.id)).toBe(false);
  });

  it('giving up the rest of a limit ends it for its period, and the accesses of the rule', async () => {
    const t = await setup([
      group(
        'A',
        ['a.test'],
        [
          { budget: { type: 'time', minutes: 30, period: { kind: 'day' } }, intervention: BLOCK },
          { budget: { type: 'time', minutes: 30, period: { kind: 'rolling', n: 90 } }, intervention: BLOCK },
          { budget: { type: 'session', maxMinutes: 20, cooldownMinutes: 15 }, intervention: BLOCK },
        ],
      ),
    ]);
    t.store.state.grants.push({
      id: 'g',
      kind: 'pass',
      groups: ['A'],
      scope: 'site',
      site: 'a.test',
      createdAt: T0,
      until: T0 + 60_000,
      severity: 5,
    });
    await t.budget.forfeitBudget('A');
    expect(t.store.state.forfeits).toEqual({
      'A-p0': new Date(2026, 9, 6).getTime(),
      'A-p1': T0 + 90 * 60_000,
    });
    expect(t.store.state.cooldowns['session:A-p2']).toMatchObject({ until: T0 + 15 * 60_000 });
    expect(t.store.state.grants).toEqual([]);
    await t.budget.forfeitBudget('missing');
  });
});
