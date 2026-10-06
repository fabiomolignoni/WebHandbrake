/** Defaults and constructors for configuration entities. */

import { TEMPLATES, type TemplateDef } from '../data/templates';
import {
  type Config,
  type Group,
  type GroupOptions,
  type Intervention,
  type InterventionType,
  type PausePolicy,
  type Policy,
  type ProtectionLevel,
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
 * Brand colour and default accent: a muted indigo (purple-blue), the pleasant and least arousing
 * hue family in Valdez & Mehrabian (1994), associated with competence and calm rather than alarm
 * (docs/ux-redesign.md §11.3).
 */
export const DEFAULT_ACCENT = '#4850a5';
/** Accent used before v1.1, migrated to the new default when it was never changed. */
export const LEGACY_ACCENT = '#2f7a78';

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
    accent: DEFAULT_ACCENT,
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
      alternatives: [],
      graceSeconds: 45,
      autoReopen: false,
    },
    pauseLimit: { period: { kind: 'day' } },
    protection: {
      level: 'balanced',
      lockedUntil: null,
      fallback: 'strict',
      coolingOffHours: 24,
      confirmHours: 48,
      balancedDelaySeconds: 30,
      challengeLength: 24,
      internalPages: 'auto',
      internalPagesFollowPause: false,
      access: { passwordHash: null, codeLength: 0, lockWindows: [] },
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
  };
}

/** Pause rules suggested for each protection level (BRK-01…BRK-05). */
export function pausePolicyFor(level: ProtectionLevel): PausePolicy {
  switch (level) {
    case 'soft':
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
    case 'balanced':
      return {
        allowed: true,
        duringSessions: false,
        scopes: ['page', 'site', 'group'],
        duration: { mode: 'choices', minutes: 15, choices: [5, 10, 15] },
        limit: { count: 3, minutes: 30, period: { kind: 'day' } },
        cost: { type: 'delay', seconds: 30 },
        reason: 'optional',
        metered: false,
      };
    case 'strict':
      return {
        allowed: true,
        duringSessions: false,
        scopes: ['page', 'site'],
        duration: { mode: 'choices', minutes: 10, choices: [5, 10] },
        limit: { count: 2, minutes: 15, period: { kind: 'day' } },
        cost: { type: 'challenge', kind: 'random', length: 24 },
        reason: 'required',
        metered: true,
      };
    case 'locked':
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
    pause: pausePolicyFor('balanced'),
    protection: null,
    options: defaultOptions(),
    ...partial,
  };
}

export function newTarget(t: Omit<Target, 'id'>): Target {
  return { id: newId(), ...t };
}

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Schedule presets (SCH-02). */
export const SCHEDULE_PRESETS: Record<string, TimeWindow[]> = {
  office: [{ days: WEEKDAYS, start: 9 * 60, end: 17 * 60 }],
  evenings: [{ days: ALL_DAYS, start: 20 * 60, end: 23 * 60 }],
  allDay: [{ days: ALL_DAYS, start: 0, end: 1440 }],
  weekdays: [{ days: WEEKDAYS, start: 0, end: 1440 }],
  nights: [{ days: ALL_DAYS, start: 23 * 60, end: 6 * 60 }],
};

/** D4: friction (wait + intention) for temptations, block for explicit windows and sessions. */
export function frictionIntervention(): Intervention {
  return { type: 'ask', seconds: 10, choices: [5, 10, 15], maxMinutes: 15, requireIntention: false };
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
    case 'remind':
      return { type: 'remind' };
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
/** What happens: any intervention, from "only count" to "redirect" (G1). */
export type QuickHow = Exclude<InterventionType, 'allow'>;

export const QUICK_DELAY_SECONDS = 30;

export function quickIntervention(how: QuickHow, redirectUrl?: string): Intervention {
  if (how === 'redirect') return { type: 'redirect', url: redirectUrl?.trim() || 'https://' };
  return defaultIntervention(how);
}

/** The starting condition of a rule: "when" × "what happens" (an if-then plan). */
export function quickPolicies(
  when: QuickWhen,
  how: QuickHow,
  windows: TimeWindow[],
  minutes: number,
  redirectUrl?: string,
): Policy[] {
  const intervention = quickIntervention(how, redirectUrl);
  if (when === 'schedule') return [newPolicy({ schedule: { mode: 'during', windows }, intervention })];
  if (when === 'daily')
    return [newPolicy({ budget: { type: 'time', minutes, period: { kind: 'day' } }, intervention })];
  return [newPolicy({ intervention })];
}

export function templateById(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function targetsFromSites(sites: string[]): Target[] {
  return sites.map((value) => newTarget({ type: 'domain', value }));
}
