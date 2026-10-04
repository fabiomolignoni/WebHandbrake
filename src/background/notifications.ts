/** Optional system notifications (NOT-04): the permission is requested only when the user enables them. */

import { api, extensionUrl, quiet } from '../platform/api';
import { store } from './store';

export async function notificationsAllowed(): Promise<boolean> {
  if (!api.notifications?.create) return false;
  return Boolean(await quiet(api.permissions.contains({ permissions: ['notifications'] })));
}

export async function notify(id: string, title: string, message: string) {
  if (!store.config.settings.notifications.enabled) return;
  if (!(await notificationsAllowed())) return;
  await quiet(
    api.notifications.create(id, {
      type: 'basic',
      iconUrl: extensionUrl('icons/icon-128.png'),
      title,
      message,
    }),
  );
}

export function registerNotificationClicks() {
  api.notifications?.onClicked?.addListener((id) => {
    if (id.startsWith('pending-'))
      void quiet(api.tabs.create({ url: extensionUrl('dashboard.html#/protection') }));
    else if (id.startsWith('session-'))
      void quiet(api.tabs.create({ url: extensionUrl('dashboard.html#/focus') }));
    else void quiet(api.tabs.create({ url: extensionUrl('dashboard.html') }));
    void quiet(api.notifications.clear(id));
  });
}
