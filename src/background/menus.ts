/** Context menu (API-02) and keyboard shortcuts (API-01), desktop only (feature detected). */

import { t } from '../i18n/i18n';
import { api, extensionUrl, features, quiet } from '../platform/api';
import type { Granularity } from '../shared/rpc';
import { addPage } from './pages';
import { startSession } from './sessions';
import { store } from './store';
import { testLog } from './test-log';

type Contexts = chrome.contextMenus.CreateProperties['contexts'];
const ctxs = (c: readonly string[]) => [...c] as unknown as Contexts;

const ROOT_ITEMS = [
  { id: 'site', key: 'menu.blockSite', contexts: ['page'] as const, granularity: 'domain' as Granularity },
  { id: 'page', key: 'menu.blockPage', contexts: ['page'] as const, granularity: 'page' as Granularity },
  { id: 'link', key: 'menu.blockLink', contexts: ['link'] as const, granularity: 'domain' as Granularity },
];

function create(props: chrome.contextMenus.CreateProperties) {
  if (__TEST__)
    testLog.menus.push({ id: String(props.id), parentId: props.parentId as string, title: props.title });
  try {
    api.contextMenus.create(props, () => void api.runtime.lastError);
  } catch {
    // duplicate ids during rapid rebuilds
  }
}

export async function rebuildMenus() {
  if (!features.contextMenus) return;
  await quiet(api.contextMenus.removeAll());
  if (__TEST__) testLog.menus = [];
  if (!store.config.settings.contextMenu) return;
  const groups = store.config.groups.filter((g) => g.enabled && !g.archived);
  const urlPatterns = ['http://*/*', 'https://*/*'];
  for (const item of ROOT_ITEMS) {
    create({
      id: item.id,
      title: t(item.key),
      contexts: ctxs(item.contexts),
      ...(item.id === 'link' ? { targetUrlPatterns: urlPatterns } : { documentUrlPatterns: urlPatterns }),
    });
    for (const g of groups) {
      create({ id: `${item.id}|${g.id}`, parentId: item.id, title: g.name, contexts: ctxs(item.contexts) });
    }
    create({
      id: `${item.id}|new`,
      parentId: item.id,
      title: t('menu.newGroup'),
      contexts: ctxs(item.contexts),
    });
  }
  create({ id: 'focus', title: t('menu.focus'), contexts: ctxs(['page', 'action']) });
  for (const m of [25, 50, 90]) {
    create({
      id: `focus|${m}`,
      parentId: 'focus',
      title: t('menu.focusMinutes', { minutes: m }),
      contexts: ctxs(['page', 'action']),
    });
  }
}

/** API-02: a click on one of the context menu items. */
export async function onMenuClicked(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  await store.ready();
  const [root, arg] = String(info.menuItemId).split('|');
  if (root === 'focus') {
    await startSession({
      kind: 'groups',
      groups: [],
      allow: [],
      minutes: Number(arg) || 25,
      locked: false,
      noPauses: false,
    });
    return;
  }
  const item = ROOT_ITEMS.find((x) => x.id === root);
  if (!item || !arg) return;
  const url = root === 'link' ? info.linkUrl : (info.pageUrl ?? tab?.url);
  if (!url) return;
  // One configuration change at a time, as for the changes made from the dashboard.
  await store.mutate(() => addPage(url, item.granularity, arg === 'new' ? null : arg));
}

export function registerMenuClicks() {
  if (!features.contextMenus) return;
  api.contextMenus.onClicked.addListener((info, tab) => void onMenuClicked(info, tab));
}

/** API-01: a keyboard shortcut. */
export async function onCommand(command: string, tab?: chrome.tabs.Tab) {
  await store.ready();
  if (command === 'start-session') {
    await startSession({
      kind: 'groups',
      groups: [],
      allow: [],
      minutes: 25,
      locked: false,
      noPauses: false,
    });
  } else if (command === 'open-dashboard') {
    await quiet(api.tabs.create({ url: extensionUrl('dashboard.html') }));
  } else if (command === 'block-site') {
    const active = tab ?? (await quiet(api.tabs.query({ active: true, currentWindow: true })))?.[0];
    if (!active?.url) return;
    const last = store.meta.lastAddGroup;
    // A rule that is archived (or off) blocks nothing: never the destination of a shortcut.
    const usable = (g: { enabled: boolean; archived: boolean }) => g.enabled && !g.archived;
    const group =
      store.config.groups.find((g) => g.id === last && usable(g)) ?? store.config.groups.find(usable);
    await store.mutate(() => addPage(active.url!, 'domain', group?.id ?? null));
  }
}

export function registerCommands() {
  if (!features.commands) return;
  api.commands.onCommand.addListener((command, tab) => void onCommand(command, tab));
}
