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

/**
 * `chrome: true` behaves like Chrome's storage, which returns objects with sorted keys; Firefox
 * keeps the order in which the keys were written.
 */
export function installFakeBrowser(opts: { chrome?: boolean } = {}) {
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  const area = (m: Map<string, unknown>) => ({
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
      for (const [k, v] of Object.entries(items)) m.set(k, JSON.parse(JSON.stringify(v)));
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) m.delete(k);
    },
    async getBytesInUse() {
      return JSON.stringify([...m]).length;
    },
  });
  const noopEvent = { addListener() {}, removeListener() {} };
  (globalThis as any).chrome = {
    runtime: {
      id: 'test',
      getURL: (p: string) => `chrome-extension://test/${p}`,
      getManifest: () => ({ version: '1.0.0' }),
      onMessage: noopEvent,
      sendMessage: async () => undefined,
    },
    storage: { local: area(local), session: area(session) },
    declarativeNetRequest: {},
    permissions: { contains: async () => true },
    tabs: { query: async () => [] },
  };
  return { local, session };
}
