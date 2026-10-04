/** "Block this site / page" (MAT-17) from the popup, the context menu and the keyboard shortcut. */

import { defaultConfig, newGroup, newId, newPolicy } from '../engine/defaults';
import type { Config, Target } from '../engine/types';
import { parseUrl, stripWww } from '../engine/url';
import { t } from '../i18n/i18n';
import type { SaveResult } from '../shared/models';
import type { Granularity } from '../shared/rpc';
import { proposeConfig } from './protection';
import { store } from './store';

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
