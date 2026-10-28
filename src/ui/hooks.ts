/** Data hooks: models are fetched from the background and refreshed when it broadcasts a change. */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Settings } from '../engine/types';
import { initI18n } from '../i18n/i18n';
import { api } from '../platform/api';
import { setFormatPrefs } from '../shared/format';
import { type Api, type ChangedBroadcast, call, type Method } from '../shared/rpc';
import { followTestClock, reportErrorsToBackground } from '../shared/test-hooks';

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
    // `deps` are the caller's: the model is loaded again when one of them changes.
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

type Appearance = Pick<Settings, 'theme' | 'highContrast' | 'hour12' | 'dateFormat'>;

/** The settings last applied, which a change of the system's colours applies again. */
let appearance: Appearance | null = null;

/** Applies theme, contrast, language and formats from the settings. */
export function applyAppearance(s: Appearance) {
  appearance = s;
  const root = document.documentElement;
  const dark =
    s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (s.theme === 'system') {
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else root.setAttribute('data-theme', s.theme);
  if (s.highContrast) root.setAttribute('data-contrast', 'high');
  else root.removeAttribute('data-contrast');
  setFormatPrefs(s);
}

/** Initialises i18n and appearance for a UI page. Returns the settings. */
export async function bootPage(): Promise<Settings> {
  if (__TEST__) {
    reportErrorsToBackground(location.pathname.slice(1));
    await followTestClock();
  }
  const model = await call('config.get', {});
  const s = model.config.settings;
  await initI18n(s.language);
  applyAppearance(s);
  followSystemColours();
  return s;
}

/**
 * A theme that follows the system changes with it, as the settings are now: those of a page that
 * stays open (the dashboard) may have changed since it opened.
 */
export function followSystemColours() {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (appearance) applyAppearance(appearance);
  });
}
