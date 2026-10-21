/** Intervention page model and passes. */

import { type Decision, decide, grantCovers } from '../engine/decide';
import { MAX_CUSTOM_CSS_CHARS, RECHECK_GRANT_MS } from '../engine/limits';
import { isNav, NAV_SEVERITY, SEVERITY } from '../engine/severity';
import { dayKeyOf } from '../engine/time';
import type { Grant, Intervention } from '../engine/types';
import { displayHost, pageKey, parseUrl } from '../engine/url';
import { usageKeys } from '../engine/usage';
import { api, blockedUrlFrom, extensionUrl, INTERVENTION_PAGE, quiet } from '../platform/api';
import type { InterventionModel, PauseOptions } from '../shared/models';
import { now } from './clock';
import { randomInt } from './crypto';
import { logDecision } from './diagnostics-state';
import { removeSelftestRule, SELFTEST_HOST, syncRules } from './dnr-sync';
import {
  internalGuard,
  internalGuardUntil,
  internalPagesBlocked,
  interventionTabs,
  isProtectedInternal,
  replacedTabs,
} from './enforce';
import { ctx, decideUrl, decisionView, groupProtection } from './engine';
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
    hideUrl: s.interventions.hideUrl,
    customCss: sanitizeCss(s.interventions.customCss),
    redirectUrl: null,
    others: [],
    hour12: s.hour12,
    locked: false,
    canSaveLater: /^https?:/i.test(url),
    internal: null,
  };
}

/** What can make CSS load something: @import and the functions that take an address. */
const LOADS = /@import|url\s*\(|src\s*\(|image-set\s*\(|\bimage\s*\(|expression\s*\(/i;

/** CSS with its escapes decoded: "\75 rl(" is url(. */
function unescapeCss(css: string): string {
  return css.replace(/\\(?:([0-9a-f]{1,6})\s?|([^\n0-9a-f]))/gi, (_, hex?: string, ch?: string) =>
    hex ? String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff) || 0xfffd) : (ch ?? ''),
  );
}

/**
 * Custom CSS may not load anything (no @import, url(), src(), image-set()…). Escapes could spell
 * them out of sight of the checks, so CSS that hides one that way is read unescaped. The page's
 * content security policy blocks loads too; this keeps the CSS from even trying.
 */
export function sanitizeCss(css: string): string {
  const plain = css.includes('\\') && LOADS.test(unescapeCss(css)) ? unescapeCss(css) : css;
  return plain
    .replace(/@import[^;]*;?/gi, '')
    .replace(/(?:-webkit-)?image-set\s*\([^)]*\)/gi, 'none')
    .replace(/\b(?:url|src|image)\s*\([^)]*\)/gi, 'none')
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

/** Today's passes of a group, for increasing delays. */
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
    const c = ctx();
    const guard = internalGuard(c);
    const m = base(url, guard ? 'internal' : 'allow');
    m.canSaveLater = false;
    if (guard) {
      m.internal = {
        always: guard.always,
        rules: guard.groups.map((g) => ({
          id: g.id,
          name: g.name,
          color: g.color,
          protection: groupProtection(g, c.now),
        })),
        session: guard.session,
      };
      m.until = internalGuardUntil(c);
    }
    return m;
  }

  const c = ctx();
  const d = decideUrl(url, incognito, c.now);
  if (!isNav(d)) {
    // The rules were stale or broader than the engine: let the page through.
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
  // The other rules that restrict the page too; each one shows once this one lets it through.
  m.others = primary
    ? d.groups
        .filter((r) => r !== primary && SEVERITY[r.intervention.type] >= NAV_SEVERITY)
        .map((r) => ({ id: r.group.id, name: r.group.name, color: r.group.color }))
    : [];

  // Interventions shown (deduplicated per tab, URL and rule for a minute).
  const gid = primary?.group.id ?? 'session';
  const key = `${tab?.id ?? ''}|${url}|${gid}`;
  const last = shownRecently.get(key) ?? 0;
  const fresh = c.now - last > 60_000;
  if (fresh) {
    for (const [k, at] of shownRecently) if (c.now - at > 60_000) shownRecently.delete(k);
    shownRecently.set(key, c.now);
    store.usage.count(`shown:${gid}`, c.now, store.cc.cal);
    // Most restrictions are applied by the browser filters, then shown here.
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
  const tabInfo = { url, groupId: primary?.group.id ?? null, proceeded: false, offered: false };
  if (tab?.id !== undefined) interventionTabs.set(tab.id, tabInfo);

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
  if (primary?.pausable) m.pause = breakOptions(d, url, incognito);
  // "Times you chose not to go in" counts the pages that offered a way in and that were opened:
  // a block without a break, or a page put in place of one already open, leaves no choice.
  const replaced = tab?.id !== undefined && replacedTabs.get(tab.id) === url;
  tabInfo.offered = (Boolean(m.ticket) || Boolean(m.pause?.available)) && !replaced;
  if (fresh && tabInfo.offered) {
    store.usage.count(`offered:${gid}`, c.now, store.cc.cal);
    store.scheduleUsage();
  }
  return m;
}

/**
 * The break offered on the page. A break lifts only the rules that allow one: when another rule
 * would still block the page, it would not open it, and the page says so instead.
 */
function breakOptions(d: Decision, url: string, incognito: boolean): PauseOptions {
  const opts = pauseOptions(url, undefined, incognito);
  const stays = d.groups.some((r) => !r.pausable && SEVERITY[r.intervention.type] >= SEVERITY.block);
  return stays && opts.available
    ? { ...opts, available: false, reason: 'pause.unavailable.otherRule' }
    : opts;
}

async function passTicket(url: string, i: Intervention, incognito: boolean) {
  const d = decideUrl(url, incognito);
  const primary = d.primary;
  if (!primary) return null;
  const severity = SEVERITY[i.type];
  // The access opens only this rule. Every other rule on the page asks its own question
  // next, the strictest first: the page opens once each of them has let it through.
  const groups = [primary.group.id];
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
    from: pageKey(p.url),
    site: p.site,
    createdAt: t0,
    severity: p.severity,
    intention: ticket.collected.intention,
    cooldownMinutes: p.cooldownMinutes,
  };
  if (p.mode === 'minutes' && minutes) {
    grant.until = t0 + minutes * 60_000;
    grant.minutes = minutes;
  } else grant.visit = true;
  store.state.grants.push(grant);
  restartUnusedAccesses(grant, p.url, p.incognito, t0);
  if (p.groups[0]) store.usage.count(`proceeded:${p.groups[0]}`, t0, store.cc.cal);
  if (ticket.collected.intention && p.groups[0]) {
    store.intentions.push({
      at: t0,
      groupId: p.groups[0],
      text: ticket.collected.intention,
      minutes: minutes ?? 0,
    });
    await store.saveIntentions();
  }
  let took = false;
  for (const [tabId, info] of interventionTabs)
    if (info.url === p.url) {
      took ||= info.offered && !info.proceeded;
      interventionTabs.set(tabId, { ...info, proceeded: true });
    }
  if (took && p.groups[0]) store.usage.count(`took:${p.groups[0]}`, t0, store.cc.cal);
  store.scheduleUsage();
  await store.saveState();
  await reconcile('pass');
  return { url: p.url };
});

/**
 * When this access opens the page, the accesses given on this page for its other rules
 * start now, so that the time spent on the questions and waits of the rules after them is not
 * taken from them. Only an access not used yet (no time counted on its rule since it was given)
 * starts again: it opens nothing more than it was given for.
 */
function restartUnusedAccesses(grant: Grant, url: string, incognito: boolean, t0: number) {
  const d = decide(ctx(t0), url, { incognito });
  if (isNav(d)) return;
  for (const r of d.groups) {
    const g = r.pass;
    if (!g || g === grant || g.from !== grant.from) continue;
    const used = store.state.activity[usageKeys.group(r.group.id)]?.last ?? 0;
    if (used > g.createdAt) continue;
    if (g.until !== undefined && g.minutes) g.until = t0 + g.minutes * 60_000;
    g.createdAt = t0;
  }
}

/**
 * An access given for the visit ends as soon as no tab shows what it covers: closing
 * the last tab of the site, or leaving it, ends the visit, so opening the site again restricts it
 * again (#19). A tab left open still ends it after the visit gap. A tab on the
 * intervention page counts as showing its address: it is where the access was just given.
 */
export async function endLeftVisits(closedTabId?: number) {
  await store.ready();
  const visits = store.state.grants.filter((g) => g.kind === 'pass' && g.visit);
  if (!visits.length) return;
  const tabs = (await quiet(api.tabs.query({}))) ?? [];
  const c = ctx();
  const shown = new Set<Grant>();
  for (const tab of tabs) {
    if (tab.id === closedTabId || !tab.url) continue;
    const d = decide(c, blockedUrlFrom(tab.url) ?? tab.url, { incognito: Boolean(tab.incognito) });
    const parsed = d.parsed;
    if (!parsed) continue;
    for (const g of visits) if (d.groups.some((r) => grantCovers(g, r.group, r.site, parsed))) shown.add(g);
  }
  const left = visits.filter((g) => !shown.has(g));
  if (!left.length) return;
  store.state.grants = store.state.grants.filter((g) => !left.includes(g));
  await store.saveState();
  await reconcile('visit-left');
}

/** The person left an intervention page without going in: an impulse resisted, counted once per page. */
export async function interventionLeft(sender: chrome.runtime.MessageSender) {
  await store.ready();
  const tabId = sender.tab?.id;
  const info = tabId !== undefined ? interventionTabs.get(tabId) : undefined;
  if (info && !info.proceeded && info.groupId) {
    store.usage.count(`left:${info.groupId}`, now(), store.cc.cal);
    store.scheduleUsage();
    interventionTabs.set(tabId!, { ...info, proceeded: true });
  }
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
