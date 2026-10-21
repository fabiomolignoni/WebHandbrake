import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileConfig } from '../../src/engine/compile';
import { defaultOptions, delayIntervention } from '../../src/engine/defaults';
import type { Group } from '../../src/engine/types';
import { type FakeBrowser, installFakeBrowser } from './fake-browser';
import { BLOCK, group, REMINDER } from './helpers';

const T0 = new Date(2026, 9, 5, 10).getTime();
const office = { mode: 'during' as const, windows: [{ days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 }] };
const evening = {
  mode: 'during' as const,
  windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: 18 * 60, end: 23 * 60 }],
};

let fake: FakeBrowser;

async function setup(groups: Group[]) {
  vi.doMock('../../src/background/reconcile', () => ({ reconcile: async () => {}, broadcast: () => {} }));
  const { store } = await import('../../src/background/store');
  await store.ready();
  store.config = { ...store.config, groups };
  store.cc = compileConfig(store.config);
  return { store };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  fake = installFakeBrowser({
    tabs: [
      { id: 1, url: 'https://a.test/', active: true, incognito: false, title: 'A' },
      {
        id: 2,
        url: 'chrome-extension://test/intervention.html#https://a.test/x',
        active: false,
        incognito: false,
      },
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../../src/background/reconcile');
});

describe('what the popup and the dashboard show', () => {
  it('the popup: the site of the active tab, its decision, the break, the rules to add it to', async () => {
    const soft = group('A', ['a.test'], [{ schedule: office, intervention: BLOCK }], {
      protection: REMINDER,
    });
    soft.pause = {
      ...soft.pause,
      allowed: true,
      scopes: ['site'],
      cost: { type: 'confirm' },
      reason: 'none',
    };
    await setup([soft, group('Off', ['off.test'], [], { enabled: false })]);
    const { popupModel } = await import('../../src/background/views');
    const m = await popupModel();
    expect(m.tab).toEqual({ id: 1, url: 'https://a.test/', host: 'a.test', title: 'A', incognito: false });
    expect(m.decision?.intervention).toEqual(BLOCK);
    expect(m.decision?.until).toBe(new Date(2026, 9, 5, 17).getTime());
    expect(m.pause?.available).toBe(true);
    expect(m.groups.map((g) => g.id)).toEqual(['A']);
    expect(m).toMatchObject({ canAdd: true, canFocus: true, restorable: 0, quickMinutes: [25, 50, 90] });
    // The tab of an intervention page shows the page it replaced.
    expect((await popupModel(2)).tab?.url).toBe('https://a.test/x');
  });

  it('"Block this site" goes to a rule that blocks the page right now, and says what each rule would do', async () => {
    await setup([
      group('Asks', ['x.test'], [{ intervention: delayIntervention(10) }]),
      group('Evening', ['y.test'], [{ intervention: BLOCK, schedule: evening }]),
      group('Always', ['z.test'], [{ intervention: BLOCK }]),
    ]);
    const { popupModel } = await import('../../src/background/views');
    const m = await popupModel();
    expect(m.addTo).toBe('Always');
    expect(m.groups.map((g) => [g.id, g.blocksNow, g.blockAt])).toEqual([
      ['Asks', false, null],
      ['Evening', false, new Date(2026, 9, 5, 18).getTime()],
      ['Always', true, null],
    ]);
    // Without a rule that blocks now, a new one.
    await setup([group('Evening', ['y.test'], [{ intervention: BLOCK, schedule: evening }])]);
    expect((await popupModel()).addTo).toBeNull();
  });

  it('no break where no rule blocks the page', async () => {
    const { popupModel } = await import('../../src/background/views');
    // A break lifts a block only: a rule that counts, filters, asks or waits offers none.
    for (const intervention of [
      { type: 'track' as const },
      { type: 'filter' as const, filter: 'grayscale' as const },
      delayIntervention(30),
    ]) {
      const g = group('A', ['a.test'], [{ intervention }]);
      g.pause = { ...g.pause, allowed: true };
      await setup([g]);
      expect((await popupModel(1)).pause, intervention.type).toBeNull();
    }
  });

  it('the overview: rules with their state, what changes next, today, warnings', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ schedule: office, intervention: BLOCK }]),
      group('Archived', ['z.test'], [{ intervention: BLOCK }], { archived: true }),
    ]);
    fake.permissions.incognito = false;
    t.store.state.clockOffset = 20 * 60_000;
    t.store.usage.count('shown:A', T0, t.store.cc.cal, 3);
    t.store.usage.count('proceeded:A', T0, t.store.cc.cal, 1);
    t.store.usage.count('offered:A', T0, t.store.cc.cal, 3);
    t.store.usage.count('took:A', T0, t.store.cc.cal, 1);
    const { overviewModel } = await import('../../src/background/views');
    const o = await overviewModel();
    expect(o.groups.map((g) => [g.id, g.intervention?.type, g.until])).toEqual([
      ['A', 'block', new Date(2026, 9, 5, 17).getTime()],
    ]);
    expect(o.upcoming).toEqual([
      {
        at: new Date(2026, 9, 5, 17).getTime(),
        groupId: 'A',
        label: 'ends',
        intervention: { type: 'track' },
      },
    ]);
    expect(o.today).toMatchObject({ shown: 3, proceeded: 1, impulses: 2 });
    expect(o.warnings.map((w) => w.kind)).toEqual(['incognito', 'clock']);
  });

  it('a break or an access on one site of a rule leaves the rule restricting its other sites', async () => {
    const blocked = group('A', ['a.test', 'b.test'], [{ schedule: office, intervention: BLOCK }]);
    blocked.pause = { ...blocked.pause, allowed: true, scopes: ['site'] };
    const asks = group(
      'Q',
      ['q.test', 'r.test'],
      [{ intervention: { type: 'ask', choices: [5], maxMinutes: 5 } }],
    );
    const t = await setup([blocked, asks]);
    const grant = { createdAt: T0, groups: [] as string[], scope: 'site' as const, until: T0 + 5 * 60_000 };
    t.store.state.grants.push(
      { ...grant, id: 'p', kind: 'pause', groups: ['A'], site: 'a.test', severity: 99 },
      { ...grant, id: 'q', kind: 'pass', groups: ['Q'], site: 'q.test', severity: 50 },
    );
    const { overviewModel } = await import('../../src/background/views');
    const o = await overviewModel();
    // b.test is still blocked until 17:00 and r.test still asks: the first site does not speak for them.
    expect(o.groups.map((g) => [g.id, g.intervention?.type, g.pause, g.until])).toEqual([
      ['A', 'block', null, new Date(2026, 9, 5, 17).getTime()],
      ['Q', 'ask', null, null],
    ]);
    expect(o.upcoming.map((u) => [u.groupId, u.label, u.at])).toEqual([
      ['A', 'ends', new Date(2026, 9, 5, 17).getTime()],
    ]);
    const { configModel } = await import('../../src/background/views');
    expect((await configModel()).groups.A.activeNow).toBe(true);
    // A break on every site of the rule: the rule is on a break.
    t.store.state.grants.push({
      ...grant,
      id: 'p2',
      kind: 'pause',
      groups: ['A'],
      site: 'b.test',
      severity: 99,
    });
    const [a] = (await overviewModel()).groups;
    expect([a.intervention?.type, a.pause?.until]).toEqual(['track', T0 + 5 * 60_000]);
  });

  it('the configuration model: each rule, its protection now and whether it restricts now', async () => {
    await setup([
      group('A', ['a.test'], [{ schedule: office, intervention: BLOCK }], {
        protection: { kind: 'locked', until: T0 - 1 },
      }),
    ]);
    const { configModel } = await import('../../src/background/views');
    const m = await configModel();
    expect(m.groups.A).toEqual({ protection: { kind: 'reminder' }, lockedNow: false, activeNow: true });
    expect(m.platform).toMatchObject({ contextMenus: true, commands: true });
  });

  it('the badge counts down the time left near a limit', async () => {
    const t = await setup([
      group(
        'A',
        ['a.test'],
        [{ budget: { type: 'time', minutes: 10, period: { kind: 'day' } }, intervention: BLOCK }],
      ),
    ]);
    t.store.usage.add('g:A', T0, 9 * 60, 1, t.store.cc.cal);
    const { updateBadge } = await import('../../src/background/badge');
    await updateBadge(1, 'https://a.test/', false);
    expect(fake.badges.get(1)).toMatchObject({ text: '1m', color: '#4850a5' });
    t.store.config.settings.badge.enabled = false;
    await updateBadge(1, 'https://a.test/', false);
    expect(fake.badges.get(1)?.text).toBe('');
  });
});

describe('menus and shortcuts', () => {
  it('the context menu lists the active rules and focus sessions', async () => {
    await setup([
      group('A', ['a.test'], [{ intervention: BLOCK }]),
      group('Off', ['o.test'], [], { enabled: false }),
    ]);
    const { rebuildMenus } = await import('../../src/background/menus');
    await rebuildMenus();
    expect(fake.menus.map((m) => m.id)).toEqual([
      'site',
      'site|A',
      'site|new',
      'page',
      'page|A',
      'page|new',
      'link',
      'link|A',
      'link|new',
      'focus',
      'focus|25',
      'focus|50',
      'focus|90',
    ]);
  });

  it('a click adds the page or the link to a rule; a focus item starts a session', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    const { onMenuClicked } = await import('../../src/background/menus');
    await onMenuClicked({
      menuItemId: 'link|A',
      linkUrl: 'https://b.test/x',
      editable: false,
    } as chrome.contextMenus.OnClickData);
    await onMenuClicked({
      menuItemId: 'page|new',
      pageUrl: 'https://c.test/p',
      editable: false,
    } as chrome.contextMenus.OnClickData);
    expect(t.store.config.groups.map((g) => g.targets.map((x) => x.value))).toEqual([
      ['a.test', 'b.test'],
      ['c.test/p'],
    ]);
    await onMenuClicked({ menuItemId: 'focus|50', editable: false } as chrome.contextMenus.OnClickData);
    expect(t.store.state.sessions[0].endAt - t.store.state.sessions[0].startAt).toBe(50 * 60_000);
  });

  it('the shortcut adds the site to the last rule used, or the first one, that blocks it right now', async () => {
    const t = await setup([
      group('Evening', ['e.test'], [{ intervention: BLOCK, schedule: evening }]),
      group('A', ['a.test'], [{ intervention: BLOCK }]),
      group('B', ['b.test'], [{ intervention: BLOCK }]),
    ]);
    const { onCommand } = await import('../../src/background/menus');
    t.store.meta.lastAddGroup = 'B';
    await onCommand('block-site', { id: 9, url: 'https://new.test/x' } as chrome.tabs.Tab);
    expect(t.store.config.groups[2].targets.map((x) => x.value)).toEqual(['b.test', 'new.test']);
    // Archived: the first rule that blocks now, not one that blocks only in the evening.
    t.store.config.groups[2].archived = true;
    t.store.cc = compileConfig(t.store.config);
    await onCommand('block-site', { id: 9, url: 'https://other.test/' } as chrome.tabs.Tab);
    expect(t.store.config.groups[1].targets.map((x) => x.value)).toEqual(['a.test', 'other.test']);
    // None blocks now: a new rule that blocks at all times, without breaks, as from the wizard.
    t.store.config.groups[1].archived = true;
    t.store.cc = compileConfig(t.store.config);
    t.store.meta.lastAddGroup = 'Evening';
    await onCommand('block-site', { id: 9, url: 'https://third.test/' } as chrome.tabs.Tab);
    const added = t.store.config.groups[3];
    expect(added).toMatchObject({ name: 'Blocked sites', pause: { allowed: false } });
    expect(added.targets.map((x) => x.value)).toEqual(['third.test']);
    await onCommand('open-dashboard');
    expect(fake.created.map((x) => x.url)).toEqual(['chrome-extension://test/dashboard.html']);
    await onCommand('start-session');
    expect(t.store.state.sessions).toHaveLength(1);
  });

  it('without a rule for quick sessions, no focus item and the shortcut opens the Focus page', async () => {
    const t = await setup([
      group('A', ['a.test'], [{ intervention: BLOCK }], {
        options: { ...defaultOptions(), quickSession: false },
      }),
    ]);
    const { onCommand, rebuildMenus } = await import('../../src/background/menus');
    await rebuildMenus();
    expect(fake.menus.map((m) => m.id)).not.toContain('focus');
    await onCommand('start-session');
    expect(t.store.state.sessions).toHaveLength(0);
    expect(fake.created.map((x) => x.url)).toEqual(['chrome-extension://test/dashboard.html#/focus']);
  });
});

describe('messages', () => {
  const ask = async (msg: unknown, sender: Partial<chrome.runtime.MessageSender>) => {
    const { onMessage } = await import('../../src/background/messages');
    return new Promise((resolve) => {
      const async = onMessage(msg, { id: 'test', ...sender } as chrome.runtime.MessageSender, resolve);
      if (!async) setTimeout(() => resolve('no answer'), 0);
    });
  };
  const page = { url: 'chrome-extension://test/dashboard.html' };
  const site = { url: 'https://evil.test/', tab: { id: 1 } as chrome.tabs.Tab };

  it('answers the pages of the extension', async () => {
    await setup([]);
    expect(await ask({ whb: 1, method: 'later.list', args: {} }, page)).toEqual({
      ok: true,
      value: { items: [] },
    });
    expect(await ask({ whb: 1, method: 'nope', args: {} }, page)).toEqual({
      ok: false,
      error: 'unknown method',
    });
  });

  it('web pages may only send ticks; other extensions and other messages get no answer', async () => {
    await setup([]);
    expect(await ask({ whb: 1, method: 'data.reset', args: {} }, site)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await ask({ whb: 1, method: 'later.list', args: {} }, { ...page, id: 'other' })).toBe('no answer');
    expect(await ask({ hello: 1 }, page)).toBe('no answer');
    const tick = (await ask(
      { whb: 1, method: 'cs.tick', args: { url: 'https://evil.test/', active: true, media: false } },
      site,
    )) as {
      ok: boolean;
    };
    expect(tick.ok).toBe(true);
  });

  it('errors are answered, not thrown', async () => {
    await setup([]);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await ask({ whb: 1, method: 'data.preview', args: {} }, page)).toMatchObject({ ok: false });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('diagnostics and permissions', () => {
  it('the report hides the addresses unless asked', async () => {
    const t = await setup([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    // Off by default: the log keeps full addresses.
    expect(t.store.config.settings.diagnostics.decisionLog).toBe(false);
    t.store.config.settings.diagnostics.decisionLog = true;
    const { logDecision } = await import('../../src/background/diagnostics-state');
    await logDecision(true, 'navigation', 'https://secret.test/private?x=1', 'block', 'A');
    const { diagReport } = await import('../../src/background/diagnostics');
    const hidden = await diagReport(false);
    expect(hidden).toContain('Groups: 1 (1 active)');
    expect(hidden).toContain('navigation block https://…');
    expect(hidden).not.toContain('secret.test');
    expect(await diagReport(true)).toContain('https://secret.test/private?x=1');
  });

  it('losing access to the sites or to private windows is a protection event', async () => {
    const t = await setup([]);
    const { permissionsChanged } = await import('../../src/background/permissions');
    await permissionsChanged();
    expect(t.store.state.tamper).toEqual([]);
    fake.permissions.hostAccess = false;
    fake.permissions.incognito = false;
    await permissionsChanged();
    expect(t.store.state.tamper.map((e) => e.kind)).toEqual(['host-permission', 'private-access']);
  });

  it('notifications only when turned on and allowed', async () => {
    const t = await setup([]);
    const { notify } = await import('../../src/background/notifications');
    await notify('x', 'T', 'M');
    t.store.config.settings.notifications.enabled = true;
    fake.permissions.notifications = false;
    await notify('y', 'T', 'M');
    fake.permissions.notifications = true;
    await notify('z', 'T', 'M');
    expect(fake.notifications.map((n) => n.id)).toEqual(['z']);
  });
});
