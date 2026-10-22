/** "Block this site / page" from the popup, the context menu and the keyboard shortcut. */

import type { CompiledGroup } from '../engine/compile';
import { evaluateGroup } from '../engine/decide';
import { breaksLift, newGroup, newPolicy } from '../engine/defaults';
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

/** How a rule would block a page once the page's entry is in it. */
export interface Blocking {
  /** It blocks the page right now (the context's time). */
  now: boolean;
  /** Blocking now: when it stops, as a time window ends or a limit starts again; null if not
   * within the horizon. Not blocking now: when it starts; null if it does not (it asks first,
   * waits, filters or only counts). */
  change: number | null;
}

export function blockingIn(cg: CompiledGroup, url: string, granularity: Granularity, c = ctx()): Blocking {
  const target = targetFor(url, granularity);
  const parsed = parseUrl(url);
  const cp = target && compilePattern(target);
  if (!cp || !parsed) return { now: false, change: null };
  const blocks = (at: number) => breaksLift(evaluateGroup({ ...c, now: at }, cg, cp, parsed).base);
  const now = blocks(c.now);
  return { now, change: candidateTimes(c, [cg]).find((t) => blocks(t) !== now) ?? null };
}

/**
 * The rule that "Block this site" adds to unless told otherwise: the last one used, or else
 * the first one, that blocks the page now and keeps blocking it. Null for a new rule: in a rule
 * that applies only at certain times or after a limit, the page would open again, or not be
 * blocked at all yet.
 */
export function defaultAddGroup(url: string, granularity: Granularity, c = ctx()): string | null {
  const always = (cg: CompiledGroup | undefined) => {
    const b = cg && blockingIn(cg, url, granularity, c);
    return Boolean(b?.now && b.change === null);
  };
  const last = store.meta.lastAddGroup;
  if (last && always(c.cc.byId.get(last))) return last;
  return c.cc.groups.find((cg) => always(cg))?.group.id ?? null;
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
