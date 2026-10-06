/** "Block this site / page" (MAT-17) from the popup, the context menu and the keyboard shortcut. */

import { defaultConfig, newGroup, newPolicy } from '../engine/defaults';
import { type Granularity, targetFor } from '../engine/page-target';
import type { Config } from '../engine/types';
import { t } from '../i18n/i18n';
import type { SaveResult } from '../shared/models';
import { proposeConfig } from './protection';
import { store } from './store';

export async function addPage(
  url: string,
  granularity: Granularity,
  groupId: string | null,
  newGroupName?: string,
): Promise<SaveResult> {
  await store.ready();
  const target = targetFor(url, granularity);
  const empty: SaveResult = { applied: [], ticket: null, pending: null, refused: null };
  if (!target) return { ...empty, errors: [t('addPage.error.unsupported')] };
  const next: Config = JSON.parse(JSON.stringify(store.config ?? defaultConfig()));
  let group = groupId ? next.groups.find((g) => g.id === groupId) : undefined;
  if (!group) {
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
