/** Compiles a configuration into matcher indexes (cached by the background). */

import { compilePattern, PatternIndex } from './patterns';
import type { CalendarSettings } from './time';
import type { Config, Group, Target } from './types';
import { pageKey } from './url';

export interface CompiledGroup {
  group: Group;
  index: PatternIndex;
  /** Position in the user's order (only used for deterministic tie-breaks, never for severity). */
  order: number;
}

export interface CompiledConfig {
  config: Config;
  groups: CompiledGroup[];
  byId: Map<string, CompiledGroup>;
  cal: CalendarSettings;
  /** Targets that failed to compile (invalid regex…), for diagnostics. */
  invalid: Target[];
}

/** Identity of a redirect destination page: placeholders and query removed, www. ignored. */
export function redirectKey(url: string): string {
  return pageKey(redirectDestination(url)).split('?')[0];
}

/** A redirect address without its placeholders: the page the redirect leads to. */
export function redirectDestination(url: string): string {
  return url.replace(/\{[a-z]+\}/g, '');
}

/** A rule that is on and not archived: the only rules that apply. */
export function isGroupActive(g: Pick<Group, 'enabled' | 'archived'>): boolean {
  return g.enabled && !g.archived;
}

export function compileTargets(targets: Target[], invalid?: Target[]): PatternIndex {
  const index = new PatternIndex();
  for (const t of targets) {
    const cp = compilePattern(t);
    if (cp) index.add(cp);
    else invalid?.push(t);
  }
  return index;
}

export function compileConfig(config: Config): CompiledConfig {
  const invalid: Target[] = [];
  const groups: CompiledGroup[] = [];
  config.groups.forEach((group, order) => {
    if (!isGroupActive(group)) return;
    groups.push({ group, index: compileTargets(group.targets, invalid), order });
  });
  return {
    config,
    groups,
    byId: new Map(groups.map((g) => [g.group.id, g])),
    cal: { dayStart: config.settings.dayStart, weekStart: config.settings.weekStart },
    invalid,
  };
}
