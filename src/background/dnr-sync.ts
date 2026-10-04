/** Installs the compiled declarativeNetRequest rules, idempotently (REL-01, ENF-08, REL-04). */

import { compileDnr, type DnrRuleData } from '../engine/dnr';
import { api, extensionUrl, INTERVENTION_PAGE } from '../platform/api';
import { counters } from './diagnostics-state';
import { ctx } from './engine';

export const SELFTEST_RULE_ID = 999_999;
export const SELFTEST_HOST = 'selftest.webhandbrake.invalid';

export const dnrStatus = {
  installed: 0,
  regex: 0,
  redirects: 0,
  overflow: [] as string[],
  lastError: null as string | null,
  lastCompileMs: 0,
  hostAccess: true,
};

let lastSignature = '';
const regexSupport = new Map<string, boolean>();

export function dnrLimits() {
  const d = api.declarativeNetRequest as unknown as Record<string, number | undefined>;
  return {
    regex: d.MAX_NUMBER_OF_REGEX_RULES ?? 1000,
    unsafe: d.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES ?? 5000,
    total: d.MAX_NUMBER_OF_DYNAMIC_RULES ?? d.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES ?? 5000,
  };
}

export async function checkHostAccess(): Promise<boolean> {
  try {
    const all = await api.permissions.contains({ origins: ['<all_urls>'] });
    if (all) return true;
    return await api.permissions.contains({ origins: ['*://*/*'] });
  } catch {
    return true;
  }
}

async function regexSupported(regex: string): Promise<boolean> {
  const cached = regexSupport.get(regex);
  if (cached !== undefined) return cached;
  let ok = true;
  try {
    const fn = api.declarativeNetRequest.isRegexSupported as unknown as
      | ((o: { regex: string; isCaseSensitive?: boolean }) => Promise<{ isSupported: boolean }>)
      | undefined;
    if (fn) ok = (await fn.call(api.declarativeNetRequest, { regex, isCaseSensitive: false })).isSupported;
  } catch {
    ok = true;
  }
  regexSupport.set(regex, ok);
  return ok;
}

export async function syncRules(force = false): Promise<void> {
  const started = Date.now();
  dnrStatus.hostAccess = await checkHostAccess();
  const result = compileDnr(ctx(), {
    interventionUrl: extensionUrl(INTERVENTION_PAGE),
    hostAccess: dnrStatus.hostAccess,
    limits: dnrLimits(),
  });
  const rules: DnrRuleData[] = [];
  const overflow = [...result.overflow];
  for (const r of result.rules) {
    if (
      r.condition.regexFilter &&
      r.condition.regexFilter !== '^(.*)$' &&
      !(await regexSupported(r.condition.regexFilter))
    ) {
      overflow.push(r.condition.regexFilter);
      continue;
    }
    rules.push(r);
  }
  const withIds = rules.map((r, i) => ({ id: i + 1, ...r }) as chrome.declarativeNetRequest.Rule);
  const signature = JSON.stringify(withIds);
  dnrStatus.lastCompileMs = Date.now() - started;
  dnrStatus.overflow = overflow;
  dnrStatus.regex = rules.filter((r) => r.condition.regexFilter).length;
  dnrStatus.redirects = rules.filter((r) => r.action.type === 'redirect').length;
  counters.compiles++;

  const existing = await api.declarativeNetRequest.getDynamicRules();
  const ours = existing.filter((r) => r.id !== SELFTEST_RULE_ID);
  if (!force && signature === lastSignature && ours.length === withIds.length) return;
  try {
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ours.map((r) => r.id),
      addRules: withIds,
    });
    lastSignature = signature;
    dnrStatus.installed = withIds.length;
    dnrStatus.lastError = null;
  } catch (e) {
    dnrStatus.lastError = e instanceof Error ? e.message : String(e);
    // Fall back to the rules that cannot fail (plain domains), so blocking keeps working.
    const safe = withIds.filter((r) => !r.condition.regexFilter || r.condition.regexFilter === '^(.*)$');
    try {
      const again = await api.declarativeNetRequest.getDynamicRules();
      await api.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: again.filter((r) => r.id !== SELFTEST_RULE_ID).map((r) => r.id),
        addRules: safe,
      });
      dnrStatus.installed = safe.length;
      lastSignature = '';
    } catch (e2) {
      dnrStatus.lastError = `${dnrStatus.lastError}; ${e2 instanceof Error ? e2.message : String(e2)}`;
    }
  }
}

/** DIA-03: a rule redirecting a reserved test host to the intervention page. */
export async function installSelftestRule() {
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [SELFTEST_RULE_ID],
    addRules: [
      {
        id: SELFTEST_RULE_ID,
        priority: 1,
        action: {
          type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
          redirect: { regexSubstitution: `${extensionUrl(INTERVENTION_PAGE)}#\\1` },
        },
        condition: {
          regexFilter: '^(.*)$',
          requestDomains: [SELFTEST_HOST],
          resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
        },
      },
    ],
  });
}

export async function removeSelftestRule() {
  await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [SELFTEST_RULE_ID] });
}
