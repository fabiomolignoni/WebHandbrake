/**
 * Time of the pages that send no ticks, or too few:
 * - Firefox's reader view (about:reader?url=…), where content scripts do not run;
 * - the websites that WebHandbrake has no access to, since the person took it back (Chrome's
 *   "When you click the extension", Firefox's permissions of the add-on): it cannot add its page
 *   script there, so its rules have no timer, warning, filter or grace period, but their limits
 *   still count;
 * - with Count tabs that are open but not active, the pages not in view: browsers slow their timers
 *   down (Chrome wakes a hidden page about once a minute after a minute), so the page script
 *   ticks only while its page is visible, and the background counts every open tab.
 *
 * The background counts it in stretches. A stretch starts when such a page is in view (the tab
 * shown in the window in front, the person not idle), or open with Count tabs that are open but
 * not active, and ends at the next change of tab, page,
 * window or idle state, and at least every minute (periodic alarm); each one is credited as the
 * ticks of the page would have been (accounting.ts, creditStretch). An alarm at the moment a
 * limit of the page would run out ends the stretch then, so that the limit applies at once.
 * Nothing ticks meanwhile and the background may stop: the open stretches are kept in session
 * storage.
 *
 * Without the page, the window in front and the idle state of the system stand for what the page
 * would see (whether it is covered by another window, whether the person is reading). Firefox for
 * Android has no windows: there the tab shown counts, even while another app is in front.
 */

import { MAX_STRETCH_MS } from '../engine/limits';
import { nextRestriction } from '../engine/next';
import { isReaderView } from '../engine/url';
import { api, features, quiet, sessionStore } from '../platform/api';
import { creditStretch, timeCounts } from './accounting';
import { updateBadge } from './badge';
import { callPrivate, listenEverywhere, privateWindowsOpen } from './bridge';
import { now } from './clock';
import { ctx } from './engine';
import { store } from './store';
import { queryTabs } from './tabs';

export const ALARM_TAB_TIME = 'whb-tab-time';
const STRETCHES_KEY = 'tabTime';

interface Stretch {
  tabId: number;
  url: string;
  incognito: boolean;
  /** When it started. */
  from: number;
}

/** Pages whose time no tick counts: the reader view, and the websites without access. */
async function sendsNoTicks(url: string): Promise<boolean> {
  if (isReaderView(url)) return true;
  if (!/^https?:/i.test(url)) return false;
  const { protocol, hostname } = new URL(url);
  const access = await quiet(api.permissions.contains({ origins: [`${protocol}//${hostname}/*`] }));
  return access === false;
}

let open: Stretch[] | null = null;
let running: Promise<unknown> = Promise.resolve();
let preciseTimer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<Stretch[]> {
  if (!open) open = (await sessionStore.get<Stretch[]>(STRETCHES_KEY)) ?? [];
  return open;
}

/** One change at a time: each one reads the tabs, then ends and starts stretches. */
function serially(fn: () => Promise<void>): Promise<void> {
  const run = running.then(fn);
  running = run.catch((e) => console.error('WebHandbrake tab time failed', e));
  return run;
}

async function idleState(): Promise<string> {
  if (!api.idle?.queryState) return 'active';
  const seconds = Math.max(15, store.config.settings.tracking.idleSeconds);
  return (await quiet(api.idle.queryState(seconds))) ?? 'active';
}

/** The tab shown in the window in front: none while another application is, or it is minimised. */
async function shownTab(): Promise<chrome.tabs.Tab | undefined> {
  if (!features.windows) {
    const [tab] = (await quiet(api.tabs.query({ active: true, lastFocusedWindow: true }))) ?? [];
    return tab;
  }
  let win = await quiet(api.windows.getLastFocused());
  // Chrome: a private window in front is one of the background of the private windows.
  if (!win?.focused && (await privateWindowsOpen()))
    win = (await quiet(callPrivate('windows.getLastFocused'))) as chrome.windows.Window | undefined;
  if (!win?.focused || win.state === 'minimized' || win.id === undefined) return undefined;
  const [tab] = (await quiet(queryTabs({ active: true, windowId: win.id }))) ?? [];
  return tab;
}

/**
 * The tabs whose time the background counts now: the one in view while the person is active, if
 * it sends no ticks, or every open one whose page counts with Count tabs that are open but not
 * active (those in view tick too, and the same seconds never count twice: accounting.ts). A tab
 * whose page the browser unloaded (discarded) has no page open, as before.
 */
async function countedTabs(): Promise<chrome.tabs.Tab[]> {
  const tracking = store.config.settings.tracking;
  const idle = await idleState();
  if (idle === 'locked') return [];
  if (tracking.countInactive) {
    const tabs = (await quiet(queryTabs({}))) ?? [];
    return tabs.filter(
      (tab) =>
        tab.id !== undefined && !tab.discarded && tab.url && timeCounts(tab.url, Boolean(tab.incognito)),
    );
  }
  if (idle === 'idle' && tracking.idleEnabled) return [];
  const tab = await shownTab();
  return tab?.id !== undefined && tab.url && (await sendsNoTicks(tab.url)) ? [tab] : [];
}

/** Ends the open stretches now, crediting them, and starts those of the tabs that count now. */
async function checkpoint() {
  await store.ready();
  const before = await load();
  const tabs = await countedTabs();
  if (!before.length && !tabs.length) return;
  const t = now();
  for (const s of before) {
    // Without an alarm for that long, the computer slept: as a gap between ticks, one second.
    const from = t - s.from > MAX_STRETCH_MS ? t - 1000 : s.from;
    creditStretch(s.url, s.incognito, from, t);
  }
  open = tabs.map((tab) => ({ tabId: tab.id!, url: tab.url!, incognito: Boolean(tab.incognito), from: t }));
  if (open.length) await sessionStore.set(STRETCHES_KEY, open);
  else await sessionStore.remove(STRETCHES_KEY);
  await scheduleEnd(open, t);
  for (const tab of tabs) if (tab.active) void updateBadge(tab.id!, tab.url, Boolean(tab.incognito));
}

/** An alarm when the first limit of the pages counted would run out, to end their stretches then. */
async function scheduleEnd(stretches: Stretch[], t: number) {
  if (preciseTimer) {
    clearTimeout(preciseTimer);
    preciseTimer = null;
  }
  const c = ctx(t);
  const ends = stretches
    .map((s) => nextRestriction(c, s.url, { incognito: s.incognito })?.at)
    .filter((at) => at !== undefined);
  if (!ends.length) {
    await quiet(api.alarms.clear(ALARM_TAB_TIME));
    return;
  }
  const delay = Math.max(0, Math.min(...ends) - t);
  await quiet(api.alarms.create(ALARM_TAB_TIME, { when: Date.now() + delay + 200 }));
  // Alarms can be late by up to 30 s on Chrome: also use a timer while the worker is alive.
  if (delay < 5 * 60_000) preciseTimer = setTimeout(() => void countTabTime(), delay + 100);
}

/** Credits the time of the pages without ticks up to now, and goes on counting what counts now. */
export function countTabTime(): Promise<void> {
  return serially(checkpoint);
}

/**
 * A tab opened another page or was closed: it matters when it leaves a stretch, or opens a page
 * whose time counts in view (in any tab with Count tabs that are open but not active).
 */
function tabChanged(tabId: number, tab?: chrome.tabs.Tab) {
  void serially(async () => {
    await store.ready();
    const opens =
      tab?.url &&
      (tab.active || store.config.settings.tracking.countInactive) &&
      timeCounts(tab.url, Boolean(tab.incognito));
    if (opens || (await load()).some((s) => s.tabId === tabId)) await checkpoint();
  });
}

/** Listens to what changes the page in view: tabs, windows, the idle state and the access to sites. */
export function registerTabTimeListeners() {
  const again = () => void countTabTime();
  listenEverywhere(api.tabs.onActivated, 'tabs.onActivated', again);
  listenEverywhere(api.windows?.onFocusChanged, 'windows.onFocusChanged', again);
  listenEverywhere(
    api.tabs.onUpdated,
    'tabs.onUpdated',
    (tabId: number, info: { url?: string }, tab: chrome.tabs.Tab) => {
      if (info.url) tabChanged(tabId, { ...tab, url: info.url });
    },
  );
  listenEverywhere(api.tabs.onRemoved, 'tabs.onRemoved', (tabId: number) => tabChanged(tabId));
  api.idle?.onStateChanged?.addListener(again);
  api.permissions?.onAdded?.addListener(again);
  api.permissions?.onRemoved?.addListener(again);
}
