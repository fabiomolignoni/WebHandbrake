/**
 * The toolbar button. On Firefox for Android, WebHandbrake in the Extensions menu opens the
 * dashboard: Android shows the popup as a page of its own, a step before the dashboard.
 */

import { api, extensionUrl, isAndroid, quiet } from '../platform/api';

/** Shows the dashboard: its tab when one is open, a new tab otherwise. */
export async function openDashboard() {
  const url = extensionUrl('dashboard.html');
  const tabs = (await quiet(api.tabs.query({}))) ?? [];
  const open = tabs.find((t) => t.url?.startsWith(url));
  if (open?.id !== undefined) await quiet(api.tabs.update(open.id, { active: true }));
  else await quiet(api.tabs.create({ url }));
}

/**
 * Without a popup the button sends its clicks to the background. The popup is removed each time the
 * background starts, since the browser does not keep the change.
 */
export function registerToolbar(android = isAndroid) {
  if (!android) return;
  void quiet(api.action.setPopup({ popup: '' }));
  api.action.onClicked.addListener(() => void openDashboard());
}
