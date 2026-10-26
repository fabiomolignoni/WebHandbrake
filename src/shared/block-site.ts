/**
 * "Block this site", from the popup, the context menu and the keyboard shortcut: the address of the
 * rule editor for a new rule with the page in it, and the shortcut that opens the popup on its
 * "Block this site" panel.
 *
 * Before opening the popup, the background leaves a note in session storage, which the popup reads
 * once as it starts. The note names the tab and expires in seconds, so a popup opened later, or for
 * another tab, opens as usual.
 */

import { GRANULARITIES, type Granularity } from '../engine/page-target';
import { api, sessionStore } from '../platform/api';

/** The page a new rule starts from. */
export interface RulePage {
  url: string;
  granularity: Granularity;
}

/** The dashboard route of a new rule with a page in it ("Block this site" › New rule…). */
export function newRuleRoute(url: string, granularity: Granularity): string {
  return `/groups/new?${new URLSearchParams({ url, granularity })}`;
}

/** The page named by a new rule's route, if any. */
export function routePage(query: URLSearchParams): RulePage | null {
  const url = query.get('url');
  const granularity = query.get('granularity') as Granularity | null;
  if (!url) return null;
  return { url, granularity: granularity && GRANULARITIES.includes(granularity) ? granularity : 'domain' };
}

const NOTE = 'popup:block-site';
/** How long the note is good for: the popup opens at once, or not at all. */
export const NOTE_MS = 10_000;

interface Note {
  tabId: number;
  at: number;
}

/**
 * Opens the popup on its "Block this site" panel for a tab; false when the browser cannot (no
 * action.openPopup before Chrome 127, a window not in front). Call it before anything is awaited:
 * Firefox may open the popup only while the extension handles the key.
 */
export async function openBlockSitePanel(tab: chrome.tabs.Tab | undefined): Promise<boolean> {
  if (tab?.id === undefined || !api.action?.openPopup) return false;
  const saved = sessionStore.set(NOTE, { tabId: tab.id, at: Date.now() } satisfies Note);
  try {
    await Promise.all([
      saved,
      api.action.openPopup(tab.windowId !== undefined ? { windowId: tab.windowId } : {}),
    ]);
    return true;
  } catch {
    await sessionStore.remove(NOTE).catch(() => undefined);
    return false;
  }
}

/** Popup: whether it was opened by the shortcut for this tab. The note is read once. */
export async function takeBlockSiteNote(tabId: number | undefined, now = Date.now()): Promise<boolean> {
  try {
    const note = await sessionStore.get<Note>(NOTE);
    if (!note) return false;
    await sessionStore.remove(NOTE);
    return note.tabId === tabId && now - note.at >= 0 && now - note.at < NOTE_MS;
  } catch {
    return false;
  }
}
