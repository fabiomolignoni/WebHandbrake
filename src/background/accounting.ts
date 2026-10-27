/**
 * Time accounting.
 *
 * Content scripts send a tick about once per second only while the page is visible, focused
 * (or playing media when that is counted) and the user is not idle. Credits are computed per
 * usage key from the time since the previous credit of the same key, so a group never gets more
 * than one second per real second whatever the number of tabs, and gaps (sleep, locked
 * screen, clock jumps) are never counted. The pages where no content script runs, and the tabs not
 * in view with Count tabs that are open but not active, are counted by the background in stretches
 * (tabtime.ts), with the same credits.
 */

import { type Decision, decide, pageFilters } from '../engine/decide';
import { BRAND_COLOR } from '../engine/defaults';
import { nextRestriction } from '../engine/next';
import { isNav, SEVERITY } from '../engine/severity';
import type { Activity } from '../engine/types';
import { stripWww } from '../engine/url';
import { usageKeys } from '../engine/usage';
import { formatLocale, locale, template, textDirection, t as tr } from '../i18n/i18n';
import { api, sessionStore } from '../platform/api';
import type { TickResponse } from '../shared/models';
import type { TickRequest } from '../shared/rpc';
import { updateBadge } from './badge';
import { now } from './clock';
import { counters } from './diagnostics-state';
import { leavingState } from './enforce';
import { ctx } from './engine';
import { notify } from './notifications';
import { reconcile } from './reconcile';
import { store } from './store';

const MAX_STEP_MS = 2500;
const lastCredit = new Map<string, number>();
const hostLastActive = new Map<string, number>();
const warned = new Set<string>();
let idleState: 'active' | 'idle' | 'locked' = 'active';

export function setIdleState(s: 'active' | 'idle' | 'locked') {
  idleState = s;
}

export function initIdle() {
  if (!api.idle?.onStateChanged) return;
  try {
    api.idle.setDetectionInterval(Math.max(15, store.config.settings.tracking.idleSeconds));
  } catch {
    // Firefox for Android may reject the call: page level idle detection still works.
  }
}

/**
 * Seconds to credit to a key at t. A stretch counted by the background (`from`) gets its time,
 * without what ticks already credited to the key meanwhile.
 */
function creditSeconds(key: string, t: number, from?: number): number {
  const last = lastCredit.get(key);
  lastCredit.set(key, t);
  if (from !== undefined) return Math.max(0, t - Math.max(from, last ?? from)) / 1000;
  if (last === undefined) return 1;
  const dt = t - last;
  if (dt <= 0) return 0;
  return dt > MAX_STEP_MS ? 1 : dt / 1000;
}

/** Records activity on a key, from `from` to t; true when it starts a visit. */
function updateActivity(key: string, t: number, gapMs: number, from = t): boolean {
  const act: Activity | undefined = store.state.activity[key];
  store.state.activity[key] = { last: t };
  return !act || from - act.last > gapMs;
}

/** Credits the time of a page up to t: since the previous credit, or since `from` (a stretch). */
function credit(d: Decision, incognito: boolean, t: number, from?: number) {
  const s = store.config.settings;
  const cal = store.cc.cal;
  const gap = s.tracking.visitGapMinutes * 60_000;
  const parsed = d.parsed;

  // A rule whose condition allows its sites without counting gets no time. The time outside the
  // rules (Track time on all sites) has a total of its own.
  const counted = d.groups.filter((r) => r.intervention.type !== 'allow');
  const outside = !counted.length && Boolean(parsed?.web) && s.tracking.allSites;
  const totalKey = outside ? usageKeys.outside : usageKeys.all;
  const any = counted.length || outside ? creditSeconds(totalKey, t, from) : 0;
  if (any > 0) store.usage.add(totalKey, t, any, 0, cal, !outside);
  for (const r of counted) {
    const gk = usageKeys.group(r.group.id);
    const sk = usageKeys.site(r.group.id, r.site);
    for (const key of [gk, sk]) {
      const sec = creditSeconds(key, t, from);
      if (sec <= 0) continue;
      const visit = updateActivity(key, t, gap, from);
      store.usage.add(key, t, sec, visit ? 1 : 0, cal);
    }
  }
  // By site: each second of a total goes to the site whose page counted it, so that the sites add
  // up to the totals whatever the number of tabs. Private windows keep no sites: their time goes to
  // one total, with the visits found per site in memory only. Budgets above are consumed either way.
  if (any > 0) {
    // A page that is not a website has no site.
    const host = parsed?.web ? stripWww(parsed.host) : '';
    const seen = incognito ? `private:${host}` : host;
    const last = hostLastActive.get(seen) ?? 0;
    hostLastActive.set(seen, t);
    const key = incognito ? usageKeys.private : usageKeys.host(host);
    store.usage.add(key, t, any, (from ?? t) - last > gap ? 1 : 0, cal, false);
  }
  store.scheduleUsage();
  store.scheduleState();
}

const FILTERS: Record<string, (i: number) => string> = {
  grayscale: (i) => `grayscale(${i}%)`,
  blur: (i) => `blur(${Math.max(1, Math.round(i / 10))}px)`,
  fade: (i) => `opacity(${Math.max(5, 100 - Math.round(i * 0.9))}%)`,
  invert: (i) => `invert(${i}%)`,
  sepia: (i) => `sepia(${i}%)`,
};

/** CSS filter value for the Filter intervention. */
export function filterCss(kind: string, intensity: number): string {
  return (FILTERS[kind] ?? FILTERS.grayscale)(intensity);
}

/** The filters of every rule on the page, in one CSS value (null without any). */
export function combinedFilter(d: Decision): TickResponse['filter'] {
  const css = pageFilters(d)
    .map((f) => filterCss(f.filter, f.intensity ?? 100))
    .join(' ');
  return css ? { css } : null;
}

/**
 * Intentions already shown: once per pass, whatever the number of pages opened meanwhile
 * (every page load starts a new content script). Kept in session storage, so that a restarted
 * service worker does not show them again.
 */
let announced: Set<string> | null = null;
const ANNOUNCED_KEY = 'announced';

async function loadAnnounced(): Promise<Set<string>> {
  if (!announced) announced = new Set((await sessionStore.get<string[]>(ANNOUNCED_KEY)) ?? []);
  return announced;
}

function announceOnce(key: string, active: boolean): boolean {
  if (!active || !announced || announced.has(key)) return false;
  if (announced.size > 500) announced.clear();
  announced.add(key);
  void sessionStore.set(ANNOUNCED_KEY, [...announced]);
  return true;
}

function responseFor(d: Decision, t: number, incognito: boolean, active: boolean): TickResponse {
  const s = store.config.settings;
  const c = ctx(t);
  const showTimer = s.timer.enabled && d.groups.some((g) => g.group.options.timer);
  const res: TickResponse = {
    tracked: d.groups.length > 0 || s.tracking.allSites,
    timer: null,
    filter: null,
    intention: null,
    warning: null,
    leaving: false,
    cover: false,
    settings: {
      timer: s.timer,
      showTimer,
      graceSeconds: s.interventions.graceSeconds,
      idleSeconds: s.tracking.idleSeconds,
      idleEnabled: s.tracking.idleEnabled,
      countAudio: s.tracking.countAudio,
      countInactive: s.tracking.countInactive,
      sound: s.sound,
    },
  };
  if (!d.groups.length || isNav(d)) return res;
  res.filter = combinedFilter(d);
  const pass = d.groups.find((g) => g.pass?.intention)?.pass;
  if (pass?.intention && announceOnce(`intention:${pass.id}`, active))
    res.intention = { text: pass.intention, until: pass.until ?? null };

  const r = nextRestriction(c, d.url, { incognito }, d);
  if (r) {
    const seconds = (r.at - t) / 1000;
    const group = store.config.groups.find((g) => g.id === r.groupId);
    if (showTimer && seconds <= s.timer.thresholdMinutes * 60) {
      res.timer = {
        seconds,
        label: group?.name ?? tr('ext.name'),
        color: group?.color ?? BRAND_COLOR,
        kind: r.kind,
      };
    }
    if (
      s.warningSeconds > 0 &&
      seconds <= s.warningSeconds &&
      SEVERITY[r.intervention.type] >= SEVERITY.ask
    ) {
      const id = `${r.groupId}:${Math.round(r.at / 10_000)}`;
      res.warning = {
        id,
        seconds,
        text: tr('warning.soon', { group: group?.name ?? '', seconds: Math.ceil(seconds) }),
      };
      if (!warned.has(id) && s.notifications.warning) {
        warned.add(id);
        void notify(`warn-${id}`, tr('ext.name'), res.warning.text);
      }
    }
  }
  return res;
}

/** Whether the time of a page with this decision counts: not on a page that it replaces. */
function counts(d: Decision): boolean {
  return !d.exempt && !isNav(d) && Boolean(d.groups.length || store.config.settings.tracking.allSites);
}

/** Whether the time of a page counts now (tabtime.ts). */
export function timeCounts(url: string, incognito: boolean): boolean {
  return counts(decide(ctx(), url, { incognito }));
}

/**
 * Credits a stretch of a page that sends no ticks, from `from` to t: the time counts for the rules
 * of the page as it started, which the background ends at least every minute (tabtime.ts). A limit
 * that runs out applies at once.
 */
export function creditStretch(url: string, incognito: boolean, from: number, t: number) {
  const d = decide(ctx(from), url, { incognito });
  if (!counts(d)) return;
  const before = decide(ctx(t), url, { incognito }).severity;
  credit(d, incognito, t, from);
  if (decide(ctx(t), url, { incognito }).severity !== before) void reconcile('budget');
}

const lastSeverity = new Map<number, number>();

export async function onTick(req: TickRequest, sender: chrome.runtime.MessageSender): Promise<TickResponse> {
  await store.ready();
  await loadAnnounced();
  counters.ticks++;
  const tab = sender.tab;
  const incognito = Boolean(tab?.incognito);
  const t = now();
  const c = ctx(t);
  let d = decide(c, req.url, { incognito });
  const locked = idleState === 'locked';
  if (req.active && !locked && counts(d)) {
    credit(d, incognito, t);
    const before = d.severity;
    d = decide(ctx(t), req.url, { incognito });
    if (d.severity !== before) {
      // A budget just ran out (or a session limit was reached): apply it everywhere within 1 s.
      void reconcile('budget');
    }
  }
  const res = responseFor(d, t, incognito, req.active && !locked);
  if (tab?.id !== undefined) {
    const prev = lastSeverity.get(tab.id);
    lastSeverity.set(tab.id, d.severity);
    if (prev !== undefined && prev !== d.severity && isNav(d)) void reconcile('tick-change');
    if (tab.active) void updateBadge(tab.id, req.url, incognito);
    // A page that is still there although its decision replaces it may have refused to leave.
    Object.assign(res, leavingState(tab, req.url, d));
  }
  if (req.labels) res.labels = overlayLabels();
  return res;
}

/** Forgets the per-tab state of a closed tab. */
export function forgetTab(tabId: number) {
  lastSeverity.delete(tabId);
}

/**
 * Messages of the overlay, with their placeholders: the content script formats them with the
 * values it has ({group}, {time}, {seconds}). Translating them here would drop the placeholders.
 */
function overlayLabels(): Record<string, string> {
  const keys = [
    'overlay.hide',
    'overlay.timerLeft',
    'overlay.pauseLeft',
    'overlay.passLeft',
    'overlay.intention',
    'overlay.dismiss',
    'overlay.grace.title',
    'overlay.grace.body',
    'overlay.grace.copy',
    'overlay.grace.copied',
    'overlay.timer.aria',
    'overlay.drag',
    'overlay.cover.title',
    'overlay.cover.body',
    'overlay.cover.open',
  ];
  return {
    ...Object.fromEntries(keys.map((k) => [k, template(k)])),
    __locale: formatLocale(),
    __lang: locale(),
    __dir: textDirection(),
  };
}
