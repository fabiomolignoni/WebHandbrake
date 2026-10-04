/**
 * Platform adapter (COMP-02, REL-02). Firefox exposes promise based `browser.*`, Chrome MV3
 * exposes promise based `chrome.*`. Every optional API is feature-detected: Firefox for Android
 * lacks commands, menus, windows, history and sessions.
 */

const g = globalThis as unknown as { browser?: typeof chrome; chrome?: typeof chrome };

export const api: typeof chrome = (g.browser ?? g.chrome) as typeof chrome;

export const isFirefox =
  typeof g.browser !== 'undefined' && Boolean(g.browser?.runtime?.getURL('').startsWith('moz-'));

export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

export const features = {
  get contextMenus() {
    return Boolean(api.contextMenus?.create);
  },
  get commands() {
    return Boolean(api.commands?.onCommand);
  },
  get windows() {
    return Boolean(api.windows?.onFocusChanged);
  },
  get sessionStorage() {
    return Boolean(api.storage?.session);
  },
  get notifications() {
    return Boolean(api.notifications?.create);
  },
  get idle() {
    return Boolean(api.idle?.onStateChanged);
  },
  get scripting() {
    return Boolean(api.scripting?.registerContentScripts);
  },
  get webRequest() {
    return Boolean(api.webRequest?.onHeadersReceived);
  },
};

export type Browser = 'firefox' | 'firefox-android' | 'chrome' | 'edge' | 'other';

export function browserName(): Browser {
  if (isFirefox) return isAndroid ? 'firefox-android' : 'firefox';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua)) return 'chrome';
  return 'other';
}

export function extensionUrl(path: string): string {
  return api.runtime.getURL(path);
}

export const INTERVENTION_PAGE = 'intervention.html';

export function interventionUrl(target: string): string {
  return `${extensionUrl(INTERVENTION_PAGE)}#${target}`;
}

/** Extracts the blocked URL from an intervention page URL. */
export function blockedUrlFrom(url: string | undefined): string | null {
  if (!url) return null;
  const base = extensionUrl(INTERVENTION_PAGE);
  if (!url.startsWith(base)) return null;
  const i = url.indexOf('#');
  return i === -1 ? null : url.slice(i + 1);
}

/** Session storage with an in-memory fallback (Firefox < 115). */
const memorySession = new Map<string, unknown>();

export const sessionStore = {
  async get<T>(key: string): Promise<T | undefined> {
    if (features.sessionStorage) {
      const r = await api.storage.session.get(key);
      return r[key] as T | undefined;
    }
    return memorySession.get(key) as T | undefined;
  },
  async set(key: string, value: unknown): Promise<void> {
    if (features.sessionStorage) await api.storage.session.set({ [key]: value });
    else memorySession.set(key, value);
  },
  async remove(key: string): Promise<void> {
    if (features.sessionStorage) await api.storage.session.remove(key);
    else memorySession.delete(key);
  },
};

/** Ignores "no receiving end" errors when messaging tabs or pages that may not listen. */
export async function quiet<T>(p: Promise<T> | undefined): Promise<T | undefined> {
  try {
    return await p;
  } catch {
    return undefined;
  }
}
