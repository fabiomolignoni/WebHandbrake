/** Message router. Content scripts may only call the cs.* methods (SEC-05). */

import { normalizeConfig } from '../engine/schema';
import { t } from '../i18n/i18n';
import { api, extensionUrl, quiet } from '../platform/api';
import type { Api, Envelope, Method } from '../shared/rpc';
import { onTick } from './accounting';
import { forfeitBudget } from './budget';
import {
  applyImport,
  exportData,
  exportGroupFile,
  listBackups,
  previewImport,
  resetConfig,
  restoreBackup,
  storageUsage,
} from './data';
import { clearLog, diagModel, diagReport, runSelftest } from './diagnostics';
import { counters } from './diagnostics-state';
import { enforceTab, finishGrace, reopenBlockedTabs } from './enforce';
import { explainDraft } from './explain';
import { closeSenderTab, interventionLeft, interventionModel, reopenInTab } from './intervention';
import { addLater, listLater, openLater, removeLater } from './later';
import { addPage } from './pages';
import { cancelPause, pauseOptions, startPause } from './pauses';
import { permissionsChanged } from './permissions';
import {
  cancelEmergency,
  cancelPending,
  changePassword,
  confirmPending,
  proposeConfig,
  requestEmergency,
  startEmergency,
} from './protection';
import { reconcile } from './reconcile';
import { endSession, extendSession, startSession } from './sessions';
import { deleteStats, exportStats, getStats } from './stats';
import { store } from './store';
import { accessibleAlternative, answerTicket, cancelTicket, getTicket, ticketView } from './tickets';
import { configModel, overviewModel, popupModel } from './views';

type Handler<M extends Method> = (
  args: Api[M]['req'],
  sender: chrome.runtime.MessageSender,
) => Promise<Api[M]['res']> | Api[M]['res'];

const handlers: { [M in Method]: Handler<M> } = {
  'overview.get': () => overviewModel(),
  'config.get': () => configModel(),
  'popup.get': (a) => popupModel(a.tabId),
  explain: (a) => explainDraft(a.url, a.draftGroup, a.incognito ?? false),
  'intervention.get': (a, s) => interventionModel(a.url, s),
  'intervention.left': (a, s) => interventionLeft(a.url, a.how, s),

  'config.save': (a) => {
    const { config, errors } = normalizeConfig(a.config);
    return proposeConfig(config, 'edit', { errors });
  },
  'config.addPage': (a) => addPage(a.url, a.granularity, a.groupId, a.newGroupName),
  'group.export': (a) => exportGroupFile(a.groupId),

  'ticket.view': async (a) => {
    const t = await getTicket(a.id);
    return t ? ticketView(t) : null;
  },
  'ticket.answer': (a) => answerTicket(a.id, a.answer, a.minutes),
  'ticket.cancel': (a) => cancelTicket(a.id),
  'ticket.accessible': (a) => accessibleAlternative(a.id, t('challenge.accessiblePhrase')),

  'pause.options': (a, s) => pauseOptions(a.url, a.groupId, a.incognito ?? s.tab?.incognito ?? null),
  'pause.start': (a, s) => startPause({ ...a, incognito: a.incognito ?? s.tab?.incognito ?? null }),
  'pause.cancel': (a) => cancelPause(a.grantId, a.all),

  'session.start': (a) => startSession(a),
  'session.extend': (a) => extendSession(a.id, a.minutes),
  'session.end': (a) => endSession(a.id),
  'budget.forfeit': (a) => forfeitBudget(a.groupId),

  'pending.confirm': (a) => confirmPending(a.id),
  'pending.cancel': (a) => cancelPending(a.id),
  'emergency.request': () => requestEmergency(),
  'emergency.cancel': () => cancelEmergency(),
  'emergency.start': () => startEmergency(),
  'password.change': (a) => changePassword(a.password),

  'later.add': async (a) => ({ item: await addLater(a.url, a.title, a.groupId) }),
  'later.remove': (a) => removeLater(a.ids),
  'later.list': () => listLater(),
  'later.open': async (a) => ({ opened: await openLater(a.ids) }),

  'tabs.close': (_a, s) => closeSenderTab(s),
  'tabs.reopenBlocked': async () => ({ reopened: await reopenBlockedTabs() }),
  'tabs.open': async (a) => {
    if (/^https?:\/\//i.test(a.url) || a.url.startsWith(extensionUrl('')))
      await quiet(api.tabs.create({ url: a.url }));
  },

  'tabs.reopen': (a, s) => reopenInTab(a.url, s),
  'stats.get': (a) => getStats(a.from, a.to),
  'stats.export': (a) => exportStats(a.format),
  'stats.delete': (a) => deleteStats(a.scope, a.from, a.to, a.host),

  'data.export': (a) => exportData(a.stats, a.secrets),
  'data.preview': (a) => previewImport(a.text, a.mode),
  'data.import': (a) => applyImport(a.text, a.mode),
  'backups.list': () => listBackups(),
  'backups.restore': (a) => restoreBackup(a.at),
  'data.reset': () => resetConfig(),
  'data.usage': () => storageUsage(),

  'diag.get': () => diagModel(),
  'diag.selftest': () => runSelftest(),
  'diag.report': async (a) => ({ text: await diagReport(a.includeUrls) }),
  'diag.clearLog': () => clearLog(),
  'permissions.changed': () => permissionsChanged(),
  'onboarding.done': async () => {
    const next = JSON.parse(JSON.stringify(store.config));
    next.settings.onboarded = true;
    await proposeConfig(next, 'onboarding');
  },

  'cs.tick': (a, s) => onTick(a, s),
  'cs.recheck': async (a, s) => {
    if (s.tab?.id === undefined) return;
    await enforceTab({ ...s.tab, url: a.url }, 'navigation');
  },
  'cs.graceDone': async (_a, s) => {
    if (s.tab?.id !== undefined) await finishGrace(s.tab.id);
  },
  'cs.selftestOk': () => undefined,
  'test.url': () => ({ allowlisted: null }),
};

const CONTENT_METHODS = new Set<Method>(['cs.tick', 'cs.recheck', 'cs.graceDone']);

/** Methods that change the configuration run one at a time, so concurrent saves never overwrite each other. */
const SERIALISED = new Set<Method>([
  'config.save',
  'config.addPage',
  'ticket.answer',
  'pending.confirm',
  'pending.cancel',
  'password.change',
  'data.import',
  'backups.restore',
  'data.reset',
  'onboarding.done',
  'emergency.start',
]);

export function onMessage(
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (r: unknown) => void,
): boolean {
  const env = msg as Envelope;
  if (env?.whb !== 1 || typeof env.method !== 'string') return false;
  if (sender.id !== api.runtime.id) return false;
  const handler = handlers[env.method] as Handler<Method> | undefined;
  if (!handler) {
    sendResponse({ ok: false, error: 'unknown method' });
    return false;
  }
  const fromExtension = (sender.url ?? '').startsWith(extensionUrl(''));
  if (!fromExtension && !CONTENT_METHODS.has(env.method)) {
    sendResponse({ ok: false, error: 'forbidden' });
    return false;
  }
  counters.messages++;
  (async () => {
    await store.ready();
    const run = () => handler(env.args ?? ({} as never), sender);
    return SERIALISED.has(env.method) ? store.mutate(run) : run();
  })().then(
    (value) => sendResponse({ ok: true, value }),
    (e) => {
      console.error('WebHandbrake', env.method, e);
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    },
  );
  return true;
}

export { reconcile };
