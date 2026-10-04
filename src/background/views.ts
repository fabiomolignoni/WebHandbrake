/** Read models for the dashboard and the popup. */

import { activeSessions, decide, grantActive, isNav, SEVERITY } from '../engine/decide';
import { dayKeyOf } from '../engine/time';
import type { FocusSession } from '../engine/types';
import { displayHost, parseUrl } from '../engine/url';
import { api, blockedUrlFrom, features, isAndroid, isFirefox, quiet } from '../platform/api';
import type {
  ConfigModel,
  Overview,
  PopupModel,
  TodayStats,
  UpcomingChange,
  Warning,
} from '../shared/models';
import { dnrStatus } from './dnr-sync';
import { restorableTabs } from './enforce';
import { ctx, decisionView, globalLevel, groupActiveNow, groupLevel, groupStatus, lockedNow } from './engine';
import { activePauses, pauseOptions } from './pauses';
import { store } from './store';

export function todayStats(): TodayStats {
  const c = ctx();
  const day = store.usage.days.get(dayKeyOf(c.now, store.cc.cal));
  const sum = (prefix: string) =>
    Object.entries(day?.c ?? {})
      .filter(([k]) => k.startsWith(prefix))
      .reduce((a, [, v]) => a + v, 0);
  const shown = sum('shown:');
  const proceeded = sum('proceeded:');
  return {
    seconds: day?.t['a:']?.[0] ?? 0,
    shown,
    proceeded,
    impulses: Math.max(0, shown - proceeded),
    pauses: sum('pause:'),
    sessions: day?.c.sessions ?? 0,
  };
}

export async function warnings(): Promise<Warning[]> {
  const out: Warning[] = [];
  const t0 = ctx().now;
  if (!dnrStatus.hostAccess) out.push({ kind: 'host-permission' });
  try {
    if (!(await api.extension.isAllowedIncognitoAccess())) out.push({ kind: 'incognito' });
  } catch {
    // not available
  }
  const r = store.meta.restored;
  if (r && t0 - r.at < 7 * 86_400_000 && store.meta.dismissedRestore !== r.at) {
    out.push({ kind: 'restored', at: r.snapshotAt ?? undefined });
  }
  if (dnrStatus.lastError) out.push({ kind: 'dnr-error', detail: dnrStatus.lastError });
  if (dnrStatus.overflow.length)
    out.push({ kind: 'dnr-overflow', detail: String(dnrStatus.overflow.length) });
  const recent = store.state.tamper.filter((e) => t0 - e.at < 7 * 86_400_000 && e.kind !== 'emergency');
  if (recent.length)
    out.push({ kind: 'tamper', at: recent[recent.length - 1].at, detail: recent[recent.length - 1].kind });
  const ready = store.state.pending.filter((p) => p.readyAt <= t0).length;
  if (ready) out.push({ kind: 'pending-ready', detail: String(ready) });
  if (store.state.clockOffset)
    out.push({ kind: 'clock', detail: String(Math.round(store.state.clockOffset / 60_000)) });
  return out;
}

export async function overviewModel(): Promise<Overview> {
  await store.ready();
  const c = ctx();
  const groups = store.config.groups.filter((g) => !g.archived).map((g) => groupStatus(g, c));
  const sessions = store.state.sessions.filter((s) => s.endAt > c.now);
  const upcoming: UpcomingChange[] = [];
  for (const g of groups) {
    if (!g.enabled || !g.nextChange) continue;
    upcoming.push({
      at: g.nextChange.at,
      groupId: g.id,
      label: isNav({ severity: SEVERITY[g.nextChange.intervention.type] }) ? 'starts' : 'ends',
      intervention: g.nextChange.intervention,
    });
  }
  for (const s of sessions) {
    if (s.startAt > c.now)
      upcoming.push({
        at: s.startAt,
        groupId: null,
        label: 'session-start',
        intervention: { type: 'block' },
      });
    upcoming.push({ at: s.endAt, groupId: null, label: 'session-end', intervention: null });
  }
  upcoming.sort((a, b) => a.at - b.at);
  return {
    now: c.now,
    groups,
    sessions,
    upcoming: upcoming.slice(0, 8),
    today: todayStats(),
    pending: store.state.pending,
    warnings: await warnings(),
    level: globalLevel(c.now),
    lockedUntil: store.config.settings.protection.lockedUntil,
    emergency: store.state.emergency,
    restorable: (await restorableTabs()).length,
    laterCount: store.later.length,
    pauses: activePauses(),
  };
}

export async function configModel(): Promise<ConfigModel> {
  await store.ready();
  const c = ctx();
  const groups: ConfigModel['groups'] = {};
  for (const g of store.config.groups) {
    groups[g.id] = {
      level: groupLevel(g, c.now),
      lockedNow: lockedNow(g, c),
      activeNow: groupActiveNow(g, c),
    };
  }
  return {
    config: store.config,
    now: c.now,
    groups,
    globalLockedNow: lockedNow(null, c),
    hasPassword: Boolean(store.config.settings.protection.access.passwordHash),
    platform: {
      android: isAndroid,
      firefox: isFirefox,
      contextMenus: features.contextMenus,
      commands: features.commands,
    },
  };
}

export async function popupModel(tabId?: number): Promise<PopupModel> {
  await store.ready();
  const c = ctx();
  let tab: chrome.tabs.Tab | undefined;
  if (tabId !== undefined) tab = await quiet(api.tabs.get(tabId));
  else tab = (await quiet(api.tabs.query({ active: true, currentWindow: true })))?.[0];
  const rawUrl = tab?.url ?? '';
  const url = blockedUrlFrom(rawUrl) ?? rawUrl;
  const parsed = url ? parseUrl(url) : null;
  const incognito = Boolean(tab?.incognito);
  const evaluable = Boolean(parsed && !/^(chrome|moz)-extension:/.test(url));
  const d = evaluable ? decide(c, url, { incognito }) : null;
  const sessions: FocusSession[] = store.state.sessions.filter((s) => s.endAt > c.now);
  const pause = d?.groups.length ? pauseOptions(url, undefined, incognito) : null;
  return {
    tab:
      tab && tab.id !== undefined
        ? { id: tab.id, url, host: displayHost(url), title: tab.title ?? '', incognito }
        : null,
    decision: d ? decisionView(d, { incognito }, c) : null,
    groups: store.config.groups
      .filter((g) => g.enabled && !g.archived)
      .map((g) => ({ id: g.id, name: g.name, color: g.color })),
    sessions,
    today: todayStats(),
    pause,
    activePauses: store.state.grants.filter((g) => g.kind === 'pause' && grantActive(c, g)),
    restorable: (await restorableTabs()).length,
    pendingReady: store.state.pending.filter((p) => p.readyAt <= c.now).length,
    warnings: (await warnings()).filter((w) => w.kind === 'host-permission' || w.kind === 'dnr-error'),
    laterCount: store.later.length,
    canAdd: Boolean(parsed?.web),
    quickMinutes: [25, 50, 90],
    onboarded: store.config.settings.onboarded,
  };
}

export function sessionsNow() {
  return activeSessions(store.state, ctx().now);
}
