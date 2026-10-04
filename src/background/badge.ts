/** Toolbar badge with the remaining time (NOT-02, LIM-10, BRK-10). */

import { decide, isNav } from '../engine/decide';
import { nextRestriction } from '../engine/next';
import { t } from '../i18n/i18n';
import { api, blockedUrlFrom, quiet } from '../platform/api';
import { formatBadge, formatDuration } from '../shared/format';
import { ctx } from './engine';
import { store } from './store';

const action = () => api.action ?? (api as unknown as { browserAction?: typeof chrome.action }).browserAction;

export async function updateBadge(tabId: number, url: string | undefined, incognito: boolean) {
  const a = action();
  if (!a) return;
  const settings = store.config.settings;
  let text = '';
  let color = settings.accent;
  let title = t('ext.name');
  if (settings.badge.enabled && url && !blockedUrlFrom(url)) {
    const c = ctx();
    const d = decide(c, url, { incognito });
    if (!d.exempt && d.groups.length && !isNav(d)) {
      const r = nextRestriction(c, url, { incognito }, d);
      const pause = d.groups.find((g) => g.pause)?.pause;
      if (r) {
        const seconds = (r.at - c.now) / 1000;
        if (seconds <= settings.badge.thresholdMinutes * 60) {
          text = formatBadge(seconds);
          if (pause) color = '#6a5acd';
          else if (seconds < 60) color = '#b5562b';
          const group = store.config.groups.find((g) => g.id === r.groupId);
          title = t('badge.title', { group: group?.name ?? '', time: formatDuration(seconds) });
        }
      }
    }
  }
  await quiet(a.setBadgeText({ tabId, text }));
  if (text) await quiet(a.setBadgeBackgroundColor({ tabId, color }));
  await quiet(a.setTitle({ tabId, title }));
}

export async function updateActiveBadges() {
  const tabs = (await quiet(api.tabs.query({ active: true }))) ?? [];
  for (const tab of tabs)
    if (tab.id !== undefined) await updateBadge(tab.id, tab.url, Boolean(tab.incognito));
}
