/** Intervention page model and passes. */

import { isStale, unitGroups } from '../engine/changes';
import { type Decision, decide, grantCovers, redirectPasses } from '../engine/decide';
import { ASK_WAIT_SECONDS, askChoices } from '../engine/defaults';
import { MAX_CUSTOM_CSS_CHARS, RECHECK_GRANT_MS, REDIRECT_PASS_MS, VISIT_RETURN_MS } from '../engine/limits';
import { isNav, NAV_SEVERITY, SEVERITY } from '../engine/severity';
import { dayKeyOf } from '../engine/time';
import type { Grant, Intervention } from '../engine/types';
import { displayHost, pageKey, parseUrl } from '../engine/url';
import { usageKeys } from '../engine/usage';
import { api, blockedUrlFrom, extensionUrl, INTERVENTION_PAGE, quiet } from '../platform/api';
import type { InterventionModel, PauseOptions } from '../shared/models';
import { onPrivate } from './bridge';
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
import { getTab, queryTabs, removeTab, updateTab } from './tabs';
import { createTicket, registerExecutor, type Step, showTicket } from './tickets';

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
    pending: null,
  };
}

/**
 * The changes that wait to be confirmed and change these rules, or these settings: until one is
 * confirmed, the page stays as it was, and the page says so. Null when there are none.
 */
function pendingOf(ruleIds: string[], settings: string[] = []): InterventionModel['pending'] {
  const config = store.config;
  const touched = new Set<string>();
  let readyAt = Number.POSITIVE_INFINITY;
  for (const p of store.state.pending) {
    if (p.expiresAt <= now()) continue;
    let hit = false;
    for (const u of p.units) {
      if (isStale(u, config)) continue;
      // A setting counts for every rule: only the settings named do here.
      if (u.kind === 'setting') hit ||= settings.includes(u.path);
      else
        for (const id of unitGroups(u, config).filter((x) => ruleIds.includes(x))) {
          touched.add(id);
          hit = true;
        }
    }
    if (hit) readyAt = Math.min(readyAt, p.readyAt);
  }
  if (readyAt === Number.POSITIVE_INFINITY) return null;
  return { rules: config.groups.filter((g) => touched.has(g.id)).map((g) => g.name), readyAt };
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
  const m = await modelOf(url, sender);
  // The tab shows this page now, and no longer any other: the background follows where a wait
  // that pauses or starts again when its page is left is shown.
  const i = m.decision?.intervention;
  m.ticket = await showTicket(
    sender.tab?.id,
    m.ticket,
    i?.type === 'delay' ? (i.onBlur ?? 'pause') : 'ignore',
  );
  return m;
}

async function modelOf(url: string, sender: chrome.runtime.MessageSender): Promise<InterventionModel> {
  await store.ready();
  const tab = sender.tab;
  // A redirect that brought the tab here may carry an access to this page: it is looked at first.
  if (tab?.id !== undefined) await redirects.get(tab.id);
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
      m.pending = pendingOf(
        guard.groups.map((g) => g.id),
        ['protection.internalPages'],
      );
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
  // A focus session blocks whatever its rules say; the rules on the page block until a change
  // that loosens them is confirmed.
  if (primary && !d.session && primary.source !== 'session')
    m.pending = pendingOf([primary.group.id, ...m.others.map((o) => o.id)]);

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
  // "Times you chose not to go in" counts the pages that offered a way in, except those that a
  // change of the rules put in place of a page already open: a block without a break leaves no
  // choice, and the tab of a site just blocked from the popup was no attempt to go in.
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
 * would still block the page, another break would not open it (nor does the one already running),
 * and the page says so instead.
 */
function breakOptions(d: Decision, url: string, incognito: boolean): PauseOptions {
  const opts = pauseOptions(url, undefined, incognito);
  const stays = d.groups.some((r) => !r.pausable && SEVERITY[r.intervention.type] >= SEVERITY.block);
  return stays && (opts.available || opts.reason === 'pause.unavailable.onBreak')
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
      choices: askChoices(i.maxMinutes),
      maxMinutes: i.maxMinutes,
      seconds: ASK_WAIT_SECONDS,
      minLength: i.minReasonLength,
    });
    mode = 'minutes';
  } else if (i.type === 'challenge') {
    if (i.kind === 'phrase' && i.phrase) steps.push({ type: 'phrase', phrase: i.phrase });
    else if (i.kind === 'math') steps.push({ type: 'math' });
    else steps.push({ type: 'text', length: i.length ?? 24 });
    scope = i.grant.scope;
    mode = i.grant.mode;
    minutes = i.grant.minutes;
  }
  // The pages that ask for the same access, as the rule is now, share one ticket and its wait:
  // opening the page again, or in several tabs, draws no new random wait and starts no increasing
  // one again from the same number of passes.
  const covered = scope === 'page' ? pageKey(url) : scope === 'site' ? primary.site : null;
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
      incognito,
    },
    steps,
    JSON.stringify([primary.group.id, i, covered]),
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

/** The redirects of each tab being looked at: the block page they lead to waits for them. */
const redirects = new Map<number, Promise<void>>();

/**
 * A redirect of the server in a tab going in from a block page: the accesses just given on the page
 * it comes from carry over to the page it sends to (a short link), which then does not ask again.
 * An address the person opens is no redirect: it asks as usual.
 */
export function followRedirect(tabId: number, from: string, to: string) {
  const run = (redirects.get(tabId) ?? Promise.resolve())
    .then(() => carryPasses(tabId, from, to))
    .catch(() => undefined);
  redirects.set(tabId, run);
  void run.then(() => {
    if (redirects.get(tabId) === run) redirects.delete(tabId);
  });
}

async function carryPasses(tabId: number, from: string, to: string) {
  await store.ready();
  const t0 = now();
  if (!store.state.grants.some((g) => g.kind === 'pass' && t0 - g.createdAt <= REDIRECT_PASS_MS)) return;
  const tab = await quiet(getTab(tabId));
  // The tab still shows the block page: no page was opened in it since.
  if (!tab || !blockedUrlFrom(tab.url)) return;
  const carried = redirectPasses(ctx(t0), from, to, { incognito: Boolean(tab.incognito) });
  if (!carried.length) return;
  store.state.grants.push(...carried);
  await store.saveState();
  await reconcile('redirect');
}

/** Listens to the redirects of the servers, in the private windows too. */
export function registerRedirectListener() {
  const event = api.webRequest?.onBeforeRedirect;
  if (!event) return;
  const onRedirect = (d: { tabId: number; url: string; redirectUrl: string }) => {
    if (d.tabId >= 0 && /^https?:/i.test(d.redirectUrl)) followRedirect(d.tabId, d.url, d.redirectUrl);
  };
  try {
    event.addListener(onRedirect, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });
  } catch {
    // webRequest unavailable: a short link asks again on the page it sends to.
    return;
  }
  onPrivate('webRequest.onBeforeRedirect', onRedirect);
}

/**
 * An access given for the visit ends as soon as no tab shows what it covers: closing
 * the last tab of the site ends the visit, so opening the site again restricts it
 * again (#19). A tab that leaves it for another page has VISIT_RETURN_MS to come back, as a
 * sign-in on another site does (Sign in with Google, then back to the site); closing that tab
 * ends it at once. A tab left open still ends it after the visit gap. A tab on the
 * intervention page counts as showing its address: it is where the access was just given.
 */
export async function endLeftVisits(tab: { closed?: number; navigated?: number } = {}) {
  await store.ready();
  const visits = store.state.grants.filter((g) => g.kind === 'pass' && g.visit);
  if (!visits.length) return;
  const tabs = (await quiet(queryTabs({}))) ?? [];
  const c = ctx();
  const shown = new Set<Grant>();
  for (const t of tabs) {
    if (t.id === tab.closed || !t.url) continue;
    const d = decide(c, blockedUrlFrom(t.url) ?? t.url, { incognito: Boolean(t.incognito) });
    const parsed = d.parsed;
    if (!parsed) continue;
    for (const g of visits) if (d.groups.some((r) => grantCovers(g, r.group, r.site, parsed))) shown.add(g);
  }
  let changed = false;
  const ended: Grant[] = [];
  for (const g of visits) {
    if (shown.has(g)) {
      // Back in time: the visit goes on.
      if (g.leftAt === undefined) continue;
      delete g.leftAt;
      delete g.leftTab;
      changed = true;
    } else if (g.leftAt === undefined && tab.navigated !== undefined) {
      g.leftAt = c.now;
      g.leftTab = tab.navigated;
      changed = true;
    } else if (g.leftAt === undefined || g.leftTab === tab.closed || c.now >= g.leftAt + VISIT_RETURN_MS) {
      ended.push(g);
    }
  }
  if (!changed && !ended.length) return;
  store.state.grants = store.state.grants.filter((g) => !ended.includes(g));
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
  if (sender.tab?.id !== undefined) await quiet(removeTab(sender.tab.id));
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
    await updateTab(tabId, { url });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
