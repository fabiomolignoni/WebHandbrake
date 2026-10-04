/**
 * Enforcement on open tabs and navigations (ENF-02…ENF-12, PRO-08).
 *
 * DNR rules stop most navigations before they reach the network. This module is the second
 * layer: it re-checks committed navigations, SPA route changes, back/forward cache restores,
 * internal browser pages and every open tab whenever the state changes.
 */

import { type Decision, isNav } from '../engine/decide';
import { parseUrl } from '../engine/url';
import { api, blockedUrlFrom, extensionUrl, interventionUrl, isAndroid, quiet } from '../platform/api';
import { now } from './clock';
import { counters, logDecision } from './diagnostics-state';
import { dnrStatus } from './dnr-sync';
import { ctx, decideUrl, groupActiveNow, groupLevel } from './engine';
import { store } from './store';

/** Tabs in their grace period (INT-13): tab id → deadline. */
const graceTabs = new Map<number, number>();
/** Tabs showing an intervention page: tab id → info (STA-03 "left" accounting). */
export const interventionTabs = new Map<
  number,
  { url: string; groupId: string | null; proceeded: boolean }
>();

const INTERNAL_PAGES = [
  'about:addons',
  'about:debugging',
  'about:config',
  'about:support',
  'about:profiles',
  'chrome://extensions',
  'chrome://settings',
  'chrome://flags',
  'edge://extensions',
  'edge://settings',
  'edge://flags',
  'brave://extensions',
  'brave://settings',
  'brave://flags',
  'vivaldi://extensions',
  'vivaldi://settings',
  'vivaldi://flags',
  'opera://extensions',
  'opera://settings',
  'opera://flags',
];

export function isProtectedInternal(url: string): boolean {
  const u = url.toLowerCase();
  return INTERNAL_PAGES.some(
    (p) => u === p || u.startsWith(`${p}/`) || u.startsWith(`${p}?`) || u.startsWith(`${p}#`),
  );
}

/** PRO-08: whether the browser's extension and settings pages are blocked right now. */
export function internalPagesBlocked(): boolean {
  const p = store.config.settings.protection;
  if (p.internalPages === 'never') return false;
  const c = ctx();
  if (
    p.internalPagesFollowPause &&
    c.state.grants.some(
      (g) => g.kind === 'pause' && (g.until ?? Number.POSITIVE_INFINITY) > c.now && (g.remaining ?? 1) > 0,
    )
  ) {
    return false;
  }
  if (p.internalPages === 'always') return true;
  if (c.state.sessions.some((s) => s.locked && s.startAt <= c.now && c.now < s.endAt)) return true;
  for (const cg of c.cc.groups) {
    const level = groupLevel(cg.group, c.now);
    if ((level === 'strict' || level === 'locked') && groupActiveNow(cg.group, c)) return true;
  }
  return false;
}

function shouldEnforce(d: Decision, tab: chrome.tabs.Tab, onNavigation: boolean): boolean {
  if (!isNav(d) || d.exempt) return false;
  if (onNavigation) return true;
  const scope = d.primary?.group.options.tabs ?? 'all';
  if (scope === 'active') return Boolean(tab.active);
  if (scope === 'inactive') return !tab.active;
  return true;
}

async function redirectTab(tabId: number, url: string) {
  counters.enforcements++;
  await quiet(api.tabs.update(tabId, { url: interventionUrl(url) }));
}

/**
 * Applies the current decision to one tab. On state changes (not navigations) a tab where the
 * user is typing gets a grace period first (INT-13), and full screen is left (ENF-11).
 */
export async function enforceTab(
  tab: chrome.tabs.Tab,
  reason: 'navigation' | 'state' | 'activation',
): Promise<boolean> {
  if (tab.id === undefined || !tab.url) return false;
  const url = tab.url;
  if (url.startsWith(extensionUrl(''))) return false;
  if (isProtectedInternal(url)) {
    if (internalPagesBlocked()) {
      void logDecision(store.config.settings.diagnostics.decisionLog, 'internal', url, 'block');
      await redirectTab(tab.id, url);
      return true;
    }
    return false;
  }
  const p = parseUrl(url);
  if (!p) return false;
  const d = decideUrl(url, Boolean(tab.incognito));
  if (!shouldEnforce(d, tab, reason === 'navigation')) return false;

  if (reason !== 'navigation') {
    const deadline = graceTabs.get(tab.id);
    const t = now();
    if (deadline && t < deadline) return false;
    if (deadline === undefined) {
      const grace = store.config.settings.interventions.graceSeconds;
      const res = (await quiet(
        api.tabs.sendMessage(tab.id, { whb: 1, cmd: 'prepare', graceSeconds: grace }),
      )) as { grace?: number } | undefined;
      if (res?.grace) {
        graceTabs.set(tab.id, t + res.grace * 1000 + 3000);
        setTimeout(() => void finishGrace(tab.id!), res.grace * 1000 + 3500);
        return false;
      }
    }
  }
  graceTabs.delete(tab.id);
  void logDecision(
    store.config.settings.diagnostics.decisionLog,
    reason === 'navigation' ? 'navigation' : 'tab',
    url,
    d.intervention.type,
    d.primary?.group.name,
  );
  await redirectTab(tab.id, url);
  return true;
}

export async function finishGrace(tabId: number) {
  if (!graceTabs.has(tabId)) return;
  graceTabs.set(tabId, 0);
  const tab = await quiet(api.tabs.get(tabId));
  if (tab) await enforceTab(tab, 'state');
  graceTabs.delete(tabId);
}

/** ENF-02: applies the current state to every open tab. */
export async function enforceAllTabs() {
  const tabs = await quiet(api.tabs.query({}));
  if (!tabs) return;
  await Promise.all(tabs.map((tab) => enforceTab(tab, 'state').catch(() => false)));
  // Refresh in-page state (filters, timers) of tabs that stay.
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) continue;
    void quiet(api.tabs.sendMessage(tab.id, { whb: 1, cmd: 'refresh' }));
  }
}

/** Number of tabs showing an intervention for a URL that is allowed again (ENF-04). */
export async function restorableTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = (await quiet(api.tabs.query({}))) ?? [];
  return tabs.filter((tab) => {
    const blocked = blockedUrlFrom(tab.url);
    if (!blocked || !/^https?:/.test(blocked)) return false;
    return !isNav(decideUrl(blocked, Boolean(tab.incognito)));
  });
}

export async function reopenBlockedTabs(): Promise<number> {
  const tabs = await restorableTabs();
  for (const tab of tabs) {
    const blocked = blockedUrlFrom(tab.url);
    if (tab.id !== undefined && blocked) await quiet(api.tabs.update(tab.id, { url: blocked }));
  }
  return tabs.length;
}

// ---------------------------------------------------------------------------
// Navigation listeners
// ---------------------------------------------------------------------------

function onTopFrame<T extends { frameId: number; tabId: number; url: string }>(fn: (d: T) => void) {
  return (d: T) => {
    if (d.frameId !== 0 || d.tabId < 0) return;
    fn(d);
  };
}

async function checkNavigation(tabId: number, url: string, reason: 'navigation' | 'state') {
  await store.ready();
  if (url.startsWith(extensionUrl(''))) {
    // Track intervention pages for STA-03 ("left" without proceeding).
    const blocked = blockedUrlFrom(url);
    if (blocked && !interventionTabs.has(tabId)) {
      const d = decideUrl(blocked, null);
      interventionTabs.set(tabId, { url: blocked, groupId: d.primary?.group.id ?? null, proceeded: false });
    }
    return;
  }
  interventionTabs.delete(tabId);
  const tab = await quiet(api.tabs.get(tabId));
  if (!tab) return;
  tab.url = url;
  await enforceTab(tab, reason);
}

export function registerNavigationListeners() {
  const nav = api.webNavigation;
  if (!nav) return;
  // Second layer after DNR: committed navigations (ENF-01 fallback, MAT-19 scoped groups).
  nav.onCommitted.addListener(onTopFrame((d) => void checkNavigation(d.tabId, d.url, 'navigation')));
  // ENF-03: single page applications.
  nav.onHistoryStateUpdated.addListener(
    onTopFrame((d) => {
      void (async () => {
        await checkNavigation(d.tabId, d.url, 'navigation');
        // The content script may be idle on a page that was not tracked: wake it up.
        void quiet(api.tabs.sendMessage(d.tabId, { whb: 1, cmd: 'refresh' }));
      })();
    }),
  );
  nav.onReferenceFragmentUpdated.addListener(
    onTopFrame((d) => {
      if (store.cc.groups.some((g) => g.index.all.some((cp) => cp.fragment !== null))) {
        void checkNavigation(d.tabId, d.url, 'navigation');
      }
    }),
  );
  // Groups limited to normal or private windows are not in the DNR rules: act early.
  nav.onBeforeNavigate.addListener(
    onTopFrame((d) => {
      void (async () => {
        await store.ready();
        if (!store.cc.groups.some((g) => g.group.options.privacy !== 'all')) return;
        const tab = await quiet(api.tabs.get(d.tabId));
        if (!tab) return;
        const real = decideUrl(d.url, Boolean(tab.incognito));
        const viaDnr = decideUrl(d.url, null);
        if (isNav(real) && !isNav(viaDnr)) await redirectTab(d.tabId, d.url);
      })();
    }),
  );
  // ENF-12: without host access DNR can only block; show the intervention page instead.
  nav.onErrorOccurred.addListener(
    onTopFrame((d) => {
      const err = (d as unknown as { error?: string }).error ?? '';
      if (dnrStatus.hostAccess || !/BLOCKED_BY_CLIENT|NS_ERROR_ABORT|blocked/i.test(err)) return;
      void (async () => {
        await store.ready();
        const tab = await quiet(api.tabs.get(d.tabId));
        if (tab && isNav(decideUrl(d.url, Boolean(tab.incognito)))) await redirectTab(d.tabId, d.url);
      })();
    }),
  );
}

export function registerTabListeners(onActivated: (tabId: number) => void) {
  api.tabs.onUpdated.addListener((_tabId, info, tab) => {
    if (!info.url) return;
    // Internal pages, local files, reader mode and view-source are not seen by DNR (MAT-09, TIM-06).
    if (/^https?:/i.test(info.url)) return;
    void (async () => {
      await store.ready();
      if (info.url!.startsWith(extensionUrl(''))) return;
      await enforceTab({ ...tab, url: info.url }, 'navigation');
    })();
  });
  api.tabs.onActivated.addListener(({ tabId }) => {
    void (async () => {
      await store.ready();
      const tab = await quiet(api.tabs.get(tabId));
      if (tab) await enforceTab(tab, 'activation');
      onActivated(tabId);
    })();
  });
  api.tabs.onRemoved.addListener((tabId) => {
    graceTabs.delete(tabId);
    const info = interventionTabs.get(tabId);
    interventionTabs.delete(tabId);
    if (info && !info.proceeded && info.groupId) {
      void (async () => {
        await store.ready();
        store.usage.count(`left:${info.groupId}`, now(), store.cc.cal);
        store.scheduleUsage();
      })();
    }
  });
}

export const platformNotes = { android: isAndroid };
