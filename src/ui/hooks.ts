/** Data hooks: models are fetched from the background and refreshed when it broadcasts a change. */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Settings } from '../engine/types';
import { initI18n } from '../i18n/i18n';
import { api } from '../platform/api';
import { setFormatPrefs } from '../shared/format';
import { type Api, type ChangedBroadcast, call, type Method } from '../shared/rpc';

const changeListeners = new Set<(c: ChangedBroadcast['changed']) => void>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  api.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as ChangedBroadcast;
    if (m?.whb === 1 && Array.isArray(m.changed)) for (const l of changeListeners) l(m.changed);
    return false;
  });
}

export function onBackgroundChange(fn: (c: ChangedBroadcast['changed']) => void): () => void {
  listen();
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** Loads an RPC model, refreshing it on background changes (and optionally every `poll` ms). */
export function useModel<M extends Method>(method: M, args: Api[M]['req'], deps: unknown[] = [], poll = 0) {
  const [data, setData] = useState<Api[M]['res'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;
  const load = useCallback(async () => {
    try {
      setData(await call(method, argsRef.current));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [method]);
  useEffect(() => {
    void load();
    const off = onBackgroundChange(() => void load());
    const iv = poll ? setInterval(() => void load(), poll) : null;
    return () => {
      off();
      if (iv) clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);
  return { data, error, reload: load, setData };
}

/** A clock that ticks every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(iv);
  }, [ms]);
  return now;
}

/** Applies theme, contrast, accent, language and formats from the settings (SET-01…SET-03). */
export function applyAppearance(
  s: Pick<Settings, 'theme' | 'highContrast' | 'accent' | 'hour12' | 'dateFormat'>,
) {
  const root = document.documentElement;
  const dark =
    s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (s.theme === 'system') {
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else root.setAttribute('data-theme', s.theme);
  if (s.highContrast) root.setAttribute('data-contrast', 'high');
  else root.removeAttribute('data-contrast');
  if (s.accent && /^#[0-9a-f]{6}$/i.test(s.accent) && !s.highContrast) {
    root.style.setProperty('--accent', dark ? lighten(s.accent) : s.accent);
    root.style.setProperty('--accent-strong', dark ? lighten(s.accent, 0.5) : darken(s.accent));
    root.style.setProperty('--accent-soft', mix(s.accent, dark ? '#1c2123' : '#ffffff', dark ? 0.75 : 0.83));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-strong');
    root.style.removeProperty('--accent-soft');
  }
  setFormatPrefs(s);
}

function hex(c: string) {
  return [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
}
function toHex(rgb: number[]) {
  return `#${rgb
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
function mix(a: string, b: string, w: number) {
  const x = hex(a);
  const y = hex(b);
  return toHex(x.map((v, i) => v * (1 - w) + y[i] * w));
}
function lighten(c: string, w = 0.35) {
  return mix(c, '#ffffff', w);
}
function darken(c: string) {
  return mix(c, '#000000', 0.22);
}

/** Initialises i18n and appearance for a UI page. Returns the settings. */
export async function bootPage(): Promise<Settings> {
  const model = await call('config.get', {});
  const s = model.config.settings;
  await initI18n(s.language);
  applyAppearance(s);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance(s));
  return s;
}
