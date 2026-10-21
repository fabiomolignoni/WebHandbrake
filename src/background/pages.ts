/** "Block this site / page" from the popup, the context menu and the keyboard shortcut. */

import type { CompiledGroup } from '../engine/compile';
import { evaluateGroup } from '../engine/decide';
import { breaksLift, DEFAULT_PROTECTION, newGroup, newPolicy, pausePolicyFor } from '../engine/defaults';
import { clone } from '../engine/json';
import { candidateTimes } from '../engine/next';
import { type Granularity, targetFor } from '../engine/page-target';
import { compilePattern } from '../engine/patterns';
import type { Config } from '../engine/types';
import { parseUrl } from '../engine/url';
import { t } from '../i18n/i18n';
import type { SaveResult } from '../shared/models';
import { ctx } from './engine';
import { emptySaveResult, proposeConfig } from './protection';
import { store } from './store';

/**
 * When the page would be blocked once its entry is in the rule: now (the context's time), at a
 * later time when a condition, a limit or a session starts blocking, or null when the rule does
 * not block it within the horizon (it asks first, waits, filters or only counts).
 */
export function blockTimeIn(
  cg: CompiledGroup,
  url: string,
  granularity: Granularity,
  c = ctx(),
): number | null {
  const target = targetFor(url, granularity);
  const parsed = parseUrl(url);
  const cp = target && compilePattern(target);
  if (!cp || !parsed) return null;
  const blocks = (at: number) => breaksLift(evaluateGroup({ ...c, now: at }, cg, cp, parsed).base);
  if (blocks(c.now)) return c.now;
  return candidateTimes(c, [cg]).find(blocks) ?? null;
}

/**
 * The rule that "Block this site" adds to unless told otherwise: the last one used, or else
 * the first one, that blocks the page right now. Null for a new rule: adding a site to a rule
 * that applies only at certain times or after a limit would leave the page open.
 */
export function defaultAddGroup(url: string, granularity: Granularity, c = ctx()): string | null {
  const blocksNow = (cg: CompiledGroup | undefined) =>
    Boolean(cg) && blockTimeIn(cg!, url, granularity, c) === c.now;
  const last = store.meta.lastAddGroup;
  if (last && blocksNow(c.cc.byId.get(last))) return last;
  return c.cc.groups.find((cg) => blocksNow(cg))?.group.id ?? null;
}

export async function addPage(
  url: string,
  granularity: Granularity,
  groupId: string | null,
  newGroupName?: string,
): Promise<SaveResult> {
  await store.ready();
  const target = targetFor(url, granularity);
  if (!target) return emptySaveResult([t('addPage.error.unsupported')]);
  const next: Config = clone(store.config);
  let group = groupId ? next.groups.find((g) => g.id === groupId) : undefined;
  if (!group) {
    // A rule that blocks at all times, without breaks until they are turned on, as from the wizard.
    group = newGroup({
      name: newGroupName?.trim() || t('addPage.newGroupName'),
      policies: [newPolicy({ intervention: { type: 'block' } })],
      pause: { ...pausePolicyFor(DEFAULT_PROTECTION), allowed: false },
    });
    next.groups.push(group);
  }
  const exists = group.targets.some((x) => !x.allow && x.type === target.type && x.value === target.value);
  if (!exists) {
    // Adding a blocking entry replaces an identical exception, if any.
    group.targets = group.targets.filter(
      (x) => !(x.allow && x.type === target.type && x.value === target.value),
    );
    group.targets.push(target);
  }
  store.meta.lastAddGroup = group.id;
  void store.saveMeta();
  return proposeConfig(next, 'add-page');
}
