/** Minimal in-memory WebExtension API for unit tests of background modules. */

/** Object keys in alphabetical order, at every level, as Chrome's storage returns them. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  return v;
}

type Tab = Partial<chrome.tabs.Tab>;
type Listener = (...args: any[]) => unknown;

/** The storage of a browser, with the change events of every background that uses it. */
interface SharedStorage {
  local: Map<string, unknown>;
  session: Map<string, unknown>;
  storageEvents: FakeEvent[];
}

type FakeEvent = ReturnType<typeof event>;

/** An event whose listeners a test can call. */
function event() {
  const listeners: Listener[] = [];
  return {
    listeners,
    addListener: (fn: Listener) => void listeners.push(fn),
    removeListener: (fn: Listener) => void listeners.splice(listeners.indexOf(fn), 1),
    fire: (...args: unknown[]) => listeners.map((fn) => fn(...args)),
  };
}

/**
 * `chrome: true` behaves like Chrome's storage, which returns objects with sorted keys; Firefox
 * keeps the order in which the keys were written. `tabs` are the open tabs that `tabs.query()`
 * returns; the array can be changed later, and `tabs.update()` changes it as a browser would.
 * `windows` holds the state of the windows that is not 'normal' (as 'minimized'), by id.
 * What the extension does to the browser (rules, alarms, badges, messages to tabs,
 * notifications…) is kept in the returned object, for the tests to look at.
 *
 * `incognito` with `sharedWith`: the background of Chrome's private windows, which shares the
 * storage (and its change events) of the main one but has tabs and events of its own.
 */
export function installFakeBrowser(
  opts: { chrome?: boolean; tabs?: Tab[]; incognito?: boolean; sharedWith?: SharedStorage } = {},
) {
  const tabs = opts.tabs ?? [];
  const local = opts.sharedWith?.local ?? new Map<string, unknown>();
  const session = opts.sharedWith?.session ?? new Map<string, unknown>();
  /** storage.onChanged of every background that shares the storage. */
  const storageEvents: FakeEvent[] = opts.sharedWith?.storageEvents ?? [];
  const onStorageChanged = event();
  storageEvents.push(onStorageChanged);
  /** Like the browser: only the values that change, reported after the write. */
  const changed = (name: string, m: Map<string, unknown>, items: [string, unknown][]) => {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [k, v] of items) {
      const old = m.get(k);
      if (JSON.stringify(old) === JSON.stringify(v)) continue;
      changes[k] = { oldValue: old, newValue: v };
      if (v === undefined) m.delete(k);
      else m.set(k, v);
    }
    if (Object.keys(changes).length)
      queueMicrotask(() => {
        for (const e of storageEvents) e.fire(JSON.parse(JSON.stringify(changes)), name);
      });
  };
  const area = (m: Map<string, unknown>, name: string) => ({
    async get(keys?: string | string[] | null) {
      const clone = (v: unknown) => {
        if (v === undefined) return v;
        const copy = JSON.parse(JSON.stringify(v));
        return opts.chrome ? sortKeys(copy) : copy;
      };
      if (keys === null || keys === undefined)
        return Object.fromEntries([...m].map(([k, v]) => [k, clone(v)]));
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (m.has(k)) out[k] = clone(m.get(k));
      return out;
    },
    async set(items: Record<string, unknown>) {
      changed(
        name,
        m,
        Object.entries(items).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]),
      );
    },
    async remove(keys: string | string[]) {
      changed(
        name,
        m,
        (Array.isArray(keys) ? keys : [keys]).map((k) => [k, undefined]),
      );
    },
    async getBytesInUse() {
      return JSON.stringify([...m]).length;
    },
  });

  const rules = new Map<number, chrome.declarativeNetRequest.Rule>();
  const alarms = new Map<string, { when?: number; periodInMinutes?: number }>();
  const badges = new Map<number, { text?: string; color?: string; title?: string }>();
  const messages: { tabId: number; message: any }[] = [];
  const notifications: { id: string; options: unknown }[] = [];
  const created: Tab[] = [];
  const removed: number[] = [];
  const broadcasts: unknown[] = [];
  const menus: chrome.contextMenus.CreateProperties[] = [];
  const scripts: { id: string; matches?: string[] }[] = [];
  /** What a content script answers to a message from the background (by default nothing). */
  const contentReply: { fn: (tabId: number, message: any) => unknown } = { fn: () => undefined };
  const permissions = { hostAccess: true, notifications: true, incognito: true };
  const windows = new Map<number, string>();
  let nextTab = 1000;

  const tabById = (id: number) => tabs.find((t) => t.id === id);
  const badge = (tabId: number) => {
    if (!badges.has(tabId)) badges.set(tabId, {});
    return badges.get(tabId)!;
  };
  /** The popup of the toolbar button: the manifest's until the extension sets one. */
  const popup = { value: 'popup.html' };
  const action = {
    setPopup: async (o: { popup: string }) => void (popup.value = o.popup),
    onClicked: event(),
    setBadgeText: async (o: { tabId: number; text: string }) => void (badge(o.tabId).text = o.text),
    setBadgeBackgroundColor: async (o: { tabId: number; color: string }) =>
      void (badge(o.tabId).color = o.color),
    setTitle: async (o: { tabId: number; title: string }) => void (badge(o.tabId).title = o.title),
  };
  const events = {
    onMessage: event(),
    onCommitted: event(),
    onHistoryStateUpdated: event(),
    onReferenceFragmentUpdated: event(),
    onBeforeNavigate: event(),
    onErrorOccurred: event(),
    onUpdated: event(),
    onActivated: event(),
    onRemoved: event(),
    onCreated: event(),
    onFocusChanged: event(),
    onAlarm: event(),
    onMenuClicked: event(),
    onCommand: event(),
    onNotificationClicked: event(),
    onInstalled: event(),
    onStartup: event(),
    onIdle: event(),
    onHeadersReceived: event(),
  };

  (globalThis as any).chrome = {
    runtime: {
      id: 'test',
      getURL: (p: string) => `chrome-extension://test/${p}`,
      getManifest: () => ({ version: '1.0.0' }),
      onMessage: events.onMessage,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      sendMessage: async (m: unknown) => void broadcasts.push(m),
      lastError: undefined,
    },
    storage: { local: area(local, 'local'), session: area(session, 'session'), onChanged: onStorageChanged },
    declarativeNetRequest: {
      MAX_NUMBER_OF_REGEX_RULES: 1000,
      MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
      getDynamicRules: async () => [...rules.values()].map((r) => structuredClone(r)),
      updateDynamicRules: async (o: {
        removeRuleIds?: number[];
        addRules?: chrome.declarativeNetRequest.Rule[];
      }) => {
        for (const id of o.removeRuleIds ?? []) rules.delete(id);
        for (const r of o.addRules ?? []) {
          if (rules.has(r.id)) throw new Error(`Rule with id ${r.id} does not have a unique ID.`);
          rules.set(r.id, structuredClone(r));
        }
      },
      isRegexSupported: async () => ({ isSupported: true }),
    },
    permissions: {
      contains: async (p: { origins?: string[]; permissions?: string[] }) =>
        p.permissions?.includes('notifications') ? permissions.notifications : permissions.hostAccess,
      onAdded: event(),
      onRemoved: event(),
    },
    extension: {
      isAllowedIncognitoAccess: async () => permissions.incognito,
      inIncognitoContext: Boolean(opts.incognito),
    },
    tabs: {
      query: async (q: { active?: boolean; url?: string[] } = {}) =>
        tabs.filter((t) => q.active === undefined || Boolean(t.active) === q.active).map((t) => ({ ...t })),
      get: async (id: number) => {
        const t = tabById(id);
        if (!t) throw new Error(`No tab with id: ${id}.`);
        return { ...t };
      },
      update: async (id: number, props: Tab) => {
        const t = tabById(id);
        if (!t) throw new Error(`No tab with id: ${id}.`);
        Object.assign(t, props);
        return { ...t };
      },
      create: async (props: Tab) => {
        const t = { id: nextTab++, ...props };
        created.push(t);
        return t;
      },
      remove: async (id: number) => {
        removed.push(id);
        const i = tabs.findIndex((t) => t.id === id);
        if (i !== -1) tabs.splice(i, 1);
      },
      sendMessage: async (tabId: number, message: unknown) => {
        messages.push({ tabId, message });
        return contentReply.fn(tabId, message);
      },
      onUpdated: events.onUpdated,
      onActivated: events.onActivated,
      onRemoved: events.onRemoved,
      onCreated: events.onCreated,
    },
    windows: {
      get: async (id: number) => ({ id, state: windows.get(id) ?? 'normal' }),
      onFocusChanged: events.onFocusChanged,
    },
    webNavigation: {
      onCommitted: events.onCommitted,
      onHistoryStateUpdated: events.onHistoryStateUpdated,
      onReferenceFragmentUpdated: events.onReferenceFragmentUpdated,
      onBeforeNavigate: events.onBeforeNavigate,
      onErrorOccurred: events.onErrorOccurred,
    },
    alarms: {
      create: async (name: string, info: { when?: number; periodInMinutes?: number }) =>
        void alarms.set(name, info),
      clear: async (name: string) => alarms.delete(name),
      get: async (name: string) => (alarms.has(name) ? { name, ...alarms.get(name) } : undefined),
      onAlarm: events.onAlarm,
    },
    action,
    scripting: {
      registerContentScripts: async (s: { id: string; matches?: string[] }[]) => void scripts.push(...s),
      unregisterContentScripts: async () => void scripts.splice(0),
      getRegisteredContentScripts: async () => scripts.map((s) => ({ ...s })),
      executeScript: async () => [],
    },
    contextMenus: {
      create: (props: chrome.contextMenus.CreateProperties, done?: () => void) => {
        menus.push(props);
        done?.();
      },
      removeAll: async () => void menus.splice(0),
      onClicked: events.onMenuClicked,
    },
    commands: { onCommand: events.onCommand },
    idle: { onStateChanged: events.onIdle, setDetectionInterval: () => {} },
    webRequest: { onHeadersReceived: events.onHeadersReceived },
    notifications: {
      create: async (id: string, options: unknown) => {
        notifications.push({ id, options });
        return id;
      },
      clear: async () => true,
      onClicked: events.onNotificationClicked,
    },
  };
  return {
    local,
    session,
    storageEvents,
    onStorageChanged,
    tabs,
    rules,
    alarms,
    badges,
    messages,
    notifications,
    created,
    removed,
    broadcasts,
    menus,
    scripts,
    contentReply,
    permissions,
    windows,
    events,
    action,
    popup,
  };
}

export type FakeBrowser = ReturnType<typeof installFakeBrowser>;
