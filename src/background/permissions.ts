/** Permission and private-window checks (PRO-09, PRO-13, ENF-12). */

import { api } from '../platform/api';
import { now } from './clock';
import { checkHostAccess, dnrStatus } from './dnr-sync';
import { reconcile } from './reconcile';
import { store } from './store';

export async function permissionsChanged() {
  await store.ready();
  const had = dnrStatus.hostAccess;
  const has = await checkHostAccess();
  if (had && !has) {
    store.addTamper({ at: now(), kind: 'host-permission' });
    await store.saveState();
  }
  await checkIncognito();
  await reconcile('permissions', { config: true });
}

export async function checkIncognito() {
  let allowed: boolean;
  try {
    allowed = await api.extension.isAllowedIncognitoAccess();
  } catch {
    return;
  }
  if (store.meta.incognitoAllowed === true && !allowed) {
    store.addTamper({ at: now(), kind: 'private-access' });
    await store.saveState();
  }
  if (store.meta.incognitoAllowed !== allowed) {
    store.meta.incognitoAllowed = allowed;
    await store.saveMeta();
  }
}

export function registerPermissionListeners() {
  api.permissions?.onAdded?.addListener(() => void permissionsChanged());
  api.permissions?.onRemoved?.addListener(() => void permissionsChanged());
}
