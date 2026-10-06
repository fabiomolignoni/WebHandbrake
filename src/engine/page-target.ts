/** The entry that "Block this site / page" adds for a URL (MAT-17), shared by the popup preview. */

import { newId } from './defaults';
import type { Target } from './types';
import { parseUrl, stripWww } from './url';

export type Granularity = 'domain' | 'host' | 'path' | 'page';

export function targetFor(url: string, granularity: Granularity): Target | null {
  const p = parseUrl(url);
  if (!p?.web) return null;
  const host = stripWww(p.host);
  const path = p.path.length > 1 ? p.path.replace(/\/+$/, '') : '';
  switch (granularity) {
    case 'domain':
      return { id: newId(), type: 'domain', value: host };
    case 'host':
      return { id: newId(), type: 'host', value: host };
    case 'path':
      return path
        ? { id: newId(), type: 'path', value: `${host}${path}` }
        : { id: newId(), type: 'domain', value: host };
    case 'page': {
      const q = p.query.map(([k, v]) => `${k}=${v}`).join('&');
      if (!path && !q) return { id: newId(), type: 'homepage', value: host };
      return { id: newId(), type: 'page', value: `${host}${path || '/'}${q ? `?${q}` : ''}` };
    }
  }
}
