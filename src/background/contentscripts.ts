/**
 * Content scripts are registered only for the hosts of the groups (PERF-03), or everywhere when
 * the user opted in to tracking all sites (STA-01).
 */

import { contentMatchPatterns } from '../engine/patterns';
import { api, features, quiet } from '../platform/api';
import { store } from './store';

const SCRIPT_ID = 'whb-content';

export function contentMatches(): string[] {
  if (store.config.settings.tracking.allSites) return ['<all_urls>'];
  const set = new Set<string>();
  for (const cg of store.cc.groups) {
    for (const cp of cg.index.all) for (const m of contentMatchPatterns(cp)) set.add(m);
  }
  if (set.has('<all_urls>')) return ['<all_urls>'];
  return [...set].sort();
}

let lastMatches = '';

export async function updateContentScripts(force = false) {
  if (!features.scripting) return;
  const matches = contentMatches();
  const signature = matches.join(' ');
  const registered = (await quiet(api.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }))) ?? [];
  if (!force && signature === lastMatches && registered.length === (matches.length ? 1 : 0)) return;
  lastMatches = signature;
  if (registered.length) await quiet(api.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }));
  if (!matches.length) return;
  try {
    await api.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        js: ['content.js'],
        matches,
        runAt: 'document_start',
        allFrames: false,
        persistAcrossSessions: false,
      },
    ]);
  } catch (e) {
    // Some match patterns can be rejected (e.g. file:// without access): retry with web pages only.
    const web = matches.filter((m) => !m.startsWith('file:'));
    if (web.length) {
      await quiet(
        api.scripting.registerContentScripts([
          {
            id: SCRIPT_ID,
            js: ['content.js'],
            matches: web,
            runAt: 'document_start',
            allFrames: false,
            persistAcrossSessions: false,
          },
        ]),
      );
    }
    console.warn('WebHandbrake: content script registration', e);
  }
  await injectIntoOpenTabs(matches);
}

/** Injects the content script into tabs opened before the registration (install, new groups). */
async function injectIntoOpenTabs(matches: string[]) {
  const tabs = (await quiet(api.tabs.query({ url: matches.filter((m) => !m.startsWith('file:')) }))) ?? [];
  for (const tab of tabs) {
    if (tab.id === undefined || tab.discarded) continue;
    void quiet(api.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }));
  }
}
