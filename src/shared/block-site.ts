/**
 * "Block this site", from the popup and the context menu: the address of the rule editor for a new
 * rule with the page in it.
 */

import { GRANULARITIES, type Granularity } from '../engine/page-target';

/** The page a new rule starts from. */
export interface RulePage {
  url: string;
  granularity: Granularity;
}

/** The dashboard route of a new rule with a page in it ("Block this site" › New rule…). */
export function newRuleRoute(url: string, granularity: Granularity): string {
  return `/groups/new?${new URLSearchParams({ url, granularity })}`;
}

/** The page named by a new rule's route, if any. */
export function routePage(query: URLSearchParams): RulePage | null {
  const url = query.get('url');
  const granularity = query.get('granularity') as Granularity | null;
  if (!url) return null;
  return { url, granularity: granularity && GRANULARITIES.includes(granularity) ? granularity : 'domain' };
}
