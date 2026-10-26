/** Context menu and keyboard shortcuts, desktop only (feature detected). */

import { isGroupActive } from '../engine/compile';
import { DEFAULT_SESSION_MINUTES, QUICK_SESSION_MINUTES } from '../engine/limits';
import { targetFor } from '../engine/page-target';
import { t } from '../i18n/i18n';
import { api, extensionUrl, features, quiet } from '../platform/api';
import { newRuleRoute, openBlockSitePanel } from '../shared/block-site';
import type { Granularity } from '../shared/rpc';
import { listenEverywhere, sharePrivateMenus } from './bridge';
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
  const items = menuItems();
  for (const props of items) create(props);
  // Chrome's private windows show the items of their own background (bridge.ts).
  await sharePrivateMenus(items);
}

function menuItems(): chrome.contextMenus.CreateProperties[] {
  const items: chrome.contextMenus.CreateProperties[] = [];
  if (!store.config.settings.contextMenu) return items;
  const groups = store.config.groups.filter(isGroupActive);
  const urlPatterns = ['http://*/*', 'https://*/*'];
  for (const item of ROOT_ITEMS) {
    items.push({
      id: item.id,
      title: t(item.key),
      contexts: ctxs(item.contexts),
      ...(item.id === 'link' ? { targetUrlPatterns: urlPatterns } : { documentUrlPatterns: urlPatterns }),
    });
    for (const g of groups) {
      items.push({
        id: `${item.id}|${g.id}`,
        parentId: item.id,
        title: g.name,
        contexts: ctxs(item.contexts),
      });
    }
    items.push({
      id: `${item.id}|new`,
      parentId: item.id,
      title: t('menu.newGroup'),
      contexts: ctxs(item.contexts),
    });
  }
  // A quick session blocks the rules marked for it: with none, it would block nothing.
  if (!groups.some((g) => g.options.quickSession)) return items;
  items.push({ id: 'focus', title: t('menu.focus'), contexts: ctxs(['page', 'action']) });
  for (const m of QUICK_SESSION_MINUTES) {
    items.push({
      id: `focus|${m}`,
      parentId: 'focus',
      title: t('menu.focusMinutes', { minutes: m }),
      contexts: ctxs(['page', 'action']),
    });
  }
  return items;
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
      // A quick session allows no breaks of its rules.
      noPauses: true,
    });
    return;
  }
  const item = ROOT_ITEMS.find((x) => x.id === root);
  if (!item || !arg) return;
  const url = root === 'link' ? info.linkUrl : (info.pageUrl ?? tab?.url);
  if (!url) return;
  // A new rule is set up in the rule editor, with the page in it, and exists once created there.
  if (arg === 'new') return openNewRule(url, item.granularity);
  // One configuration change at a time, as for the changes made from the dashboard.
  await store.mutate(() => addPage(url, item.granularity, arg));
}

/** The rule editor with a new rule that blocks the page. */
async function openNewRule(url: string, granularity: Granularity) {
  await quiet(api.tabs.create({ url: extensionUrl(`dashboard.html#${newRuleRoute(url, granularity)}`) }));
}

export function registerMenuClicks() {
  if (!features.contextMenus) return;
  listenEverywhere(
    api.contextMenus.onClicked,
    'contextMenus.onClicked',
    (info, tab) => void onMenuClicked(info, tab),
  );
}

/** A keyboard shortcut. */
export async function onCommand(command: string, tab?: chrome.tabs.Tab) {
  // "Block this site" opens the popup on its panel, before anything is awaited (openBlockSitePanel).
  // In Chrome a private tab's command comes from the private windows' background, which tried.
  const panel =
    command === 'block-site' && !(__TARGET__ === 'chrome' && tab?.incognito) ? openBlockSitePanel(tab) : null;
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
      // A quick session allows no breaks of its rules.
      noPauses: true,
    });
  } else if (command === 'open-dashboard') {
    await quiet(api.tabs.create({ url: extensionUrl('dashboard.html') }));
  } else if (command === 'block-site') {
    if (await panel) return;
    const active = tab ?? (await quiet(api.tabs.query({ active: true, currentWindow: true })))?.[0];
    if (!active?.url) return;
    // Without the popup: a rule that blocks the site right now and keeps blocking it, or else a new
    // one in the rule editor. The shortcut is "block", not "add".
    const url = active.url;
    if (!targetFor(url, 'domain')) return;
    const groupId = defaultAddGroup(url, 'domain');
    if (groupId) await store.mutate(() => addPage(url, 'domain', groupId));
    else await openNewRule(url, 'domain');
  }
}

export function registerCommands() {
  if (!features.commands) return;
  listenEverywhere(
    api.commands.onCommand,
    'commands.onCommand',
    (command, tab) => void onCommand(command, tab),
  );
}
