/** Toolbar badge with the remaining time. */

import { decide } from '../engine/decide';
import { BRAND_COLOR } from '../engine/defaults';
import { nextRestriction } from '../engine/next';
import { isNav } from '../engine/severity';
import { t } from '../i18n/i18n';
import { api, blockedUrlFrom, quiet } from '../platform/api';
import { formatBadge, formatDuration } from '../shared/format';
import { ctx } from './engine';
import { store } from './store';
import { onTab, queryTabs } from './tabs';

const action = () => api.action ?? (api as unknown as { browserAction?: typeof chrome.action }).browserAction;

export async function updateBadge(tabId: number, url: string | undefined, incognito: boolean) {
  const a = action();
  if (!a) return;
  const settings = store.config.settings;
  let text = '';
  let color = BRAND_COLOR;
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
  await quiet(onTab(tabId, () => a.setBadgeText({ tabId, text }), 'action.setBadgeText', { tabId, text }));
  if (text) {
    const details = { tabId, color };
    await quiet(
      onTab(tabId, () => a.setBadgeBackgroundColor(details), 'action.setBadgeBackgroundColor', details),
    );
  }
  await quiet(onTab(tabId, () => a.setTitle({ tabId, title }), 'action.setTitle', { tabId, title }));
}

export async function updateActiveBadges() {
  const tabs = (await quiet(queryTabs({ active: true }))) ?? [];
  for (const tab of tabs)
    if (tab.id !== undefined) await updateBadge(tab.id, tab.url, Boolean(tab.incognito));
}
