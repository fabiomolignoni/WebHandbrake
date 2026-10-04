/** Compiles a configuration into matcher indexes (cached by the background). */

import { type CompiledPattern, compilePattern, PatternIndex } from './patterns';
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
  allowlist: PatternIndex;
  /** ENF-09: destination pages of redirect interventions (scheme://host/path, no query), never intervened on. */
  redirectTargets: Set<string>;
  cal: CalendarSettings;
  /** Targets that failed to compile (invalid regex…), for diagnostics. */
  invalid: Target[];
}

/** Identity of a redirect destination page: placeholders and query removed, www. ignored. */
export function redirectKey(url: string): string {
  return pageKey(url.replace(/\{[a-z]+\}/g, '')).split('?')[0];
}

export function isGroupActive(g: Group): boolean {
  return g.enabled && !g.archived;
}

export function groupTargets(config: Config, g: Group): Target[] {
  const out = [...g.targets];
  for (const listId of g.lists) {
    const list = config.lists.find((l) => l.id === listId);
    if (list) out.push(...list.targets);
  }
  return out;
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
    groups.push({ group, index: compileTargets(groupTargets(config, group), invalid), order });
  });
  const allowlist = compileTargets(
    config.allowlist.map((t) => ({ ...t, allow: true })),
    invalid,
  );
  const redirectTargets = new Set<string>();
  for (const g of config.groups) {
    for (const p of g.policies) {
      if (p.intervention.type === 'redirect' && p.intervention.url) {
        redirectTargets.add(redirectKey(p.intervention.url));
      }
    }
  }
  return {
    config,
    groups,
    byId: new Map(groups.map((g) => [g.group.id, g])),
    allowlist,
    redirectTargets,
    cal: { dayStart: config.settings.dayStart, weekStart: config.settings.weekStart },
    invalid,
  };
}

export function allPatterns(cc: CompiledConfig): CompiledPattern[] {
  return [...cc.groups.flatMap((g) => g.index.all), ...cc.allowlist.all];
}
