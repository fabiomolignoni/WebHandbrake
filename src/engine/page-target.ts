/**
 * The entry that "Block this site / page" adds for a URL, shared by the popup preview, and the
 * rule that its "New rule…" starts in the rule editor.
 */

import { newId, newPolicy } from './defaults';
import type { Group, Target } from './types';
import { entryQuery, parseUrl, stripWww } from './url';

export type Granularity = 'domain' | 'host' | 'path' | 'page';

export const GRANULARITIES: readonly Granularity[] = ['domain', 'host', 'path', 'page'];

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
      const q = entryQuery(p.query);
      if (!path && !q) return { id: newId(), type: 'homepage', value: host };
      return { id: newId(), type: 'page', value: `${host}${path || '/'}${q ? `?${q}` : ''}` };
    }
  }
}

/**
 * What a new rule from "Block this site" › New rule… starts with: the page's entry, blocked at all
 * times, since blocking is what was asked. Null for a page that cannot be blocked.
 */
export function pageRule(url: string, granularity: Granularity): Pick<Group, 'targets' | 'policies'> | null {
  const target = targetFor(url, granularity);
  return target && { targets: [target], policies: [newPolicy({ intervention: { type: 'block' } })] };
}
