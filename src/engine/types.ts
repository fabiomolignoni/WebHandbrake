/**
 * WebHandbrake data model.
 *
 * Everything in this file is plain JSON-serialisable data. The model is designed to be
 * sync-ready: every top-level entity has a stable id, a revision counter and an
 * update timestamp, and deletions leave tombstones.
 */

export const SCHEMA_VERSION = 3;

export interface Versioned {
  id: string;
  rev: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/**
 * - domain:   the domain and all its subdomains (youtube.com → m.youtube.com, www.youtube.com…)
 * - host:     only this host (www. is treated as equivalent)
 * - path:     a path prefix (segment aware) — reddit.com/r/funny matches /r/funny and below
 * - page:     an exact page (query parameters listed in the value must be present)
 * - homepage: only the home page of the host
 * - wildcard: the whole address without scheme and www., * standing for any characters
 *             ("*news*": every address that contains "news"; "*": every website)
 * - regex:    a regular expression on the full URL (advanced)
 */
export type TargetType = 'domain' | 'host' | 'path' | 'page' | 'homepage' | 'wildcard' | 'regex';

export interface Target {
  id: string;
  type: TargetType;
  /** Canonical value, e.g. "youtube.com", "reddit.com/r/*\/comments", "^https?://…". */
  value: string;
  /** Exception ("allow") instead of a blocking entry. */
  allow?: boolean;
}

// ---------------------------------------------------------------------------
// Schedules, periods, budgets
// ---------------------------------------------------------------------------

/** A weekly recurring window. Times are minutes from midnight (0–1440). */
export interface TimeWindow {
  /** Weekdays of the (logical) day on which the window starts. 0 = Sunday … 6 = Saturday. */
  days: number[];
  start: number;
  /** End minute. end <= start means the window runs past midnight (overnight). 0–1440 = all day. */
  end: number;
}

export type ScheduleMode = 'always' | 'during';

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

/**
 * The period of a limit starts again every so often: an hour, a day, or a number of minutes or
 * days (`everyPeriod`), never shifted. Weeks, months, rolling windows and offsets are for the
 * limits of breaks.
 */
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
}

export type Budget = TimeBudget | VisitBudget;

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

export type InterventionType =
  | 'allow'
  | 'track'
  | 'filter'
  | 'ask'
  | 'delay'
  | 'challenge'
  | 'block'
  | 'redirect'
  | 'close';

export type FilterKind = 'grayscale' | 'blur' | 'fade' | 'invert' | 'sepia';

/** What access is granted after passing a delay, an intention question or a challenge. */
export interface GrantSpec {
  scope: 'page' | 'site' | 'group';
  /** 'visit': until the visit ends (no activity for the visit gap); 'minutes': fixed duration. */
  mode: 'visit' | 'minutes';
  minutes?: number;
}

export type ChallengeKind = 'random' | 'phrase' | 'math';

export type Intervention =
  | { type: 'allow' }
  | { type: 'track' }
  | { type: 'filter'; filter: FilterKind; intensity?: number }
  | {
      type: 'ask';
      /** The longest time that can be asked for; a few shorter ones are offered (`askChoices`). */
      maxMinutes: number;
      /** The shortest reason accepted, in characters (a reason is always required). */
      minReasonLength: number;
    }
  | {
      type: 'delay';
      seconds: number;
      /** Random duration between seconds and randomTo; never with `increase`. */
      randomTo?: number;
      /** Extra seconds for every pass already made in the current day; never with `randomTo`. */
      increase?: number;
      autoContinue?: boolean;
      /** What happens to the countdown when the page loses focus. */
      onBlur?: 'pause' | 'restart' | 'ignore';
      hideCountdown?: boolean;
      grant: GrantSpec;
    }
  | {
      type: 'challenge';
      kind: ChallengeKind;
      length?: number;
      phrase?: string;
      grant: GrantSpec;
    }
  | { type: 'block' }
  | { type: 'close' }
  | { type: 'redirect'; url: string };

/**
 * The condition of a rule and what happens when it applies: every time, at certain times, or once
 * a limit of time or visits is used up (then at all times: `schedule` is 'always').
 */
export interface Policy {
  id: string;
  schedule: Schedule;
  /** When present the policy applies only once the budget is used up. */
  budget?: Budget;
  intervention: Intervention;
}

// ---------------------------------------------------------------------------
// Costs and pauses
// ---------------------------------------------------------------------------

export type Cost =
  | { type: 'none' }
  | { type: 'confirm' }
  | { type: 'delay'; seconds: number }
  | { type: 'challenge'; kind: ChallengeKind; length?: number; phrase?: string }
  | { type: 'password' };

/** What a break covers. Breaks now cover their whole rules; the others are of earlier versions. */
export type PauseScope = 'page' | 'site' | 'group' | 'all';

/**
 * The breaks of a rule. A break covers the whole rule and can be ended before its time is up; a
 * focus session that involves the rule allows none.
 */
export interface PausePolicy {
  allowed: boolean;
  /** The longest a break can last. */
  maxMinutes: number;
  /** Per group budget. */
  limit: { count?: number; minutes?: number; period: Period };
  cost: Cost;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/**
 * What loosening a rule takes. Each rule has one protection: a reminder to
 * confirm, a wait, its password, its partner's code, nothing until a date, or nothing at all until
 * the emergency exit.
 */
export type Protection =
  | { kind: 'reminder' }
  /** Waits up to `WAIT_IN_DIALOG_SECONDS` are spent in the cost dialog; longer ones are pending changes. */
  | { kind: 'wait'; seconds: number }
  /** PBKDF2 hash of the rule's password, never the password itself. */
  | { kind: 'password'; hash: string }
  /** The partner's time-based code, and whether the rule's breaks need it too. */
  | { kind: 'partner'; secret: string; breaks: boolean }
  /** Until this time (ms epoch); afterwards the rule asks only for a reminder. */
  | { kind: 'locked'; until: number }
  /** Only the emergency exit ends it. */
  | { kind: 'permanent' };

export type ProtectionKind = Protection['kind'];

export interface GroupOptions {
  /** Which windows the group applies to. */
  privacy: 'all' | 'normal' | 'private';
  /** Block embedded frames of the group's sites while it blocks. */
  embeds: boolean;
  /** Which open tabs are handled immediately on a state change. */
  tabs: 'all' | 'active' | 'inactive';
  /** The on-page timer when little time is left. */
  timer: boolean;
  /** Included in quick focus sessions started from the popup. */
  quickSession: boolean;
}

/** A time-based code (RFC 6238) that a partner's authenticator app shows. */
export type PartnerCode = Extract<Protection, { kind: 'partner' }>;

export interface Group extends Versioned {
  name: string;
  color: string;
  icon: string;
  /** The "why" note shown in interventions. */
  note: string;
  /** Custom multi-line message on the block page. */
  message: string;
  enabled: boolean;
  archived: boolean;
  targets: Target[];
  /** The rule's one condition: a list in the stored format, which had several before schema 3. */
  policies: Policy[];
  pause: PausePolicy;
  /** What loosening the rule takes (#12: there is no global level any more). */
  protection: Protection;
  options: GroupOptions;
}

export interface Tombstone {
  id: string;
  kind: 'group';
  deletedAt: number;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface ProtectionSettings {
  /** Hours to confirm a ready pending change before it expires. */
  confirmHours: number;
  /** When the browser's extension and settings pages are blocked. */
  internalPages: 'auto' | 'never' | 'always';
  /** Pauses also unlock the browser's internal pages. */
  internalPagesFollowPause: boolean;
  /** Hours to wait for the emergency exit (4–168). */
  emergencyHours: number;
}

export interface Settings {
  language: string; // 'auto' or a locale code
  theme: 'system' | 'light' | 'dark';
  highContrast: boolean;
  hour12: 'auto' | '12' | '24';
  dateFormat: 'auto' | 'iso';
  /** 0 = Sunday … 6 = Saturday */
  weekStart: number;
  /** Minutes after midnight at which a day begins. */
  dayStart: number;
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
  /** Seconds of warning before a restriction starts (0 = off). */
  warningSeconds: number;
  sound: boolean;
  tracking: {
    idleSeconds: number;
    idleEnabled: boolean;
    countAudio: boolean;
    /** Count open tabs of a group even when they are not active. */
    countInactive: boolean;
    /** Minutes without activity that end a visit. */
    visitGapMinutes: number;
    /** Track time on all sites, not only on the sites of rules. */
    allSites: boolean;
    /** Days of daily statistics kept. */
    retentionDays: number;
  };
  interventions: {
    hideUrl: boolean;
    customCss: string;
    /** Grace period when a restriction starts while the person is typing. */
    graceSeconds: number;
    autoReopen: boolean;
  };
  /** Global pause budget. */
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
  settings: Settings;
  tombstones: Tombstone[];
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface Grant {
  id: string;
  /** pause = a break; pass = after a delay/ask/challenge; recheck = DNR hint for an already allowed URL. */
  kind: 'pause' | 'pass' | 'recheck';
  /** Group ids, or '*' for all groups that allow pauses. */
  groups: string[] | '*';
  scope: 'page' | 'site' | 'group' | 'all';
  /** Normalised URL without fragment (page scope). */
  url?: string;
  /** Pass: the page it was given on (normalised URL without fragment). */
  from?: string;
  /** Site key (site scope). */
  site?: string;
  createdAt: number;
  until?: number;
  /** Ends with the visit. */
  visit?: boolean;
  /**
   * A visit that no tab shows since a tab went to another page: when, and that tab. It ends unless
   * a tab shows it again within VISIT_RETURN_MS, or at once when that tab is closed.
   */
  leftAt?: number;
  leftTab?: number;
  /** Highest intervention severity this grant lets through. */
  severity: number;
  intention?: string;
  minutes?: number;
}

/** What a focus session blocks: the sites of some rules, the sites of a list, or every site but those of a list. */
export type FocusKind = 'groups' | 'blocklist' | 'allowlist';

export interface FocusSession {
  id: string;
  kind: FocusKind;
  groups: string[];
  allow: Target[];
  /** The sites a blocklist session blocks, exceptions included (sessions of earlier versions have none). */
  block?: Target[];
  startAt: number;
  endAt: number;
  createdAt: number;
  /** Cannot be interrupted: only the emergency exit ends it early. */
  locked: boolean;
  /** No breaks during the session. */
  noPauses: boolean;
  /** Summary notified. */
  notified?: boolean;
  /** Pages it stopped (for the summary). */
  stopped?: number;
}

/** A visit ends after the visit gap without activity. */
export interface Activity {
  /** Last time active time was credited. */
  last: number;
}

export interface PendingChange {
  id: string;
  createdAt: number;
  readyAt: number;
  expiresAt: number;
  units: import('./changes').ChangeUnit[];
  /**
   * Waits as long as the emergency exit and is confirmed with a sentence, whatever the protections
   * of the rules: a restore, an import or a reset, or a setting of the protection itself.
   */
  emergency?: boolean;
  /** "Ready to confirm" notified. */
  notified?: boolean;
}

export interface EmergencyState {
  requestedAt: number;
  readyAt: number;
}

export interface PauseRecord {
  at: number;
  groups: string[] | '*';
  scope: PauseScope;
  /** The site (site scope) or page (page scope) of the break. */
  site?: string;
  url?: string;
  minutes: number;
  /** The reason given, when breaks of earlier versions asked for one. */
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
  /** Policy key → end of the forfeited period. */
  forfeits: Record<string, number>;
  activity: Record<string, Activity>;
  emergency: EmergencyState | null;
  pauses: PauseRecord[];
  tamper: TamperEvent[];
  /** Highest wall clock time seen. */
  lastWall: number;
  /** Trusted clock correction in ms, 0 when the clock looks right. */
  clockOffset: number;
  /** Last time the extension was seen alive. */
  lastAlive: number;
  /**
   * The last time step accepted for each partner secret (by its first characters), so that
   * a code works once.
   */
  partnerSteps: Record<string, number>;
  /** Wrong passwords and partner codes in a row, across tickets, and the lock they caused. */
  secretFailures: { count: number; lockedUntil: number };
}

// ---------------------------------------------------------------------------
// Usage (statistics and budgets)
// ---------------------------------------------------------------------------

/** Per logical day: key → [seconds, visits]. Keys: g:<group>, s:<group>:<site>, h:<host>. */
export interface DayRecord {
  t: Record<string, [number, number]>;
  /** Counters: e.g. "shown:<group>", "offered:<group>", "took:<group>", "proceeded:<group>", "pausedIn:<group>", "left:<group>", "pause:<group>". */
  c: Record<string, number>;
  /** Seconds of the a: total (time on limited sites) per clock hour, "0" to "23". */
  h?: Record<string, number>;
}

/** Minute buckets for the last 48 hours: key → minute index → [seconds, visits]. */
export type MinuteBuckets = Record<string, Record<string, [number, number]>>;

/** The lists of the Focus page, kept from one session to the next. */
export interface FocusLists {
  /** What to block, as last chosen on Focus. */
  kind: FocusKind;
  block: Target[];
  allow: Target[];
}

export interface LaterItem {
  id: string;
  url: string;
  title: string;
  groupId?: string;
  savedAt: number;
}
