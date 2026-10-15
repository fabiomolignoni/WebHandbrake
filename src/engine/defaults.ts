/** Defaults and constructors for configuration entities. */

import { WAIT_IN_DIALOG_SECONDS } from './limits';
import {
  type Config,
  type Group,
  type GroupOptions,
  type Intervention,
  type InterventionType,
  type PausePolicy,
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
    advanced: false,
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
      internalPages: 'never',
      internalPagesFollowPause: false,
      emergencyHours: 24,
    },
    later: { notify: true },
    diagnostics: { decisionLog: true },
    clock: { useDateHeaders: true },
    onboarded: false,
  };
}

export function defaultConfig(): Config {
  return {
    schema: SCHEMA_VERSION,
    groups: [],
    lists: [],
    allowlist: [],
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
 * Whether a break lifts an intervention: only a block. A question, a wait and a challenge have
 * their own way in; count only and a filter leave the page open, a redirect and closing the tab
 * leave it at once (#15).
 */
export const breaksLift = (i: Intervention): boolean => i.type === 'block';

/** A rule has breaks only when one of its conditions blocks. */
export const canHaveBreaks = (g: Pick<Group, 'policies'>): boolean =>
  g.policies.some((p) => breaksLift(p.intervention));

/** Pause rules suggested for each protection. */
export function pausePolicyFor(protection: Protection): PausePolicy {
  const firm: PausePolicy = {
    allowed: true,
    duringSessions: false,
    scopes: ['page', 'site'],
    duration: { mode: 'choices', minutes: 10, choices: [5, 10] },
    limit: { count: 2, minutes: 15, period: { kind: 'day' } },
    cost: { type: 'challenge', kind: 'random', length: 24 },
    reason: 'required',
    metered: true,
  };
  switch (protection.kind) {
    case 'reminder':
      return {
        allowed: true,
        duringSessions: true,
        scopes: ['page', 'site', 'group', 'all'],
        duration: { mode: 'upTo', minutes: 30 },
        limit: { count: 6, period: { kind: 'day' } },
        cost: { type: 'confirm' },
        reason: 'none',
        metered: false,
      };
    case 'wait':
      if (protection.seconds > WAIT_IN_DIALOG_SECONDS) return firm;
      return {
        allowed: true,
        duringSessions: false,
        scopes: ['page', 'site', 'group'],
        duration: { mode: 'choices', minutes: 15, choices: [5, 10, 15] },
        limit: { count: 3, minutes: 30, period: { kind: 'day' } },
        cost: { type: 'delay', seconds: protection.seconds },
        reason: 'optional',
        metered: false,
      };
    case 'password':
      return { ...firm, cost: { type: 'password' } };
    case 'partner':
      // The partner's code is asked for the breaks of the rule unless it says otherwise.
      return { ...firm, cost: { type: 'confirm' } };
    case 'locked':
    case 'permanent':
      return {
        allowed: false,
        duringSessions: false,
        scopes: ['page'],
        duration: { mode: 'fixed', minutes: 5 },
        limit: { count: 1, period: { kind: 'day' } },
        cost: { type: 'challenge', kind: 'random', length: 48 },
        reason: 'required',
        metered: true,
      };
  }
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
    lists: [],
    policies: [],
    pause: pausePolicyFor(DEFAULT_PROTECTION),
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

/** Quick conditions: friction (wait + reason) for temptations, block for explicit windows and sessions. */
export function frictionIntervention(): Intervention {
  return { type: 'ask', seconds: 10, choices: [5, 10, 15], maxMinutes: 15 };
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
      return { type: 'filter', filter: 'grayscale', intensity: 100, mute: false };
    case 'ask':
      return frictionIntervention();
    case 'delay':
      return delayIntervention(QUICK_DELAY_SECONDS);
    case 'challenge':
      return {
        type: 'challenge',
        kind: 'random',
        length: 24,
        charset: 'alnum',
        grant: { scope: 'site', mode: 'visit' },
      };
    case 'redirect':
      return { type: 'redirect', url: 'https://' };
    default:
      return { type } as Intervention;
  }
}

/** When a new rule applies, as chosen in the creation wizard and in onboarding. */
export type QuickWhen = 'always' | 'schedule' | 'daily';
/** What happens: any intervention, from "only count" to "redirect". */
export type QuickHow = Exclude<InterventionType, 'allow'>;

export const QUICK_DELAY_SECONDS = 30;

export function quickIntervention(how: QuickHow, redirectUrl?: string): Intervention {
  if (how === 'redirect') return { type: 'redirect', url: redirectUrl?.trim() || 'https://' };
  return defaultIntervention(how);
}

/** The starting condition of a rule: "when" × "what happens" (an if-then plan). */
export function quickPolicies(
  when: QuickWhen,
  how: QuickHow | Intervention,
  windows: TimeWindow[],
  minutes: number,
  redirectUrl?: string,
): Policy[] {
  // The wizard passes the intervention with the settings chosen (#14); a type takes the defaults.
  const intervention = typeof how === 'string' ? quickIntervention(how, redirectUrl) : how;
  // Counting only at certain times (#21): outside them the sites are allowed and not counted.
  if (when === 'schedule' && intervention.type === 'track')
    return [
      newPolicy({ schedule: { mode: 'during', windows }, intervention }),
      newPolicy({ intervention: { type: 'allow' } }),
    ];
  if (when === 'schedule') return [newPolicy({ schedule: { mode: 'during', windows }, intervention })];
  if (when === 'daily')
    return [newPolicy({ budget: { type: 'time', minutes, period: { kind: 'day' } }, intervention })];
  return [newPolicy({ intervention })];
}

export function targetsFromSites(sites: string[]): Target[] {
  return sites.map((value) => newTarget({ type: 'domain', value }));
}
