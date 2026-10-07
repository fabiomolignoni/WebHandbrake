/** Intervention page model and passes (INT-01…INT-07, INT-12, INT-14, STA-03). */

import { isNav, PASSABLE, SEVERITY } from '../engine/decide';
import { MAX_CUSTOM_CSS_CHARS, RECHECK_GRANT_MS } from '../engine/limits';
import { dayKeyOf } from '../engine/time';
import type { Grant, Intervention } from '../engine/types';
import { displayHost, pageKey, parseUrl } from '../engine/url';
import { api, extensionUrl, INTERVENTION_PAGE, quiet } from '../platform/api';
import type { InterventionModel } from '../shared/models';
import { now } from './clock';
import { randomInt } from './crypto';
import { logDecision } from './diagnostics-state';
import { removeSelftestRule, SELFTEST_HOST, syncRules } from './dnr-sync';
import { internalPagesBlocked, interventionTabs, isProtectedInternal } from './enforce';
import { ctx, decideUrl, decisionView } from './engine';
import { pauseOptions } from './pauses';
import { reconcile } from './reconcile';
import { countSessionStop } from './sessions';
import { store } from './store';
import { createTicket, registerExecutor, type Step } from './tickets';

const shownRecently = new Map<string, number>();

function base(url: string, kind: InterventionModel['kind']): InterventionModel {
  const s = store.config.settings;
  return {
    url,
    host: displayHost(url),
    kind,
    decision: null,
    group: null,
    until: null,
    ticket: null,
    pause: null,
    alternatives: s.interventions.alternatives,
    hideUrl: s.interventions.hideUrl,
    customCss: sanitizeCss(s.interventions.customCss),
    redirectUrl: null,
    hour12: s.hour12,
    locked: false,
    canSaveLater: /^https?:/i.test(url),
  };
}

/** SEC-02: custom CSS may not load anything (no url(), no @import). */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/<\/?style[^>]*>/gi, '')
    .slice(0, MAX_CUSTOM_CSS_CHARS);
}

function fillPlaceholders(template: string, url: string, group: string, until: number | null): string {
  return template
    .replace(/\{url\}/g, encodeURIComponent(url))
    .replace(/\{group\}/g, encodeURIComponent(group))
    .replace(/\{until\}/g, until ? new Date(until).toISOString() : '');
}

/** Today's passes of a group, for increasing delays (INT-02 e). */
function passesToday(groupId: string): number {
  return store.usage.counterSum(`proceeded:${groupId}`, [dayKeyOf(now(), store.cc.cal)]);
}

export async function interventionModel(
  url: string,
  sender: chrome.runtime.MessageSender,
): Promise<InterventionModel> {
  await store.ready();
  const tab = sender.tab;
  const incognito = Boolean(tab?.incognito);
  const parsed = parseUrl(url);

  if (parsed?.host === SELFTEST_HOST) {
    store.meta.selftest = { at: Date.now(), ok: true };
    await store.saveMeta();
    await quiet(removeSelftestRule());
    return base(url, 'selftest');
  }
  if (isProtectedInternal(url)) {
    const m = base(url, internalPagesBlocked() ? 'internal' : 'allow');
    m.canSaveLater = false;
    return m;
  }

  const c = ctx();
  const d = decideUrl(url, incognito, c.now);
  if (!isNav(d)) {
    // The rules were stale or broader than the engine: let the page through (ENF-09).
    const t0 = now();
    store.state.grants.push({
      id: crypto.randomUUID(),
      kind: 'recheck',
      groups: [],
      scope: 'page',
      url: pageKey(url),
      createdAt: t0,
      until: t0 + RECHECK_GRANT_MS,
      severity: 0,
    });
    await store.saveState();
    await syncRules();
    return base(url, 'allow');
  }

  const view = decisionView(d, { incognito }, c);
  const m = base(url, 'block');
  m.decision = view;
  m.until = view.until;
  const primary = d.primary;
  if (primary) {
    const g = primary.group;
    m.group = { id: g.id, name: g.name, color: g.color, note: g.note, message: g.message };
  }

  // STA-03: interventions shown (deduplicated per tab and URL for a minute).
  const key = `${tab?.id ?? ''}|${url}`;
  const last = shownRecently.get(key) ?? 0;
  if (c.now - last > 60_000) {
    for (const [k, at] of shownRecently) if (c.now - at > 60_000) shownRecently.delete(k);
    shownRecently.set(key, c.now);
    const gid = primary?.group.id ?? 'session';
    store.usage.count(`shown:${gid}`, c.now, store.cc.cal);
    // DIA-01: most restrictions are applied by the browser filters, then shown here.
    void logDecision(
      store.config.settings.diagnostics.decisionLog,
      'page',
      url,
      d.intervention.type,
      primary?.group.name,
    );
    store.scheduleUsage();
    if (d.session) countSessionStop(d.session.id);
    else if (primary?.session) countSessionStop(primary.session.id);
  }
  if (tab?.id !== undefined) {
    interventionTabs.set(tab.id, { url, groupId: primary?.group.id ?? null, proceeded: false });
  }

  if (d.session) {
    m.kind = 'session';
    m.locked = d.session.locked;
    return m;
  }
  const i: Intervention = d.intervention;
  if (primary?.source === 'session') {
    m.kind = 'session';
    m.locked = Boolean(primary.session?.locked);
  } else if (primary?.source === 'cooldown') {
    m.kind = 'cooldown';
  } else {
    switch (i.type) {
      case 'close':
        m.kind = 'close';
        break;
      case 'redirect': {
        const target = fillPlaceholders(i.url, url, primary?.group.name ?? '', view.until);
        if (/^https?:\/\//i.test(target)) {
          m.kind = 'redirect';
          m.redirectUrl = target;
        } else m.kind = 'block';
        break;
      }
      case 'delay':
      case 'ask':
      case 'challenge':
        m.kind = i.type;
        m.ticket = await passTicket(url, i, incognito);
        break;
      default:
        m.kind = 'block';
    }
  }
  if (primary?.pausable) m.pause = pauseOptions(url, undefined, incognito);
  return m;
}

async function passTicket(url: string, i: Intervention, incognito: boolean) {
  const d = decideUrl(url, incognito);
  const primary = d.primary;
  if (!primary) return null;
  const severity = SEVERITY[i.type];
  const groups = d.groups
    .filter(
      (r) => r.source === 'policy' && PASSABLE.includes(r.base.type) && SEVERITY[r.base.type] <= severity,
    )
    .map((r) => r.group.id);
  const steps: Step[] = [];
  let scope: 'page' | 'site' | 'group' = 'site';
  let mode: 'visit' | 'minutes' = 'visit';
  let minutes: number | undefined;
  let cooldownMinutes: number | undefined;
  if (i.type === 'delay') {
    let s = i.seconds;
    if (i.randomTo && i.randomTo > s) s = randomInt(s, i.randomTo);
    if (i.increase) s += i.increase * passesToday(primary.group.id);
    steps.push({ type: 'wait', seconds: s });
    scope = i.grant.scope;
    mode = i.grant.mode;
    minutes = i.grant.minutes;
  } else if (i.type === 'ask') {
    steps.push({
      type: 'intention',
      choices: i.choices,
      maxMinutes: i.maxMinutes,
      requireIntention: Boolean(i.requireIntention),
      seconds: i.seconds ?? 0,
    });
    mode = 'minutes';
    cooldownMinutes = i.cooldownMinutes;
  } else if (i.type === 'challenge') {
    if (i.kind === 'phrase' && i.phrase) steps.push({ type: 'phrase', phrase: i.phrase });
    else if (i.kind === 'math') steps.push({ type: 'math' });
    else steps.push({ type: 'text', length: i.length ?? 24, charset: i.charset });
    scope = i.grant.scope;
    mode = i.grant.mode;
    minutes = i.grant.minutes;
  }
  const { view } = await createTicket(
    {
      kind: 'pass',
      url,
      groups,
      severity,
      scope,
      mode,
      minutes,
      site: primary.site,
      cooldownMinutes,
      incognito,
    },
    steps,
  );
  return view;
}

registerExecutor('pass', async (ticket) => {
  if (ticket.purpose.kind !== 'pass') return;
  const p = ticket.purpose;
  const t0 = now();
  const minutes = ticket.collected.minutes ?? p.minutes;
  const grant: Grant = {
    id: crypto.randomUUID(),
    kind: 'pass',
    groups: p.groups,
    scope: p.scope,
    url: p.scope === 'page' ? pageKey(p.url) : undefined,
    site: p.site,
    createdAt: t0,
    severity: p.severity,
    intention: ticket.collected.intention,
    cooldownMinutes: p.cooldownMinutes,
  };
  if (p.mode === 'minutes' && minutes) grant.until = t0 + minutes * 60_000;
  else grant.visit = true;
  store.state.grants.push(grant);
  for (const gid of p.groups.slice(0, 1)) store.usage.count(`proceeded:${gid}`, t0, store.cc.cal);
  if (ticket.collected.intention && p.groups[0]) {
    store.intentions.push({
      at: t0,
      groupId: p.groups[0],
      text: ticket.collected.intention,
      minutes: minutes ?? 0,
    });
    await store.saveIntentions();
  }
  for (const [tabId, info] of interventionTabs)
    if (info.url === p.url) interventionTabs.set(tabId, { ...info, proceeded: true });
  store.scheduleUsage();
  await store.saveState();
  await reconcile('pass');
  return { url: p.url };
});

export async function interventionLeft(url: string, how: string, sender: chrome.runtime.MessageSender) {
  await store.ready();
  const tabId = sender.tab?.id;
  const info = tabId !== undefined ? interventionTabs.get(tabId) : undefined;
  if (info && !info.proceeded && info.groupId) {
    store.usage.count(`left:${info.groupId}`, now(), store.cc.cal);
    store.scheduleUsage();
    interventionTabs.set(tabId!, { ...info, proceeded: true });
  }
  void how;
  void url;
}

export async function closeSenderTab(sender: chrome.runtime.MessageSender) {
  if (sender.tab?.id !== undefined) await quiet(api.tabs.remove(sender.tab.id));
}

/**
 * Reopens a blocked URL in the intervention page's own tab once it is allowed. Needed for local
 * files and browser pages, which an extension page cannot open itself. Never javascript: or data:.
 */
export async function reopenInTab(
  url: string,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean }> {
  await store.ready();
  const tabId = sender.tab?.id;
  if (tabId === undefined || !(sender.url ?? '').startsWith(extensionUrl(INTERVENTION_PAGE)))
    return { ok: false };
  if (!/^(https?|file|about|chrome|edge|brave|vivaldi|opera):/i.test(url)) return { ok: false };
  const allowed = isProtectedInternal(url)
    ? !internalPagesBlocked()
    : !isNav(decideUrl(url, Boolean(sender.tab?.incognito)));
  if (!allowed) return { ok: false };
  try {
    await api.tabs.update(tabId, { url });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
