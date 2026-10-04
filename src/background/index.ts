/**
 * Background entry point (Chrome service worker / Firefox event page).
 * All listeners are registered synchronously at the top level so that events wake the worker.
 */

import { newId } from '../engine/defaults';
import { dayKeyOf } from '../engine/time';
import { initI18n, t } from '../i18n/i18n';
import { api, extensionUrl, quiet, sessionStore } from '../platform/api';
import { forgetTab, initIdle, releaseMute, setIdleState } from './accounting';
import { updateBadge } from './badge';
import { initClockObserver, now } from './clock';
import { counters } from './diagnostics-state';
import { registerNavigationListeners, registerTabListeners } from './enforce';
import { announceAvailableLater } from './later';
import { registerCommands, registerMenuClicks } from './menus';
import { onMessage } from './messages';
import { registerNotificationClicks } from './notifications';
import { checkIncognito, registerPermissionListeners } from './permissions';
import { ALARM_NEXT, ALARM_PERIODIC, ensurePeriodicAlarm, maintenance, reconcile } from './reconcile';
import { applyRetention } from './stats';
import { store } from './store';

let startupEvent = false;

api.runtime.onMessage.addListener(onMessage);

api.runtime.onInstalled.addListener((details) => {
  startupEvent = true;
  void (async () => {
    await store.ready();
    await initI18n(store.config.settings.language);
    if (details.reason === 'install') {
      if (!store.config.settings.interventions.alternatives.length) {
        const next = JSON.parse(JSON.stringify(store.config));
        next.settings.interventions.alternatives = [
          { id: newId(), label: t('alternatives.default.walk') },
          { id: newId(), label: t('alternatives.default.water') },
          { id: newId(), label: t('alternatives.default.write') },
        ];
        await store.writeConfig(next, 'install');
      }
      store.meta.installedAt = Date.now();
      await store.saveMeta();
      if (!store.config.settings.onboarded)
        await quiet(api.tabs.create({ url: extensionUrl('dashboard.html#/welcome') }));
    }
    store.meta.version = api.runtime.getManifest().version;
    await store.saveMeta();
    await reconcile('installed', { config: true });
  })();
});

api.runtime.onStartup.addListener(() => {
  startupEvent = true;
  void reconcile('startup', { config: true });
});

api.alarms.onAlarm.addListener((alarm) => {
  void (async () => {
    await store.ready();
    if (alarm.name === ALARM_NEXT) await reconcile('alarm');
    else if (alarm.name === ALARM_PERIODIC) await periodic();
  })();
});

api.idle?.onStateChanged?.addListener((s) => setIdleState(s as 'active' | 'idle' | 'locked'));

registerNavigationListeners((tabId, url) => void releaseMute(tabId, url));
registerTabListeners(
  (tabId) => {
    void (async () => {
      const tab = await quiet(api.tabs.get(tabId));
      if (tab?.id !== undefined) await updateBadge(tab.id, tab.url, Boolean(tab.incognito));
    })();
  },
  (tabId) => forgetTab(tabId),
);
registerPermissionListeners();
registerMenuClicks();
registerCommands();
registerNotificationClicks();
initClockObserver();

/** Every minute: persist counters and expire timed state. No tab polling (PERF-01). */
async function periodic() {
  counters.wakeups++;
  await store.flushAll();
  const before = JSON.stringify([
    store.state.grants.length,
    store.state.sessions.length,
    store.state.pending.length,
  ]);
  await maintenance();
  const after = JSON.stringify([
    store.state.grants.length,
    store.state.sessions.length,
    store.state.pending.length,
  ]);
  if (before !== after) await reconcile('periodic');
  const today = dayKeyOf(now(), store.cc.cal);
  if (store.meta.lastDaily !== today) {
    store.meta.lastDaily = today;
    await store.saveMeta();
    await daily();
  }
  await announceAvailableLater();
}

async function daily() {
  store.usage.pruneMinutes(now());
  await store.flushUsage();
  await applyRetention();
  await checkIncognito();
  // A daily snapshot even when nothing changed (DAT-03).
  await store.snapshotDaily();
}

async function boot() {
  await store.ready();
  await initI18n(store.config.settings.language);
  for (const e of store.pendingTamper.splice(0)) store.addTamper(e);
  // PRO-13: the background starts without a browser start-up or an install: the extension was
  // disabled and enabled again (or crashed). Report long gaps.
  const alive = await sessionStore.get<boolean>('alive');
  await sessionStore.set('alive', true);
  // Read before the first reconciliation, which records the current time as "last alive".
  const lastAlive = store.state.lastAlive;
  setTimeout(() => {
    const gap = Date.now() - (lastAlive || Date.now());
    if (!alive && !startupEvent && !store.firstRun && gap > 10 * 60_000) {
      store.addTamper({ at: Date.now(), kind: 'inactive-gap', detail: String(Math.round(gap / 60_000)) });
      void store.saveState();
    }
  }, 3000);
  initIdle();
  await ensurePeriodicAlarm();
  await reconcile('boot', { config: true });
}

void boot();
