/** Defaults and constructors for configuration entities. */

import { WAIT_IN_DIALOG_SECONDS } from './limits';
import { parseTargetLine, targetToLine } from './patterns';
import {
  type Config,
  type Group,
  type GroupOptions,
  type Intervention,
  type InterventionType,
  type PausePolicy,
  type Period,
  type Policy,
  type Protection,
  type RuntimeState,
  SCHEMA_VERSION,
  type Settings,
  type Target,
  type TimeWindow,
} from './types';

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Brand colour, also the accent of every page: a muted indigo (purple-blue), the pleasant and least
 * arousing hue family in Valdez & Mehrabian (1994), associated with competence and calm rather
 * than alarm. It is not a setting.
 */
export const BRAND_COLOR = '#4850a5';

/** Rule colours: distinct hues, readable as small dots and tiles in both themes. */
export const GROUP_COLORS = [
  '#4f6bd0',
  '#c4574f',
  '#b5762b',
  '#6b8f3c',
  '#2f8fa8',
  '#7a5ba8',
  '#8a6d3b',
  '#8c4a62',
];

export function defaultSettings(): Settings {
  return {
    language: 'auto',
    theme: 'system',
    highContrast: false,
    hour12: 'auto',
    dateFormat: 'auto',
    weekStart: 1,
    dayStart: 0,
    timer: { enabled: true, thresholdMinutes: 5, corner: 'bottom-right', size: 'medium', opacity: 0.94 },
    badge: { enabled: true, thresholdMinutes: 60 },
    contextMenu: true,
    notifications: { enabled: false, sessionEnd: true, pendingReady: true, warning: true },
    warningSeconds: 60,
    sound: false,
    tracking: {
      idleSeconds: 120,
      idleEnabled: true,
      countAudio: false,
      countInactive: false,
      visitGapMinutes: 5,
      allSites: false,
      retentionDays: 730,
    },
    interventions: {
      hideUrl: false,
      customCss: '',
      graceSeconds: 45,
      autoReopen: false,
    },
    pauseLimit: { period: { kind: 'day' } },
    protection: {
      confirmHours: 48,
      internalPages: 'auto',
      internalPagesFollowPause: false,
      emergencyHours: 24,
    },
    later: { notify: true },
    // Full addresses of restricted pages, readable by anyone at the computer: only when asked for.
    diagnostics: { decisionLog: false },
    clock: { useDateHeaders: true },
    onboarded: false,
  };
}

export function defaultConfig(): Config {
  return {
    schema: SCHEMA_VERSION,
    groups: [],
    settings: defaultSettings(),
    tombstones: [],
  };
}

export function defaultState(): RuntimeState {
  return {
    grants: [],
    sessions: [],
    pending: [],
    cooldowns: {},
    forfeits: {},
    activity: {},
    emergency: null,
    pauses: [],
    tamper: [],
    lastWall: 0,
    clockOffset: 0,
    lastAlive: 0,
    partnerSteps: {},
    secretFailures: { count: 0, lockedUntil: 0 },
  };
}

/** The protection of a rule made outside the wizard and first run, which ask for one (#12). */
export const DEFAULT_PROTECTION: Protection = { kind: 'wait', seconds: 30 };

/**
 * A protection that the person cannot pass alone within a couple of minutes: a password or
 * a partner code (which someone else may keep), Locked, Permanent, or a wait that is a pending change.
 */
export function firmProtection(p: Protection): boolean {
  return p.kind === 'wait' ? p.seconds > WAIT_IN_DIALOG_SECONDS : p.kind !== 'reminder';
}

/**
 * Whether a break lifts an intervention: only a block. A question, a wait and a challenge have
 * their own way in; count only and a filter leave the page open, a redirect and closing the tab
 * leave it at once (#15).
 */
export const breaksLift = (i: Intervention): boolean => i.type === 'block';

/** A rule has breaks only when one of its conditions blocks. */
export const canHaveBreaks = (g: Pick<Group, 'policies'>): boolean =>
  g.policies.some((p) => breaksLift(p.intervention));

/**
 * The breaks of a new rule: off until turned on; then at most 15 minutes each, three a day and half
 * an hour in all, after a 30-second wait.
 */
export function defaultPause(): PausePolicy {
  return {
    allowed: false,
    maxMinutes: 15,
    limit: { count: 3, minutes: 30, period: { kind: 'day' } },
    cost: { type: 'delay', seconds: 30 },
  };
}

export function defaultOptions(): GroupOptions {
  return { privacy: 'all', embeds: false, tabs: 'all', timer: true, quickSession: true };
}

export function newGroup(partial: Partial<Group> = {}, now = Date.now()): Group {
  return {
    id: newId(),
    rev: 1,
    updatedAt: now,
    name: '',
    color: GROUP_COLORS[0],
    icon: 'circle',
    note: '',
    message: '',
    enabled: true,
    archived: false,
    targets: [],
    policies: [],
    pause: defaultPause(),
    protection: { ...DEFAULT_PROTECTION },
    options: defaultOptions(),
    ...partial,
  };
}

export function newTarget(t: Omit<Target, 'id'>): Target {
  return { id: newId(), ...t };
}

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Schedule presets. */
export const SCHEDULE_PRESETS: Record<string, TimeWindow[]> = {
  office: [{ days: WEEKDAYS, start: 9 * 60, end: 17 * 60 }],
  evenings: [{ days: ALL_DAYS, start: 20 * 60, end: 23 * 60 }],
  allDay: [{ days: ALL_DAYS, start: 0, end: 1440 }],
  weekdays: [{ days: WEEKDAYS, start: 0, end: 1440 }],
  nights: [{ days: ALL_DAYS, start: 23 * 60, end: 6 * 60 }],
};

/** Ask first: a reason of any length, for at most 15 minutes. */
export function frictionIntervention(): Intervention {
  return { type: 'ask', maxMinutes: 15, minReasonLength: 1 };
}

/** Ask first lets one answer after this wait. */
export const ASK_WAIT_SECONDS = 10;

/** The durations Ask first offers, in minutes: those of 5, 10 and 15 within its longest time, or that. */
export function askChoices(maxMinutes: number): number[] {
  const choices = [5, 10, 15].filter((c) => c <= maxMinutes);
  return choices.length ? choices : [maxMinutes];
}

export function delayIntervention(seconds = 30): Intervention {
  return {
    type: 'delay',
    seconds,
    autoContinue: false,
    onBlur: 'pause',
    hideCountdown: false,
    grant: { scope: 'site', mode: 'visit' },
  };
}

export function newPolicy(partial: Partial<Policy> = {}): Policy {
  return {
    id: newId(),
    schedule: { mode: 'always', windows: [] },
    intervention: { type: 'block' },
    ...partial,
  };
}

/** Default settings of every intervention, used when it is chosen in the editor or a wizard. */
export function defaultIntervention(type: InterventionType): Intervention {
  switch (type) {
    case 'filter':
      return { type: 'filter', filter: 'grayscale', intensity: 100 };
    case 'ask':
      return frictionIntervention();
    case 'delay':
      return delayIntervention(QUICK_DELAY_SECONDS);
    case 'challenge':
      return {
        type: 'challenge',
        kind: 'random',
        length: 24,
        grant: { scope: 'site', mode: 'visit' },
      };
    case 'redirect':
      return { type: 'redirect', url: 'https://' };
    default:
      return { type } as Intervention;
  }
}

export const QUICK_DELAY_SECONDS = 30;

/** A day, in minutes: the period of a new rule's time limit unless another is chosen. */
export const DAY_MINUTES = 1440;

/**
 * The period of a time limit that starts again every so many minutes: an hour and a day are the
 * clock's and the calendar's, whole days count days, anything else counts minutes within the day.
 */
export function everyPeriod(minutes: number): Period {
  if (minutes === 60) return { kind: 'hour' };
  if (minutes === DAY_MINUTES) return { kind: 'day' };
  if (minutes > DAY_MINUTES && minutes % DAY_MINUTES === 0)
    return { kind: 'days', n: Math.min(90, minutes / DAY_MINUTES) };
  return { kind: 'minutes', n: Math.min(DAY_MINUTES, Math.max(5, Math.round(minutes))) };
}

/** How long a period lasts at most, in minutes (a month: 31 days). */
export function periodMinutes(p: Period): number {
  switch (p.kind) {
    case 'hour':
      return 60;
    case 'day':
      return DAY_MINUTES;
    case 'week':
      return 7 * DAY_MINUTES;
    case 'month':
      return 31 * DAY_MINUTES;
    case 'days':
      return (p.n ?? 1) * DAY_MINUTES;
    default:
      return p.n ?? 60;
  }
}

/**
 * Counting at certain times leaves the other times alone (#21): a new rule that only counts during
 * its times gets a last condition that neither restricts nor counts, so that outside them the
 * sites are allowed and not counted.
 */
export function withCountingGap(policies: Policy[]): Policy[] {
  const [p] = policies;
  return policies.length === 1 && p.intervention.type === 'track' && p.schedule.mode === 'during' && !p.budget
    ? [...policies, newPolicy({ intervention: { type: 'allow' } })]
    : policies;
}

/** The targets of lines in the address syntax, such as the entries of a ready-made list. */
export function targetsFromLines(lines: string[]): Target[] {
  return lines.flatMap((line) => {
    const parsed = parseTargetLine(line);
    return parsed?.target ? [newTarget(parsed.target)] : [];
  });
}

/** What makes two targets the same entry, whatever their id: their line. */
export function targetKey(t: Pick<Target, 'type' | 'value' | 'allow'>): string {
  return targetToLine({ type: t.type, value: t.value, allow: t.allow });
}

/** The order of Sort in a rule's sites: by address. */
export function sortTargets(targets: Target[]): Target[] {
  return [...targets].sort((a, b) => a.value.localeCompare(b.value));
}

/**
 * A rule's sites with the entries of a ready-made list that it does not have yet, sorted. Sites
 * already sorted (none is) stay so with them; otherwise the list goes after them, so that an order
 * chosen by hand is kept.
 */
export function addTemplate(targets: Target[], entries: string[]): Target[] {
  const have = new Set(targets.map(targetKey));
  const added = sortTargets(targetsFromLines(entries).filter((x) => !have.has(targetKey(x))));
  const sorted = sortTargets(targets).every((x, i) => x === targets[i]);
  return sorted ? sortTargets([...targets, ...added]) : [...targets, ...added];
}
