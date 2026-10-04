/**
 * Time accounting (TIM-01…TIM-07, SEM-08, LIM-05, BRK-08).
 *
 * Content scripts send a tick about once per second only while the page is visible, focused
 * (or playing media when that is counted) and the user is not idle. Credits are computed per
 * usage key from the time since the previous credit of the same key, so a group never gets more
 * than one second per real second whatever the number of tabs (TIM-03), and gaps (sleep, locked
 * screen, clock jumps) are never counted (TIM-02).
 */

import { type Decision, decide, isNav, policyKey, SEVERITY } from '../engine/decide';
import { nextRestriction } from '../engine/next';
import type { Activity, Group } from '../engine/types';
import { stripWww } from '../engine/url';
import { usageKeys } from '../engine/usage';
import { t as tr } from '../i18n/i18n';
import { api } from '../platform/api';
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

/** LIM-05: starts the cool-down when continuous use reaches the maximum. */
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

  if (d.groups.length) {
    const any = creditSeconds('a:', t);
    if (any > 0) store.usage.add('a:', t, any, 0, cal);
  }
  for (const r of d.groups) {
    const gk = usageKeys.group(r.group.id);
    const sk = usageKeys.site(r.group.id, r.site);
    for (const key of [gk, sk]) {
      const sec = creditSeconds(key, t);
      if (sec <= 0) continue;
      const visit = updateActivity(key, t, sec, gap);
      store.usage.add(key, t, sec, visit ? 1 : 0, cal);
    }
    checkSessionBudgets(r.group, r.site, t);
    // BRK-08: metered pauses are consumed only while on the site.
    const pause = r.pause;
    if (pause && pause.remaining !== undefined) {
      const sec = creditSeconds(`pause:${pause.id}`, t);
      pause.remaining = Math.max(0, pause.remaining - sec);
      store.scheduleState();
    }
  }
  // STA-07: no per-site detail for private windows; budgets above are still consumed.
  if (parsed?.web && !incognito && (d.groups.length || s.tracking.allSites)) {
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

/** CSS filter value for INT-05 (custom filters accept only CSS filter functions). */
export function filterCss(kind: string, intensity: number, custom?: string): string {
  if (kind === 'custom') {
    const safe = (custom ?? '').replace(/[^a-z0-9%().,\s-]/gi, '');
    return /url\(/i.test(safe) ? 'none' : safe || 'none';
  }
  return (FILTERS[kind] ?? FILTERS.none)(intensity);
}

function responseFor(d: Decision, t: number, incognito: boolean): TickResponse {
  const s = store.config.settings;
  const c = ctx(t);
  const showTimer = s.timer.enabled && d.groups.some((g) => g.group.options.timer);
  const res: TickResponse = {
    tracked: d.groups.length > 0 || s.tracking.allSites,
    timer: null,
    filter: null,
    remind: null,
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
  const primary = d.primary;
  const i = d.intervention;
  if (i.type === 'filter')
    res.filter = { css: filterCss(i.filter, i.intensity ?? 100, i.css), mute: Boolean(i.mute) };
  if (i.type === 'remind' && primary) {
    const act = store.state.activity[usageKeys.group(primary.group.id)];
    res.remind = {
      id: `${primary.group.id}:${act?.visitStart ?? 0}`,
      group: primary.group.name,
      color: primary.group.color,
      note: primary.group.note,
      message: i.message ?? '',
    };
  }
  const pass = d.groups.find((g) => g.pass?.intention)?.pass;
  if (pass?.intention) res.intention = { text: pass.intention, until: pass.until ?? null };

  const r = nextRestriction(c, d.url, { incognito }, d);
  if (r) {
    const seconds = (r.at - t) / 1000;
    const group = store.config.groups.find((g) => g.id === r.groupId);
    if (showTimer && seconds <= s.timer.thresholdMinutes * 60) {
      res.timer = {
        seconds,
        label: group?.name ?? tr('ext.name'),
        color: group?.color ?? s.accent,
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
  const res = responseFor(d, t, incognito);
  if (req.labels) res.labels = overlayLabels();
  await applyMute(tab, res.filter?.mute ?? false);
  return res;
}

const mutedByUs = new Set<number>();

/** INT-05: mute the tab while the filter asks for it, and give the sound back afterwards. */
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

function overlayLabels(): Record<string, string> {
  const keys = [
    'overlay.hide',
    'overlay.timerLeft',
    'overlay.pauseLeft',
    'overlay.intention',
    'overlay.dismiss',
    'overlay.grace.title',
    'overlay.grace.body',
    'overlay.grace.copy',
    'overlay.grace.copied',
    'overlay.remind.title',
    'overlay.timer.aria',
    'overlay.drag',
  ];
  return Object.fromEntries(keys.map((k) => [k, tr(k)]));
}
