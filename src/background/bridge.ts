/**
 * Private windows in Chrome.
 *
 * Chrome opens an extension page in the tab of a private window only for an extension that runs a
 * background of its own there ("incognito": "split" in the manifest). With one background for both
 * kinds of window, a private tab cannot show the intervention page: Chrome shows
 * ERR_BLOCKED_BY_CLIENT instead, and every rule becomes a silent block.
 *
 * The two backgrounds share the storage, but nothing else: the private one sees only the private
 * tabs, their navigations and the messages of the pages in private windows, and the main one
 * cannot reach a private tab. They cannot message each other. So the private background keeps no
 * state and decides nothing: it passes what it sees to the main background through session
 * storage, and runs there the calls the main background makes for the private tabs. One background
 * reads and writes the rules, the state and the statistics, as in Firefox.
 *
 * Session storage is not available to content scripts, so a web page cannot write into the channel.
 */

import { api, quiet } from '../platform/api';
import { openBlockSitePanel } from '../shared/block-site';

/** From the private background to the main one. */
const UP = 'bridge:up';
/** From the main background to the private one. */
const DOWN = 'bridge:down';
/** The tabs of the private windows, kept by the private background. */
const TABS = 'bridge:tabs';
/** The context menu items, set by the main background for the private windows too. */
const MENUS = 'bridge:menus';

/** How long the main background waits for a call to a private tab. */
export const PRIVATE_CALL_MS = 3000;
/** How long a page in a private window waits for the main background's answer. */
export const RELAY_MS = 30_000;

/** The events of the private windows that the main background listens to. */
export type PrivateEvent =
  | 'tabs.onUpdated'
  | 'tabs.onActivated'
  | 'tabs.onRemoved'
  | 'windows.onFocusChanged'
  | 'webNavigation.onCommitted'
  | 'webNavigation.onHistoryStateUpdated'
  | 'webNavigation.onReferenceFragmentUpdated'
  | 'webNavigation.onBeforeNavigate'
  | 'webNavigation.onErrorOccurred'
  | 'webRequest.onHeadersReceived'
  | 'webRequest.onBeforeRedirect'
  | 'contextMenus.onClicked'
  | 'commands.onCommand';

type Listener = (...args: any[]) => unknown;
type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

/** What the private background runs for the main one: only these calls, on its own tabs. */
const CALLS = {
  'tabs.get': (id: number) => api.tabs.get(id),
  'tabs.query': (q: chrome.tabs.QueryInfo) => api.tabs.query(q),
  'tabs.update': (id: number, props: chrome.tabs.UpdateProperties) => api.tabs.update(id, props),
  'tabs.remove': (id: number) => api.tabs.remove(id),
  'tabs.sendMessage': (id: number, message: unknown) => api.tabs.sendMessage(id, message),
  'windows.get': (id: number) => api.windows.get(id),
  'windows.getLastFocused': () => api.windows.getLastFocused(),
  'scripting.executeScript': async (tabId: number, files: string[]) => {
    await api.scripting.executeScript({ target: { tabId }, files });
  },
  'action.setBadgeText': (o: chrome.action.BadgeTextDetails) => api.action.setBadgeText(o),
  'action.setBadgeBackgroundColor': (o: chrome.action.BadgeColorDetails) =>
    api.action.setBadgeBackgroundColor(o),
  'action.setTitle': (o: chrome.action.TitleDetails) => api.action.setTitle(o),
};

export type PrivateCall = keyof typeof CALLS;

type Up =
  | { id: string; kind: 'event'; name: PrivateEvent; args: unknown[]; tabId?: number }
  | { id: string; kind: 'message'; message: unknown; sender: chrome.runtime.MessageSender }
  | { id: string; kind: 'result'; call: string; ok: boolean; value?: unknown; error?: string };

type Down =
  | { id: string; kind: 'call'; fn: PrivateCall; args: unknown[] }
  | { id: string; kind: 'reply'; to: string; value: unknown }
  | { id: string; kind: 'broadcast'; message: unknown };

let seq = 0;
/** Every message is a new value: storage reports no change for a value written twice. */
const newId = () =>
  `${Date.now().toString(36)}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Plain data, as storage keeps it: undefined dropped from objects, null in arrays. */
function plain<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function post(key: typeof UP | typeof DOWN, value: Up | Down): Promise<void> {
  return api.storage.session.set({ [key]: value });
}

/** True in the background of Chrome's private windows, which only relays (see above). */
export function isPrivateBackground(): boolean {
  return __TARGET__ === 'chrome' && Boolean(api.extension?.inIncognitoContext);
}

// ---------------------------------------------------------------------------
// Main background
// ---------------------------------------------------------------------------

const listeners = new Map<PrivateEvent, Listener[]>();
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
/** Tabs known to belong to the private windows; tab ids are never reused while the browser runs. */
const knownTabs = new Set<number>();
/** The private tabs as the private background last listed them; null until read. */
let openTabs: number[] | null = null;
let loading: Promise<void> | null = null;
let onRelayedMessage: MessageListener | null = null;

/** Registers a listener of an event of the private windows (main background). */
export function onPrivate(name: PrivateEvent, fn: Listener) {
  const list = listeners.get(name) ?? [];
  list.push(fn);
  listeners.set(name, list);
}

/** Listens to an event both in the main background and in the private windows. */
export function listenEverywhere<F extends Listener>(
  event: { addListener(fn: F): void } | undefined,
  name: PrivateEvent,
  fn: F,
) {
  if (!event) return;
  event.addListener(fn);
  onPrivate(name, fn);
}

function loadOpenTabs(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const r = (await quiet(api.storage.session.get(TABS))) ?? {};
      if (openTabs === null) openTabs = Array.isArray(r[TABS]) ? (r[TABS] as number[]) : [];
      for (const id of openTabs) knownTabs.add(id);
    })();
  }
  return loading;
}

/** Whether private windows have tabs open (Chrome with access to private windows). */
export async function privateWindowsOpen(): Promise<boolean> {
  if (!bridgeAvailable()) return false;
  await loadOpenTabs();
  return Boolean(openTabs?.length);
}

/** Whether a tab belongs to a private window whose background relays (see above). */
export async function isPrivateTab(id: number): Promise<boolean> {
  if (!bridgeAvailable()) return false;
  await loadOpenTabs();
  return knownTabs.has(id);
}

/** Runs a call in the background of the private windows. */
export function callPrivate(fn: PrivateCall, ...args: unknown[]): Promise<unknown> {
  const id = newId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // The private windows were closed before their background could update the list of their
      // tabs: no longer ask them. If they are open after all, their background writes it again.
      setOpenTabs([]);
      reject(new Error('The private windows do not answer.'));
    }, PRIVATE_CALL_MS);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    post(DOWN, { id, kind: 'call', fn, args: plain(args) }).catch((e) => {
      pending.delete(id);
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Sends a broadcast of the main background to the pages of the private windows too. */
export function broadcastToPrivate(message: unknown) {
  void (async () => {
    if (await privateWindowsOpen()) await quiet(post(DOWN, { id: newId(), kind: 'broadcast', message }));
  })();
}

let sharedMenus = '';

/** The context menu items, created by the private background in the private windows too. */
export async function sharePrivateMenus(items: chrome.contextMenus.CreateProperties[]) {
  if (!bridgeAvailable()) return;
  const json = JSON.stringify(items);
  if (json === sharedMenus) return;
  sharedMenus = json;
  await quiet(api.storage.session.set({ [MENUS]: plain(items) }));
}

/** Replaces the list of the private tabs, which the private background corrects if it is wrong. */
function setOpenTabs(ids: number[]) {
  openTabs = ids;
  void quiet(api.storage.session.set({ [TABS]: ids }));
}

function bridgeAvailable(): boolean {
  return __TARGET__ === 'chrome' && Boolean(api.storage?.session && api.storage.onChanged);
}

/** The tab an event or a message of a private window is about. */
function tabOf(up: Up): number | undefined {
  if (up.kind === 'message') return up.sender.tab?.id;
  if (up.kind === 'event') return up.tabId;
  return undefined;
}

async function receive(up: Up) {
  if (up.kind === 'result') {
    const p = pending.get(up.call);
    pending.delete(up.call);
    if (up.ok) p?.resolve(up.value);
    else p?.reject(new Error(up.error ?? 'error'));
    return;
  }
  const tabId = tabOf(up);
  if (up.kind === 'event' && up.name === 'tabs.onRemoved') {
    const removed = up.args[0] as number;
    knownTabs.delete(removed);
    // Closing the last private window ends their background, often before it updates the list.
    if (openTabs?.includes(removed)) setOpenTabs(openTabs.filter((id) => id !== removed));
  } else if (tabId !== undefined && tabId >= 0) {
    // The tab is in a private window, which is open (even if the list of its tabs is late).
    knownTabs.add(tabId);
    if (openTabs && !openTabs.includes(tabId)) openTabs = [...openTabs, tabId];
  }
  if (up.kind === 'event') {
    for (const fn of listeners.get(up.name) ?? []) fn(...up.args);
    return;
  }
  let replied = false;
  const reply = (value: unknown) => {
    if (replied) return;
    replied = true;
    void quiet(post(DOWN, { id: newId(), kind: 'reply', to: up.id, value: plain(value) }));
  };
  const answersLater = onRelayedMessage?.(up.message, up.sender, reply);
  if (answersLater !== true) reply(undefined);
}

/**
 * Main background: receives the events and messages of the private windows, and the results of
 * the calls made there. `onMessage` answers the messages, as it does those of the main windows.
 */
export function listenToPrivateWindows(onMessage: MessageListener) {
  if (!bridgeAvailable()) return;
  onRelayedMessage = onMessage;
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    if (changes[TABS]) {
      const list = changes[TABS].newValue;
      openTabs = Array.isArray(list) ? (list as number[]) : [];
      for (const id of openTabs) knownTabs.add(id);
    }
    const up = changes[UP]?.newValue as Up | undefined;
    if (up?.id) void receive(up);
  });
}

// ---------------------------------------------------------------------------
// Private background
// ---------------------------------------------------------------------------

const replies = new Map<string, { send: (r: unknown) => void; timer: ReturnType<typeof setTimeout> }>();

function relayEvent(name: PrivateEvent, tabIdOf: (...args: any[]) => number | undefined) {
  return (...args: unknown[]) => {
    const tabId = tabIdOf(...args);
    void quiet(post(UP, { id: newId(), kind: 'event', name, args: plain(args), tabId }));
  };
}

let tabsWritten = '';

/** Keeps the list of the private tabs, from which the main background knows they are open. */
async function syncTabs() {
  const tabs = (await quiet(api.tabs.query({}))) ?? [];
  const ids = tabs
    .map((t) => t.id)
    .filter((id): id is number => id !== undefined)
    .sort((a, b) => a - b);
  const json = JSON.stringify(ids);
  if (json === tabsWritten) return;
  tabsWritten = json;
  await quiet(api.storage.session.set({ [TABS]: ids }));
}

async function applyMenus(items: unknown) {
  if (!api.contextMenus?.create) return;
  await quiet(api.contextMenus.removeAll());
  if (!Array.isArray(items)) return;
  for (const props of items as chrome.contextMenus.CreateProperties[]) {
    try {
      api.contextMenus.create(props, () => void api.runtime.lastError);
    } catch {
      // a duplicate id while the menus are rebuilt
    }
  }
}

async function run(down: Down) {
  if (down.kind === 'reply') {
    const r = replies.get(down.to);
    if (!r) return;
    replies.delete(down.to);
    clearTimeout(r.timer);
    r.send(down.value);
  } else if (down.kind === 'broadcast') {
    await quiet(api.runtime.sendMessage(down.message));
  } else if (down.kind === 'call') {
    const fn = CALLS[down.fn] as ((...a: unknown[]) => Promise<unknown>) | undefined;
    let result: Up;
    try {
      if (!fn) throw new Error(`not relayed: ${down.fn}`);
      const value = await fn(...down.args);
      result = { id: newId(), kind: 'result', call: down.id, ok: true, value: plain(value) };
    } catch (e) {
      result = {
        id: newId(),
        kind: 'result',
        call: down.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    await quiet(post(UP, result));
  }
}

const byTab = (tabId: number) => tabId;
const byDetails = (d: { tabId: number }) => d.tabId;
const byTabArg = (_x: unknown, tab?: chrome.tabs.Tab) => tab?.id;

/**
 * Private background: relays the events and the messages of the private windows to the main
 * background, and runs its calls. Registered synchronously, so that the events wake it up.
 */
export function relayPrivateWindows() {
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const m = message as { whb?: number; method?: unknown } | null;
    if (m?.whb !== 1 || typeof m.method !== 'string') return false;
    const id = newId();
    const timer = setTimeout(() => {
      replies.delete(id);
      sendResponse({ ok: false, error: 'No response from background' });
    }, RELAY_MS);
    replies.set(id, { send: sendResponse, timer });
    void post(UP, { id, kind: 'message', message: plain(message), sender: plain(sender) }).catch((e) => {
      replies.delete(id);
      clearTimeout(timer);
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    });
    return true;
  });

  // Only the changes of address: the other updates (title, loading) are of no use to the rules.
  const updated = relayEvent('tabs.onUpdated', byTab);
  api.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.url) updated(tabId, info, tab);
  });
  api.tabs.onActivated.addListener(relayEvent('tabs.onActivated', byDetails));
  const removed = relayEvent('tabs.onRemoved', byTab);
  api.tabs.onRemoved.addListener((tabId, info) => {
    removed(tabId, info);
    void syncTabs();
  });
  api.tabs.onCreated.addListener(() => void syncTabs());
  // A window minimised or brought back: a wait that pauses when its page is left looks again.
  api.windows?.onFocusChanged?.addListener(relayEvent('windows.onFocusChanged', () => undefined));

  const nav = api.webNavigation;
  if (nav) {
    const topFrame = (name: PrivateEvent) => {
      const relay = relayEvent(name, byDetails);
      return (d: { frameId: number; tabId: number }) => {
        if (d.frameId === 0 && d.tabId >= 0) relay(d);
      };
    };
    nav.onCommitted.addListener(topFrame('webNavigation.onCommitted'));
    nav.onHistoryStateUpdated.addListener(topFrame('webNavigation.onHistoryStateUpdated'));
    nav.onReferenceFragmentUpdated.addListener(topFrame('webNavigation.onReferenceFragmentUpdated'));
    nav.onBeforeNavigate.addListener(topFrame('webNavigation.onBeforeNavigate'));
    nav.onErrorOccurred.addListener(topFrame('webNavigation.onErrorOccurred'));
  }

  // The Date headers of the pages, for the clock: only what it reads.
  if (api.webRequest?.onHeadersReceived) {
    const headers = relayEvent('webRequest.onHeadersReceived', byDetails);
    try {
      api.webRequest.onHeadersReceived.addListener(
        (d) => {
          const responseHeaders = (d.responseHeaders ?? []).filter((h) =>
            ['date', 'age'].includes(h.name.toLowerCase()),
          );
          if (!responseHeaders.length) return;
          const fromCache = (d as { fromCache?: boolean }).fromCache;
          headers({ url: d.url, tabId: d.tabId, fromCache, responseHeaders });
        },
        { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
        ['responseHeaders'],
      );
    } catch {
      // webRequest unavailable: the clock works without the private windows' headers.
    }
  }
  // The redirects of the servers to web pages, for the accesses that a short link carries.
  if (api.webRequest?.onBeforeRedirect) {
    const redirect = relayEvent('webRequest.onBeforeRedirect', byDetails);
    try {
      api.webRequest.onBeforeRedirect.addListener(
        (d) => {
          if (/^https?:/i.test(d.redirectUrl))
            redirect({ tabId: d.tabId, url: d.url, redirectUrl: d.redirectUrl });
        },
        { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
      );
    } catch {
      // webRequest unavailable: a short link asks again on the page it sends to.
    }
  }

  api.contextMenus?.onClicked?.addListener(relayEvent('contextMenus.onClicked', byTabArg));
  const command = relayEvent('commands.onCommand', byTabArg);
  api.commands?.onCommand?.addListener((name, tab) => {
    // The popup of a private window opens from here: the main background cannot reach the window.
    // Only when it cannot open does the main background block the site another way.
    if (name === 'block-site') void openBlockSitePanel(tab).then((open) => open || command(name, tab));
    else command(name, tab);
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    if (changes[MENUS]) void applyMenus(changes[MENUS].newValue);
    // The main background changed the list (a tab closed, no answer): write the real one again.
    if (changes[TABS] && JSON.stringify(changes[TABS].newValue ?? null) !== tabsWritten) {
      tabsWritten = '';
      void syncTabs();
    }
    const down = changes[DOWN]?.newValue as Down | undefined;
    if (down?.id) void run(down);
  });

  void (async () => {
    await syncTabs();
    const r = (await quiet(api.storage.session.get(MENUS))) ?? {};
    await applyMenus(r[MENUS]);
  })();
}
