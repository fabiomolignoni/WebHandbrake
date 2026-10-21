/** Context menu and keyboard shortcuts, desktop only (feature detected). */

import { isGroupActive } from '../engine/compile';
import { DEFAULT_SESSION_MINUTES, QUICK_SESSION_MINUTES } from '../engine/limits';
import { t } from '../i18n/i18n';
import { api, extensionUrl, features, quiet } from '../platform/api';
import type { Granularity } from '../shared/rpc';
import { addPage, defaultAddGroup } from './pages';
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
  const groups = store.config.groups.filter(isGroupActive);
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
  // A quick session blocks the rules marked for it: with none, it would block nothing.
  if (!groups.some((g) => g.options.quickSession)) return;
  create({ id: 'focus', title: t('menu.focus'), contexts: ctxs(['page', 'action']) });
  for (const m of QUICK_SESSION_MINUTES) {
    create({
      id: `focus|${m}`,
      parentId: 'focus',
      title: t('menu.focusMinutes', { minutes: m }),
      contexts: ctxs(['page', 'action']),
    });
  }
}

/** A click on one of the context menu items. */
export async function onMenuClicked(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  await store.ready();
  const [root, arg] = String(info.menuItemId).split('|');
  if (root === 'focus') {
    await startSession({
      kind: 'groups',
      groups: [],
      allow: [],
      minutes: Number(arg) || DEFAULT_SESSION_MINUTES,
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

/** A keyboard shortcut. */
export async function onCommand(command: string, tab?: chrome.tabs.Tab) {
  await store.ready();
  if (command === 'start-session') {
    // Without a rule for quick sessions, the Focus page says how to choose them.
    if (!store.config.groups.some((g) => isGroupActive(g) && g.options.quickSession)) {
      await quiet(api.tabs.create({ url: extensionUrl('dashboard.html#/focus') }));
      return;
    }
    await startSession({
      kind: 'groups',
      groups: [],
      allow: [],
      minutes: DEFAULT_SESSION_MINUTES,
      locked: false,
      noPauses: false,
    });
  } else if (command === 'open-dashboard') {
    await quiet(api.tabs.create({ url: extensionUrl('dashboard.html') }));
  } else if (command === 'block-site') {
    const active = tab ?? (await quiet(api.tabs.query({ active: true, currentWindow: true })))?.[0];
    if (!active?.url) return;
    // A rule that blocks the site right now, or a new one: the shortcut is "block", not "add".
    const url = active.url;
    await store.mutate(() => addPage(url, 'domain', defaultAddGroup(url, 'domain')));
  }
}

export function registerCommands() {
  if (!features.commands) return;
  api.commands.onCommand.addListener((command, tab) => void onCommand(command, tab));
}
