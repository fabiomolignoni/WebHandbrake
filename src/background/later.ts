/** "Save for later" list (INT-12). */

import { isNav } from '../engine/decide';
import type { LaterItem } from '../engine/types';
import { pageKey } from '../engine/url';
import { t } from '../i18n/i18n';
import { api, quiet } from '../platform/api';
import type { LaterModel } from '../shared/models';
import { now } from './clock';
import { decideUrl } from './engine';
import { notify } from './notifications';
import { broadcast } from './reconcile';
import { store } from './store';

type Item = LaterItem & { wasBlocked?: boolean; announced?: boolean };

export async function addLater(
  url: string,
  title: string | undefined,
  groupId: string | undefined,
): Promise<LaterItem> {
  await store.ready();
  const key = pageKey(url);
  const existing = store.later.find((i) => pageKey(i.url) === key);
  if (existing) return existing;
  const item: Item = {
    id: crypto.randomUUID(),
    url,
    title: (title ?? '').slice(0, 300),
    groupId,
    savedAt: now(),
    wasBlocked: isNav(decideUrl(url, null)),
  };
  store.later.unshift(item);
  store.later = store.later.slice(0, 1000);
  await store.saveLater();
  broadcast(['later']);
  return item;
}

export async function removeLater(ids: string[]) {
  await store.ready();
  store.later = store.later.filter((i) => !ids.includes(i.id));
  await store.saveLater();
  broadcast(['later']);
}

export async function listLater(): Promise<LaterModel> {
  await store.ready();
  return { items: store.later.map((i) => ({ ...i, allowedNow: !isNav(decideUrl(i.url, null)) })) };
}

/** Opens saved pages that are allowed now and removes them from the list. */
export async function openLater(ids: string[]): Promise<number> {
  await store.ready();
  let opened = 0;
  const keep: LaterItem[] = [];
  for (const item of store.later) {
    if (ids.includes(item.id) && !isNav(decideUrl(item.url, null))) {
      await quiet(api.tabs.create({ url: item.url, active: opened === 0 }));
      opened++;
    } else keep.push(item);
  }
  store.later = keep;
  await store.saveLater();
  broadcast(['later']);
  return opened;
}

/** INT-12: optional notice when saved pages become available. */
export async function announceAvailableLater() {
  if (!store.config.settings.later.notify || !store.later.length) return;
  let count = 0;
  let changed = false;
  for (const item of store.later as Item[]) {
    if (!item.wasBlocked || item.announced) continue;
    if (!isNav(decideUrl(item.url, null))) {
      item.announced = true;
      changed = true;
      count++;
    }
  }
  if (changed) await store.saveLater();
  if (count) await notify('later', t('notify.later.title'), t('notify.later.body', { count }));
}
