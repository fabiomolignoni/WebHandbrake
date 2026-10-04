/** Diagnostics page model, redacted report and self-test (DIA-01…DIA-03). */

import { api, browserName, quiet } from '../platform/api';
import type { DiagModel } from '../shared/models';
import { clearLog, counters, getLog } from './diagnostics-state';
import { dnrLimits, dnrStatus, installSelftestRule, SELFTEST_HOST } from './dnr-sync';
import { notificationsAllowed } from './notifications';
import { store } from './store';

export async function diagModel(): Promise<DiagModel> {
  await store.ready();
  const rules = (await quiet(api.declarativeNetRequest.getDynamicRules())) ?? [];
  let incognito = false;
  try {
    incognito = await api.extension.isAllowedIncognitoAccess();
  } catch {
    incognito = false;
  }
  let bytes: number | null = null;
  try {
    bytes = await api.storage.local.getBytesInUse(null);
  } catch {
    bytes = null;
  }
  return {
    version: api.runtime.getManifest().version,
    browser: browserName(),
    rules: {
      dynamic: rules.length,
      regex: rules.filter((r) => r.condition.regexFilter).length,
      redirects: rules.filter((r) => r.action.type === 'redirect').length,
      limits: dnrLimits(),
      overflow: dnrStatus.overflow,
      lastError: dnrStatus.lastError,
      lastCompileMs: dnrStatus.lastCompileMs,
    },
    permissions: { hostAccess: dnrStatus.hostAccess, incognito, notifications: await notificationsAllowed() },
    log: store.config.settings.diagnostics.decisionLog ? await getLog() : [],
    counters: { ...counters },
    storageBytes: bytes,
    tamper: store.state.tamper.slice(-50).reverse(),
    invalidTargets: store.cc.invalid.map((t) => t.value),
  };
}

/** DIA-02: a report without URLs unless the user asks for them. */
export async function diagReport(includeUrls: boolean): Promise<string> {
  const m = await diagModel();
  const redact = (url: string) => {
    if (includeUrls) return url;
    try {
      const u = new URL(url);
      return `${u.protocol}//…`;
    } catch {
      return '…';
    }
  };
  const cfg = store.config;
  const lines = [
    `WebHandbrake ${m.version} on ${m.browser}`,
    `User agent: ${navigator.userAgent}`,
    `Groups: ${cfg.groups.length} (${cfg.groups.filter((g) => g.enabled && !g.archived).length} active), targets: ${cfg.groups.reduce((n, g) => n + g.targets.length, 0)}, lists: ${cfg.lists.length}, allowlist: ${cfg.allowlist.length}`,
    `Protection: ${cfg.settings.protection.level}, password: ${cfg.settings.protection.access.passwordHash ? 'yes' : 'no'}`,
    `Rules: ${m.rules.dynamic} dynamic, ${m.rules.regex} regex, ${m.rules.redirects} redirects; limits ${JSON.stringify(m.rules.limits)}`,
    `Rules overflow: ${m.rules.overflow.length}; last error: ${m.rules.lastError ?? 'none'}; compile ${m.rules.lastCompileMs} ms`,
    `Permissions: host access ${m.permissions.hostAccess}, private windows ${m.permissions.incognito}, notifications ${m.permissions.notifications}`,
    `Counters: ${JSON.stringify(m.counters)}`,
    `Storage: ${m.storageBytes ?? 'n/a'} bytes`,
    `Self-test: ${store.meta.selftest ? `${store.meta.selftest.ok ? 'ok' : 'failed'} at ${new Date(store.meta.selftest.at).toISOString()}` : 'never run'}`,
    `Tamper events: ${m.tamper.map((e) => `${new Date(e.at).toISOString()} ${e.kind}`).join('; ') || 'none'}`,
    `Invalid targets: ${m.invalidTargets.length}`,
    '',
    'Recent decisions:',
    ...m.log
      .slice(-50)
      .map((e) => `${new Date(e.at).toISOString()} ${e.where} ${e.intervention} ${redact(e.url)}`),
  ];
  return lines.join('\n');
}

export async function runSelftest() {
  await store.ready();
  store.meta.selftest = { at: Date.now(), ok: false };
  await store.saveMeta();
  await installSelftestRule();
  await quiet(api.tabs.create({ url: `http://${SELFTEST_HOST}/`, active: true }));
  return { started: true };
}

export { clearLog };
