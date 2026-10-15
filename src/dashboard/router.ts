/** Minimal hash router with an optional "unsaved changes" guard. */

import { useEffect, useState } from 'preact/hooks';

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, q] = raw.split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q ?? '') };
}

let guard: (() => boolean) | null = null;
let lastHash = location.hash;

/** Registers a function returning true when navigation away must be confirmed. */
export function setNavigationGuard(fn: (() => boolean) | null) {
  guard = fn;
}

export function navigate(to: string) {
  const hash = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (location.hash === hash) return;
  location.hash = hash;
}

export function useRoute(confirmLeave: () => boolean): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = () => {
      if (guard?.() && !confirmLeave()) {
        history.replaceState(null, '', lastHash || '#/');
        return;
      }
      guard = null;
      lastHash = location.hash;
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
