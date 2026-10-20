/**
 * Time accounting.
 *
 * Content scripts send a tick about once per second only while the page is visible, focused
 * (or playing media when that is counted) and the user is not idle. Credits are computed per
 * usage key from the time since the previous credit of the same key, so a group never gets more
 * than one second per real second whatever the number of tabs, and gaps (sleep, locked
 * screen, clock jumps) are never counted.
 */

import { type Decision, decide, pageFilters, policyKey } from '../engine/decide';
import { BRAND_COLOR } from '../engine/defaults';
import { nextRestriction } from '../engine/next';
import { isNav, SEVERITY } from '../engine/severity';
import type { Activity, Group } from '../engine/types';
import { stripWww } from '../engine/url';
import { usageKeys } from '../engine/usage';
import { locale, template, t as tr } from '../i18n/i18n';
import { api, sessionStore } from '../platform/api';
import type { TickResponse } from '../shared/models';
import type { TickRequest } from '../shared/rpc';
import { updateBadge } from './badge';
import { now } from './clock';
import { counters } from './diagnostics-state';
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

function creditSeconds(key: string, t: number): number {
  const last = lastCredit.get(key);
  lastCredit.set(key, t);
  if (last === undefined) return 1;
  const dt = t - last;
  if (dt <= 0) return 0;
  return dt > MAX_STEP_MS ? 1 : dt / 1000;
}

function updateActivity(key: string, t: number, seconds: number, gapMs: number): boolean {
  const acts = store.state.activity;
  let act: Activity | undefined = acts[key];
  let newVisit = false;
  if (!act || t - act.last > gapMs) {
    act = { last: t, visitStart: t, visitSeconds: 0, run: 0 };
    newVisit = true;
  }
  act.last = t;
  act.visitSeconds += seconds;
  act.run += seconds;
  acts[key] = act;
  return newVisit;
}

/** Starts the cool-down when continuous use reaches the maximum. */
function checkSessionBudgets(group: Group, site: string, t: number) {
  for (const p of group.policies) {
    const b = p.budget;
    if (b?.type !== 'session') continue;
    const key = b.perSite ? usageKeys.site(group.id, site) : usageKeys.group(group.id);
    const act = store.state.activity[key];
    if (!act || act.run < b.maxMinutes * 60) continue;
    const pk = policyKey(p.id, b.perSite ? site : null);
    store.state.cooldowns[`session:${pk}`] = {
      until: t + b.cooldownMinutes * 60_000,
      group: group.id,
      site: b.perSite ? site : undefined,
      kind: 'session',
      policy: p.id,
    };
    act.run = 0;
    void store.saveState();
  }
}

function credit(d: Decision, incognito: boolean, t: number) {
  const s = store.config.settings;
  const cal = store.cc.cal;
  const gap = s.tracking.visitGapMinutes * 60_000;
  const parsed = d.parsed;

  // A rule whose condition allows its sites without counting gets no time.
  const counted = d.groups.filter((r) => r.intervention.type !== 'allow');
  if (counted.length) {
    const any = creditSeconds(usageKeys.all, t);
    if (any > 0) store.usage.add(usageKeys.all, t, any, 0, cal);
  }
  for (const r of counted) {
    const gk = usageKeys.group(r.group.id);
    const sk = usageKeys.site(r.group.id, r.site);
    for (const key of [gk, sk]) {
      const sec = creditSeconds(key, t);
      if (sec <= 0) continue;
      const visit = updateActivity(key, t, sec, gap);
      store.usage.add(key, t, sec, visit ? 1 : 0, cal);
    }
    checkSessionBudgets(r.group, r.site, t);
    // Metered pauses are consumed only while on the site.
    const pause = r.pause;
    if (pause && pause.remaining !== undefined) {
      const sec = creditSeconds(`pause:${pause.id}`, t);
      pause.remaining = Math.max(0, pause.remaining - sec);
      store.scheduleState();
    }
  }
  // No per-site detail for private windows; budgets above are still consumed.
  if (parsed?.web && !incognito && (counted.length || s.tracking.allSites)) {
    const host = stripWww(parsed.host);
    const hk = usageKeys.host(host);
    const sec = creditSeconds(hk, t);
    if (sec > 0) {
      const last = hostLastActive.get(host) ?? 0;
      hostLastActive.set(host, t);
      store.usage.add(hk, t, sec, t - last > gap ? 1 : 0, cal, false);
    }
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
  none: () => 'none',
};

/** CSS filter value for the Filter intervention (custom filters accept only CSS filter functions). */
export function filterCss(kind: string, intensity: number, custom?: string): string {
  if (kind === 'custom') {
    const safe = (custom ?? '').replace(/[^a-z0-9%().,\s-]/gi, '');
    return /url\(/i.test(safe) ? 'none' : safe || 'none';
  }
  return (FILTERS[kind] ?? FILTERS.none)(intensity);
}

/** The filters of every rule on the page, in one CSS value (null without any). */
export function combinedFilter(d: Decision): TickResponse['filter'] {
  const filters = pageFilters(d);
  const css = filters
    .map((f) => filterCss(f.filter, f.intensity ?? 100, f.css))
    .filter((v) => v !== 'none')
    .join(' ');
  const mute = filters.some((f) => f.mute);
  return css || mute ? { css: css || 'none', mute } : null;
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
  if (
    !d.exempt &&
    req.active &&
    !locked &&
    !isNav(d) &&
    (d.groups.length || store.config.settings.tracking.allSites)
  ) {
    credit(d, incognito, t);
    const before = d.severity;
    d = decide(ctx(t), req.url, { incognito });
    if (d.severity !== before) {
      // A budget just ran out (or a session limit was reached): apply it everywhere within 1 s.
      void reconcile('budget');
    }
  }
  if (tab?.id !== undefined) {
    const prev = lastSeverity.get(tab.id);
    lastSeverity.set(tab.id, d.severity);
    if (prev !== undefined && prev !== d.severity && isNav(d)) void reconcile('tick-change');
    if (tab.active) void updateBadge(tab.id, req.url, incognito);
  }
  const res = responseFor(d, t, incognito, req.active && !locked);
  if (req.labels) res.labels = overlayLabels();
  await applyMute(tab, res.filter?.mute ?? false);
  return res;
}

const mutedByUs = new Set<number>();

/** Mute the tab while the filter asks for it, and give the sound back afterwards. */
async function applyMute(tab: chrome.tabs.Tab | undefined, mute: boolean) {
  if (!tab?.id) return;
  if (mute && !tab.mutedInfo?.muted) {
    mutedByUs.add(tab.id);
    await api.tabs.update(tab.id, { muted: true }).catch(() => undefined);
  } else if (!mute && mutedByUs.has(tab.id)) {
    mutedByUs.delete(tab.id);
    await api.tabs.update(tab.id, { muted: false }).catch(() => undefined);
  }
}

/**
 * Gives the sound back when a tab muted by a filter navigates to a page that is not muted: that
 * page may have no content script to send the tick that would do it.
 */
export async function releaseMute(tabId: number, url: string) {
  if (!mutedByUs.has(tabId)) return;
  await store.ready();
  const tab = await api.tabs.get(tabId).catch(() => undefined);
  const d = decide(ctx(), url, { incognito: Boolean(tab?.incognito) });
  if (combinedFilter(d)?.mute) return;
  await applyMute(tab ?? ({ id: tabId } as chrome.tabs.Tab), false);
}

/** Forgets the per-tab state of a closed tab. */
export function forgetTab(tabId: number) {
  mutedByUs.delete(tabId);
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
  ];
  return { ...Object.fromEntries(keys.map((k) => [k, template(k)])), __locale: locale() };
}
