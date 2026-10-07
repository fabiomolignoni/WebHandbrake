/**
 * Background entry point (Chrome service worker / Firefox event page).
 * All listeners are registered synchronously at the top level so that events wake the worker.
 */

import { newId } from '../engine/defaults';
import { INACTIVE_GAP_MS } from '../engine/limits';
import { initI18n, t } from '../i18n/i18n';
import { api, extensionUrl, quiet, sessionStore } from '../platform/api';
import { captureErrors } from '../shared/test-hooks';
import { forgetTab, initIdle, releaseMute, setIdleState } from './accounting';
import { updateBadge } from './badge';
import { initClockObserver, restoreTestClock } from './clock';
import { registerNavigationListeners, registerTabListeners } from './enforce';
import { registerCommands, registerMenuClicks } from './menus';
import { onMessage } from './messages';
import { registerNotificationClicks } from './notifications';
import { periodic } from './periodic';
import { registerPermissionListeners } from './permissions';
import { ALARM_NEXT, ALARM_PERIODIC, ensurePeriodicAlarm, reconcile } from './reconcile';
import { store } from './store';
import { testLog } from './test-log';

if (__TEST__) captureErrors('background', (m) => testLog.errors.push(m));

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

async function boot() {
  if (__TEST__) await restoreTestClock();
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
    if (!alive && !startupEvent && !store.firstRun && gap > INACTIVE_GAP_MS) {
      store.addTamper({ at: Date.now(), kind: 'inactive-gap', detail: String(Math.round(gap / 60_000)) });
      void store.saveState();
    }
  }, 3000);
  initIdle();
  await ensurePeriodicAlarm();
  await reconcile('boot', { config: true });
}

void boot();
