/**
 * Enforcement on open tabs and navigations.
 *
 * DNR rules stop most navigations before they reach the network. This module is the second
 * layer: it re-checks committed navigations, SPA route changes, back/forward cache restores,
 * internal browser pages and every open tab whenever the state changes.
 */

import type { Decision, EngineContext } from '../engine/decide';
import { activeSessions } from '../engine/decide';
import { candidateTimes } from '../engine/next';
import { isNav, NAV_SEVERITY, SEVERITY } from '../engine/severity';
import type { Group } from '../engine/types';
import { parseUrl } from '../engine/url';
import { api, blockedUrlFrom, extensionUrl, interventionUrl, quiet } from '../platform/api';
import { now } from './clock';
import { counters, logDecision } from './diagnostics-state';
import { dnrStatus } from './dnr-sync';
import { ctx, decideUrl, firmProtection, groupActiveNow, groupProtection } from './engine';
import { store } from './store';

/** Tabs in their grace period: tab id → deadline. */
const graceTabs = new Map<number, number>();
/**
 * Tabs showing an intervention page: tab id → info, for the statistics. `offered`: the page
 * offered a way in (a question, a wait, a challenge, a break) and was opened, so leaving it is a
 * choice not to go in.
 */
export const interventionTabs = new Map<
  number,
  { url: string; groupId: string | null; proceeded: boolean; offered: boolean }
>();
/**
 * Tabs whose page was replaced by an intervention page because the rules changed while it was
 * open (a rule created, the site blocked from the popup): tab id → the address. That is not an
 * attempt to go in. A page replaced as time goes by (a limit used up, a break over) still offers
 * the choice to go on or to leave.
 */
export const replacedTabs = new Map<number, string>();

/**
 * The pages from which WebHandbrake can be turned off or removed: the extension managers, the
 * flags, Firefox's troubleshooting pages (Refresh Firefox, troubleshoot mode) and the reset of a
 * Chromium browser's settings, which turns every extension off. The rest of the settings
 * (passwords, privacy, search engine…) has nothing to do with the extension and stays open.
 */
const CHROMIUM = ['chrome', 'edge', 'brave', 'vivaldi', 'opera'];
const INTERNAL_PAGES = [
  'about:addons',
  'about:debugging',
  'about:config',
  'about:support',
  'about:profiles',
  ...CHROMIUM.flatMap((b) => [`${b}://extensions`, `${b}://flags`]),
];
/** Prefixes of the settings resets: "settings/reset" also covers "settings/resetProfileSettings". */
const SETTINGS_RESETS = CHROMIUM.flatMap((b) => [`${b}://settings/reset`, `${b}://settings/triggeredreset`]);

export function isProtectedInternal(url: string): boolean {
  const u = url.toLowerCase();
  return (
    INTERNAL_PAGES.some(
      (p) => u === p || u.startsWith(`${p}/`) || u.startsWith(`${p}?`) || u.startsWith(`${p}#`),
    ) || SETTINGS_RESETS.some((p) => u.startsWith(p))
  );
}

/** Why the browser's extension and settings pages are blocked. */
export interface InternalGuard {
  /** "Block the browser's extension and settings pages" is set to Always. */
  always: boolean;
  /** The firmly protected rules that restrict sites. */
  groups: Group[];
  /** A focus session that cannot be interrupted is running. */
  session: boolean;
}

/** Why the browser's extension and settings pages are blocked at the context's time, or null. */
export function internalGuard(c: EngineContext = ctx()): InternalGuard | null {
  const p = store.config.settings.protection;
  if (p.internalPages === 'never') return null;
  if (
    p.internalPagesFollowPause &&
    c.state.grants.some((g) => g.kind === 'pause' && (g.until ?? Number.POSITIVE_INFINITY) > c.now)
  ) {
    return null;
  }
  if (p.internalPages === 'always') return { always: true, groups: [], session: false };
  const session = activeSessions(c.state, c.now).some((s) => s.locked);
  const groups = c.cc.groups
    .filter((cg) => firmProtection(groupProtection(cg.group, c.now)) && groupActiveNow(cg.group, c))
    .map((cg) => cg.group);
  return session || groups.length ? { always: false, groups, session } : null;
}

/** Whether the browser's extension and settings pages are blocked right now. */
export function internalPagesBlocked(): boolean {
  return internalGuard() !== null;
}

/**
 * When the browser's extension and settings pages open again with the current rules: the first
 * moment, among those at which something changes, without a reason to block them. Null when
 * no such moment comes within the horizon (Always, a rule that always applies).
 */
export function internalGuardUntil(c: EngineContext = ctx()): number | null {
  const guard = internalGuard(c);
  if (!guard || guard.always) return null;
  const times = new Set(candidateTimes(c, c.cc.groups));
  // The date after which Locked asks only for a reminder: the rule is no longer firm.
  for (const g of guard.groups) if (g.protection.kind === 'locked') times.add(g.protection.until);
  for (const t of [...times].filter((x) => x > c.now).sort((a, b) => a - b)) {
    if (!internalGuard({ ...c, now: t })) return t;
  }
  return null;
}

function shouldEnforce(d: Decision, tab: chrome.tabs.Tab, onNavigation: boolean): boolean {
  if (!isNav(d) || d.exempt) return false;
  if (onNavigation) return true;
  // The tab is handled now when any rule that restricts it asks for it.
  const scopes = d.session
    ? ['all']
    : d.groups.filter((r) => SEVERITY[r.intervention.type] >= NAV_SEVERITY).map((r) => r.group.options.tabs);
  if (!scopes.length) return true;
  return scopes.some((s) => s === 'all' || (s === 'active') === Boolean(tab.active));
}

async function redirectTab(tabId: number, url: string) {
  counters.enforcements++;
  await quiet(api.tabs.update(tabId, { url: interventionUrl(url) }));
}

/**
 * Applies the current decision to one tab. On state changes (not navigations) a tab where the
 * user is typing gets a grace period first, and full screen is left.
 */
export async function enforceTab(
  tab: chrome.tabs.Tab,
  reason: 'navigation' | 'state' | 'config' | 'activation',
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
  if (reason === 'config') replacedTabs.set(tab.id, url);
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

/** Applies the current state to every open tab, after a change of the rules or of the state. */
export async function enforceAllTabs(reason: 'state' | 'config' = 'state') {
  const tabs = await quiet(api.tabs.query({}));
  if (!tabs) return;
  await Promise.all(tabs.map((tab) => enforceTab(tab, reason).catch(() => false)));
  // Refresh in-page state (filters, timers) of tabs that stay.
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) continue;
    void quiet(api.tabs.sendMessage(tab.id, { whb: 1, cmd: 'refresh' }));
  }
}

/** Number of tabs showing an intervention for a URL that is allowed again. */
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
    // Track intervention pages for the attempts in statistics ("left" without proceeding).
    const blocked = blockedUrlFrom(url);
    if (blocked && !interventionTabs.has(tabId)) {
      const d = decideUrl(blocked, null);
      interventionTabs.set(tabId, {
        url: blocked,
        groupId: d.primary?.group.id ?? null,
        proceeded: false,
        offered: false,
      });
    }
    return;
  }
  interventionTabs.delete(tabId);
  replacedTabs.delete(tabId);
  const tab = await quiet(api.tabs.get(tabId));
  if (!tab) return;
  tab.url = url;
  await enforceTab(tab, reason);
}

/**
 * Errors of a navigation stopped by a blocking rule: net::ERR_BLOCKED_BY_CLIENT in Chrome,
 * NS_ERROR_ABORT in Firefox, which may report it as its number (0x80004004 = 2147500036). A
 * navigation the user abandoned is NS_BINDING_ABORTED / net::ERR_ABORTED: not ours.
 */
export const BLOCKED_BY_RULE = /BLOCKED_BY_CLIENT|NS_ERROR_ABORT\b|\b2147500036\b|blocked/i;

export function registerNavigationListeners(onCommitted: (tabId: number, url: string) => void) {
  const nav = api.webNavigation;
  if (!nav) return;
  // Second layer after DNR: committed navigations (what the filters cannot express, such as rules
  // for normal or private windows only).
  nav.onCommitted.addListener(
    onTopFrame((d) => {
      void checkNavigation(d.tabId, d.url, 'navigation');
      onCommitted(d.tabId, d.url);
    }),
  );
  // Single page applications.
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
  // Without host access DNR can only block; show the intervention page instead.
  nav.onErrorOccurred.addListener(
    onTopFrame((d) => {
      const err = (d as unknown as { error?: string }).error ?? '';
      if (dnrStatus.hostAccess || !BLOCKED_BY_RULE.test(err)) return;
      void (async () => {
        await store.ready();
        const tab = await quiet(api.tabs.get(d.tabId));
        if (tab && isNav(decideUrl(d.url, Boolean(tab.incognito)))) await redirectTab(d.tabId, d.url);
      })();
    }),
  );
}

export function registerTabListeners(
  onActivated: (tabId: number) => void,
  onRemoved: (tabId: number) => void,
) {
  api.tabs.onUpdated.addListener((_tabId, info, tab) => {
    if (!info.url) return;
    // Internal pages, local files, reader mode and view-source are not seen by DNR.
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
    replacedTabs.delete(tabId);
    onRemoved(tabId);
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
