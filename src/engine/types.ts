/**
 * WebHandbrake data model.
 *
 * Everything in this file is plain JSON-serialisable data. The model is designed to be
 * sync-ready (DAT-09): every top-level entity has a stable id, a revision counter and an
 * update timestamp, and deletions leave tombstones.
 */

export const SCHEMA_VERSION = 1;

export interface Versioned {
  id: string;
  rev: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Targets (MAT)
// ---------------------------------------------------------------------------

/**
 * - domain:   the domain and all its subdomains (youtube.com → m.youtube.com, www.youtube.com…)
 * - host:     only this host (www. is treated as equivalent)
 * - path:     a path prefix (segment aware) — reddit.com/r/funny matches /r/funny and below
 * - page:     an exact page (query parameters listed in the value must be present)
 * - homepage: only the home page of the host
 * - regex:    a regular expression on the full URL (advanced)
 */
export type TargetType = 'domain' | 'host' | 'path' | 'page' | 'homepage' | 'regex';

export interface Target {
  id: string;
  type: TargetType;
  /** Canonical value, e.g. "youtube.com", "reddit.com/r/*\/comments", "^https?://…". */
  value: string;
  /** Exception ("allow") instead of a blocking entry. */
  allow?: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Schedules, periods, budgets (SCH, LIM)
// ---------------------------------------------------------------------------

/** A weekly recurring window. Times are minutes from midnight (0–1440). */
export interface TimeWindow {
  /** Weekdays of the (logical) day on which the window starts. 0 = Sunday … 6 = Saturday. */
  days: number[];
  start: number;
  /** End minute. end <= start means the window runs past midnight (overnight). 0–1440 = all day. */
  end: number;
}

export type ScheduleMode = 'always' | 'during' | 'outside';

export interface Schedule {
  mode: ScheduleMode;
  windows: TimeWindow[];
}

export type PeriodKind = 'hour' | 'day' | 'week' | 'month' | 'minutes' | 'days' | 'rolling';

export interface Period {
  kind: PeriodKind;
  /** For 'minutes' (5–1440), 'days' (1–90) and 'rolling' (5–1440 minutes). */
  n?: number;
  /** Alignment offset: minutes for 'minutes', days for 'days'. */
  offset?: number;
}

export interface TimeBudget {
  type: 'time';
  minutes: number;
  period: Period;
  perSite?: boolean;
}

export interface VisitBudget {
  type: 'visits';
  count: number;
  period: Period;
  perSite?: boolean;
  /** Optional maximum duration of every visit, in minutes. */
  maxVisitMinutes?: number;
}

export interface SessionBudget {
  type: 'session';
  /** Maximum continuous use, in minutes. */
  maxMinutes: number;
  /** Mandatory stop after the maximum is reached, in minutes. */
  cooldownMinutes: number;
  perSite?: boolean;
}

export type Budget = TimeBudget | VisitBudget | SessionBudget;

// ---------------------------------------------------------------------------
// Interventions (INT)
// ---------------------------------------------------------------------------

export type InterventionType =
  | 'allow'
  | 'track'
  | 'remind'
  | 'filter'
  | 'ask'
  | 'delay'
  | 'challenge'
  | 'block'
  | 'redirect'
  | 'close';

export type FilterKind = 'grayscale' | 'blur' | 'fade' | 'invert' | 'sepia' | 'custom' | 'none';

/** What access is granted after passing a delay, an intention question or a challenge. */
export interface GrantSpec {
  scope: 'page' | 'site' | 'group';
  /** 'visit': until the visit ends (no activity for the visit gap); 'minutes': fixed duration. */
  mode: 'visit' | 'minutes';
  minutes?: number;
}

export type ChallengeKind = 'random' | 'phrase' | 'math';
export type Charset = 'alnum' | 'letters' | 'digits' | 'symbols';

export type Intervention =
  | { type: 'allow' }
  | { type: 'track' }
  | { type: 'remind'; message?: string }
  | { type: 'filter'; filter: FilterKind; intensity?: number; css?: string; mute?: boolean }
  | {
      type: 'ask';
      /** Seconds to wait before "Continue" becomes available. */
      seconds?: number;
      /** Duration choices offered, in minutes. */
      choices: number[];
      maxMinutes: number;
      requireIntention?: boolean;
      /** LIM-06: block for this many minutes once the chosen time is over. */
      cooldownMinutes?: number;
    }
  | {
      type: 'delay';
      seconds: number;
      /** INT-02 d: random duration between seconds and randomTo. */
      randomTo?: number;
      /** INT-02 e: extra seconds for every visit already made in the current day. */
      increase?: number;
      autoContinue?: boolean;
      /** INT-02 b: what happens to the countdown when the page loses focus. */
      onBlur?: 'pause' | 'restart' | 'ignore';
      hideCountdown?: boolean;
      grant: GrantSpec;
    }
  | {
      type: 'challenge';
      kind: ChallengeKind;
      length?: number;
      charset?: Charset;
      phrase?: string;
      grant: GrantSpec;
    }
  | { type: 'block' }
  | { type: 'close' }
  | { type: 'redirect'; url: string };

export interface Policy {
  id: string;
  schedule: Schedule;
  /** When present the policy applies only once the budget is used up (LIM-09). */
  budget?: Budget;
  intervention: Intervention;
}

// ---------------------------------------------------------------------------
// Costs and pauses (BRK)
// ---------------------------------------------------------------------------

export type Cost =
  | { type: 'none' }
  | { type: 'confirm' }
  | { type: 'delay'; seconds: number }
  | { type: 'challenge'; kind: ChallengeKind; length?: number; phrase?: string }
  | { type: 'password' };

export type PauseScope = 'page' | 'site' | 'group' | 'all';

export interface PausePolicy {
  allowed: boolean;
  /** BRK-01: pauses allowed while a focus session involving the group is active. */
  duringSessions: boolean;
  scopes: PauseScope[];
  duration: { mode: 'fixed' | 'upTo' | 'choices'; minutes: number; choices?: number[] };
  /** BRK-04: per group budget. */
  limit: { count?: number; minutes?: number; period: Period };
  cost: Cost;
  reason: 'none' | 'optional' | 'required';
  /** BRK-08: minutes are consumed only while actually on the site. */
  metered: boolean;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type ProtectionLevel = 'soft' | 'balanced' | 'strict' | 'locked';

export interface GroupOptions {
  /** MAT-19: which windows the group applies to. */
  privacy: 'all' | 'normal' | 'private';
  /** MAT-13: block embedded frames of the group's sites while it blocks. */
  embeds: boolean;
  /** ENF-02: which open tabs are handled immediately on a state change. */
  tabs: 'all' | 'active' | 'inactive';
  /** NOT-01 */
  timer: boolean;
  /** Included in quick focus sessions started from the popup. */
  quickSession: boolean;
}

export interface Group extends Versioned {
  name: string;
  color: string;
  icon: string;
  /** MOT-01: "why" note shown in interventions. */
  note: string;
  /** INT-07: custom multi-line message on the block page. */
  message: string;
  enabled: boolean;
  archived: boolean;
  targets: Target[];
  /** Shared lists linked to this group (MAT-18). */
  lists: string[];
  policies: Policy[];
  pause: PausePolicy;
  /** PRO-16: per-group protection level; null = use the global level. */
  protection: ProtectionLevel | null;
  /** For a per-group 'locked' level: until when (ms epoch). */
  protectionUntil?: number | null;
  options: GroupOptions;
}

export interface SharedList extends Versioned {
  name: string;
  targets: Target[];
}

export interface Tombstone {
  id: string;
  kind: 'group' | 'list';
  deletedAt: number;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Alternative {
  id: string;
  label: string;
  url?: string;
}

export interface AccessRequirements {
  /** PBKDF2 hash ("pbkdf2-sha256$iterations$salt$hash"), never the password itself. */
  passwordHash: string | null;
  /** Length of a random code to type (0 = none). */
  codeLength: number;
  /** No weakening possible during these windows. */
  lockWindows: TimeWindow[];
}

export interface ProtectionSettings {
  level: ProtectionLevel;
  /** For 'locked': until when (ms epoch). After it the level falls back to `fallback`. */
  lockedUntil: number | null;
  fallback: Exclude<ProtectionLevel, 'locked'>;
  /** PRO-03 cooling-off, hours (1–168). */
  coolingOffHours: number;
  /** Hours to confirm a ready pending change before it expires. */
  confirmHours: number;
  /** Seconds to wait for a weakening change at the Balanced level. */
  balancedDelaySeconds: number;
  /** Characters to type when confirming a change at the Strict level. */
  challengeLength: number;
  /** PRO-08 */
  internalPages: 'auto' | 'never' | 'always';
  /** PRO-08: pauses also unlock the browser's internal pages. */
  internalPagesFollowPause: boolean;
  access: AccessRequirements;
  /** PRO-15: hours to wait for the emergency exit (4–168). */
  emergencyHours: number;
}

export interface Settings {
  language: string; // 'auto' or a locale code
  theme: 'system' | 'light' | 'dark';
  highContrast: boolean;
  accent: string;
  hour12: 'auto' | '12' | '24';
  dateFormat: 'auto' | 'iso';
  /** 0 = Sunday … 6 = Saturday */
  weekStart: number;
  /** SEM-09: minutes after midnight at which a day begins. */
  dayStart: number;
  advanced: boolean;
  timer: {
    enabled: boolean;
    thresholdMinutes: number;
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    size: 'small' | 'medium' | 'large';
    opacity: number;
  };
  badge: { enabled: boolean; thresholdMinutes: number };
  contextMenu: boolean;
  notifications: { enabled: boolean; sessionEnd: boolean; pendingReady: boolean; warning: boolean };
  /** NOT-03: seconds of warning before a restriction starts (0 = off). */
  warningSeconds: number;
  sound: boolean;
  tracking: {
    idleSeconds: number;
    idleEnabled: boolean;
    countAudio: boolean;
    /** TIM-01 option: count open tabs of a group even when they are not active. */
    countInactive: boolean;
    /** SEM-08: minutes without activity that end a visit. */
    visitGapMinutes: number;
    /** STA-01 opt-in */
    allSites: boolean;
    /** Days of daily statistics kept. */
    retentionDays: number;
  };
  interventions: {
    hideUrl: boolean;
    customCss: string;
    alternatives: Alternative[];
    /** INT-13 */
    graceSeconds: number;
    autoReopen: boolean;
  };
  /** BRK-04 global pause budget. */
  pauseLimit: { count?: number; minutes?: number; period: Period };
  protection: ProtectionSettings;
  later: { notify: boolean };
  diagnostics: { decisionLog: boolean };
  clock: { useDateHeaders: boolean };
  onboarded: boolean;
}

export interface Config {
  schema: number;
  groups: Group[];
  lists: SharedList[];
  allowlist: Target[];
  settings: Settings;
  tombstones: Tombstone[];
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface Grant {
  id: string;
  /** pause = BRK; pass = after a delay/ask/challenge; recheck = DNR hint for an already allowed URL. */
  kind: 'pause' | 'pass' | 'recheck';
  /** Group ids, or '*' for all groups that allow pauses. */
  groups: string[] | '*';
  scope: 'page' | 'site' | 'group' | 'all';
  /** Normalised URL without fragment (page scope). */
  url?: string;
  /** Site key (site scope). */
  site?: string;
  createdAt: number;
  until?: number;
  /** Metered pauses: seconds left. */
  remaining?: number;
  /** Ends with the visit. */
  visit?: boolean;
  /** Highest intervention severity this grant lets through. */
  severity: number;
  intention?: string;
  reason?: string;
  /** LIM-06 */
  cooldownMinutes?: number;
  warned?: boolean;
  minutes?: number;
}

export interface FocusSession {
  id: string;
  kind: 'groups' | 'allowlist';
  groups: string[];
  allow: Target[];
  startAt: number;
  endAt: number;
  createdAt: number;
  /** FOC-03 */
  locked: boolean;
  /** FOC-09 */
  noPauses: boolean;
  /** Summary notified (FOC-07). */
  notified?: boolean;
}

export interface Cooldown {
  until: number;
  group: string;
  site?: string;
  /** 'session' = LIM-05 (the policy applies), 'ask' = LIM-06 (block). */
  kind: 'session' | 'ask';
  policy?: string;
}

export interface Activity {
  /** Last time active time was credited. */
  last: number;
  /** Start of the current visit. */
  visitStart: number;
  /** Active seconds in the current visit. */
  visitSeconds: number;
  /** Continuous use in seconds for session budgets (LIM-05); reset by a cool-down. */
  run: number;
}

export interface PendingChange {
  id: string;
  createdAt: number;
  readyAt: number;
  expiresAt: number;
  units: import('./changes').ChangeUnit[];
}

export interface EmergencyState {
  requestedAt: number;
  readyAt: number;
}

export interface PauseRecord {
  at: number;
  groups: string[] | '*';
  scope: PauseScope;
  minutes: number;
  reason?: string;
  grantId: string;
  used?: number;
}

export interface TamperEvent {
  at: number;
  kind:
    | 'clock-backward'
    | 'clock-skew'
    | 'state-restored'
    | 'host-permission'
    | 'private-access'
    | 'inactive-gap'
    | 'rules-mismatch'
    | 'emergency';
  detail?: string;
}

export interface RuntimeState {
  grants: Grant[];
  sessions: FocusSession[];
  pending: PendingChange[];
  cooldowns: Record<string, Cooldown>;
  /** LIM-11: policy key → end of the forfeited period. */
  forfeits: Record<string, number>;
  activity: Record<string, Activity>;
  emergency: EmergencyState | null;
  pauses: PauseRecord[];
  tamper: TamperEvent[];
  /** Highest wall clock time seen (SCH-07). */
  lastWall: number;
  /** Trusted clock correction in ms (SCH-07), 0 when the clock looks right. */
  clockOffset: number;
  /** Last time the extension was seen alive (PRO-13). */
  lastAlive: number;
}

// ---------------------------------------------------------------------------
// Usage (statistics and budgets)
// ---------------------------------------------------------------------------

/** Per logical day: key → [seconds, visits]. Keys: g:<group>, s:<group>:<site>, h:<host>. */
export interface DayRecord {
  t: Record<string, [number, number]>;
  /** Counters: e.g. "shown:<group>", "proceeded:<group>", "left:<group>", "pause:<group>". */
  c: Record<string, number>;
}

/** Minute buckets for the last 48 hours: key → minute index → [seconds, visits]. */
export type MinuteBuckets = Record<string, Record<string, [number, number]>>;

export interface LaterItem {
  id: string;
  url: string;
  title: string;
  groupId?: string;
  savedAt: number;
}
