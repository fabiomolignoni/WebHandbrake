/**
 * The tabs of every window. In Chrome the tabs of the private windows belong to the background of
 * the private windows (bridge.ts): the calls about them run there.
 */

import { api } from '../platform/api';
import { callPrivate, isPrivateTab, type PrivateCall, privateWindowsOpen } from './bridge';

/** Chrome's error for a tab of another background (or a closed one). */
const NO_TAB = /no tab with id/i;

/** Runs a call about a tab in the background of the tab's window. */
export async function onTab<T>(
  tabId: number,
  local: () => Promise<T>,
  fn: PrivateCall,
  ...args: unknown[]
): Promise<T> {
  if (await isPrivateTab(tabId)) return (await callPrivate(fn, ...args)) as T;
  try {
    return await local();
  } catch (e) {
    // A private tab whose first events are still on the way.
    if (e instanceof Error && NO_TAB.test(e.message) && (await privateWindowsOpen()))
      return (await callPrivate(fn, ...args)) as T;
    throw e;
  }
}

export const getTab = (id: number) => onTab(id, () => api.tabs.get(id), 'tabs.get', id);

/** The window of a tab (whether it is minimised). */
export const getWindow = (tabId: number, windowId: number) =>
  onTab(tabId, () => api.windows.get(windowId), 'windows.get', windowId);

export const updateTab = (id: number, props: chrome.tabs.UpdateProperties) =>
  onTab(id, () => api.tabs.update(id, props), 'tabs.update', id, props);

export const removeTab = (id: number) => onTab(id, () => api.tabs.remove(id), 'tabs.remove', id);

export const messageTab = (id: number, message: unknown) =>
  onTab<unknown>(id, () => api.tabs.sendMessage(id, message), 'tabs.sendMessage', id, message);

/** Injects scripts into a tab already open. */
export const injectScript = (tabId: number, files: string[]) =>
  onTab(
    tabId,
    async () => void (await api.scripting.executeScript({ target: { tabId }, files })),
    'scripting.executeScript',
    tabId,
    files,
  );

/**
 * The tabs of every window, private ones included. Not for the current window, which each
 * background has its own of: api.tabs.query.
 */
export async function queryTabs(q: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  const local = api.tabs.query(q);
  if (!(await privateWindowsOpen())) return local;
  const remote = (callPrivate('tabs.query', q) as Promise<chrome.tabs.Tab[]>).catch(() => []);
  return [...(await local), ...(await remote)];
}
