/**
 * View models exchanged between the background (single source of truth) and the UI
 * surfaces. Everything here is plain JSON.
 */

import type { ChangeUnit } from '../engine/changes';
import type {
  Config,
  Cost,
  EmergencyState,
  FocusSession,
  Grant,
  Intervention,
  InterventionType,
  LaterItem,
  PauseScope,
  PendingChange,
  Period,
  Protection,
  TamperEvent,
  Target,
} from '../engine/types';

export interface BudgetView {
  policyId: string;
  type: 'time' | 'visits' | 'session';
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  periodEnd: number;
  refillAt: number | null;
  perSite: boolean;
  periodKind?: string;
}

export interface PolicyView {
  index: number;
  id: string;
  scheduleActive: boolean;
  active: boolean;
  budget: BudgetView | null;
  intervention: Intervention;
}

export interface GroupDecisionView {
  groupId: string;
  name: string;
  color: string;
  icon: string;
  note: string;
  message: string;
  entry: Pick<Target, 'type' | 'value' | 'allow'>;
  site: string;
  policyIndex: number;
  base: Intervention;
  intervention: Intervention;
  source: 'policy' | 'session' | 'cooldown' | 'none';
  policies: PolicyView[];
  pause: Pick<Grant, 'id' | 'until' | 'remaining' | 'scope'> | null;
  pass: Pick<Grant, 'id' | 'until' | 'visit' | 'intention' | 'scope'> | null;
  pausable: boolean;
  cooldownUntil: number | null;
}

export interface RestrictionView {
  at: number;
  kind: 'budget' | 'schedule' | 'pause' | 'pass' | 'session';
  intervention: Intervention;
  groupId: string | null;
}

export interface DecisionView {
  url: string;
  host: string;
  exempt: boolean;
  severity: number;
  intervention: Intervention;
  source: 'policy' | 'session' | 'cooldown' | 'none';
  primary: GroupDecisionView | null;
  session: Pick<FocusSession, 'id' | 'kind' | 'endAt' | 'locked'> | null;
  groups: GroupDecisionView[];
  excepted: { groupId: string; name: string; entry: Pick<Target, 'type' | 'value' | 'allow'> }[];
  until: number | null;
  next: Intervention | null;
  restriction: RestrictionView | null;
}

export type WarningKind =
  | 'host-permission'
  | 'incognito'
  | 'restored'
  | 'dnr-overflow'
  | 'dnr-error'
  | 'tamper'
  | 'pending-ready'
  | 'locked-out'
  | 'clock';

export interface Warning {
  kind: WarningKind;
  at?: number;
  detail?: string;
}

export interface GroupStatus {
  id: string;
  name: string;
  color: string;
  icon: string;
  enabled: boolean;
  archived: boolean;
  siteCount: number;
  intervention: Intervention | null;
  source: 'policy' | 'session' | 'cooldown' | 'none';
  until: number | null;
  next: Intervention | null;
  budgets: BudgetView[];
  pause: { until?: number; remaining?: number } | null;
  /** The rule's protection now (after its date, Locked asks only for a reminder). */
  protection: Protection;
  /** Loosening refused right now (Locked or Permanent). */
  lockedNow: boolean;
  /** Upcoming changes for this group. */
  nextChange: { at: number; intervention: Intervention } | null;
}

export interface UpcomingChange {
  at: number;
  groupId: string | null;
  label: 'starts' | 'ends' | 'session-start' | 'session-end';
  intervention: Intervention | null;
}

export interface TodayStats {
  seconds: number;
  shown: number;
  proceeded: number;
  impulses: number;
  pauses: number;
  sessions: number;
}

export interface Overview {
  now: number;
  groups: GroupStatus[];
  sessions: FocusSession[];
  upcoming: UpcomingChange[];
  today: TodayStats;
  pending: PendingChange[];
  warnings: Warning[];
  emergency: EmergencyState | null;
  restorable: number;
  laterCount: number;
  pauses: Grant[];
}

export interface ConfigModel {
  config: Config;
  now: number;
  /** The protection now and the current lock state per group. */
  groups: Record<string, { protection: Protection; lockedNow: boolean; activeNow: boolean }>;
  platform: { android: boolean; firefox: boolean; contextMenus: boolean; commands: boolean };
}

export interface PauseOptions {
  available: boolean;
  /** i18n key explaining why a pause is not available. */
  reason?: string;
  groups: { id: string; name: string }[];
  scopes: PauseScope[];
  duration: { mode: 'fixed' | 'upTo' | 'choices'; minutes: number; choices?: number[] };
  /** Cost of every group covered, all of them to pay (strictest first); empty when free. */
  costs: Cost[];
  reasonMode: 'none' | 'optional' | 'required';
  remainingCount: number | null;
  remainingMinutes: number | null;
  /** Periods of the limits the remaining breaks and minutes come from ("3 breaks left today"). */
  countPeriod: Period | null;
  minutesPeriod: Period | null;
  metered: boolean;
  site: string | null;
  url: string | null;
  /** Window context the options were computed for (groups limited to private/normal windows). */
  incognito: boolean | null;
  /** Options of the "all" scope, which also covers the groups that are not on this page. */
  all?: PauseOptions;
  /**
   * A break already lets the page through: these are the options of extending it (no break is
   * counted), with the minutes it has been taken for so far.
   */
  extend?: { grantId: string; scope: PauseScope; minutes: number };
}

export interface PauseRequest {
  url?: string;
  incognito?: boolean | null;
  groupId?: string;
  scope: PauseScope;
  minutes: number;
  reason?: string;
  /** The running break to extend. */
  extend?: string;
}

export type StepView =
  | { type: 'confirm' }
  | { type: 'wait'; seconds: number; readyAt: number }
  | { type: 'text'; text: string; length: number }
  | { type: 'phrase'; phrase: string }
  | { type: 'math'; question: string }
  /** The password of the rules named. */
  | { type: 'rulePassword'; names: string[] }
  /** The code of the partner of the rules named. */
  | { type: 'partner'; names: string[] }
  | { type: 'reason'; required: boolean }
  | {
      type: 'intention';
      choices: number[];
      maxMinutes: number;
      seconds: number;
      readyAt: number;
    };

export type TicketPurposeKind = 'units' | 'pending' | 'pause' | 'pass' | 'session.end' | 'emergency.complete';

export interface TicketView {
  id: string;
  purpose: TicketPurposeKind;
  step: StepView;
  stepIndex: number;
  stepCount: number;
  /** Descriptions of what the ticket will do (units). */
  units?: ChangeUnit[];
}

export type TicketAnswer =
  | { status: 'next'; ticket: TicketView }
  | { status: 'done'; result?: unknown }
  | { status: 'error'; error: string; ticket?: TicketView };

/** A new partner secret to show once, until the first code confirms it. */
export interface PartnerSetup {
  /** The secret in base32, for apps where it is typed. */
  secret: string;
  /** The otpauth:// address that the QR code holds. */
  uri: string;
  /** After this time the setup has to start again. */
  expiresAt: number;
}

export interface SaveResult {
  applied: ChangeUnit[];
  ticket: TicketView | null;
  pending: PendingChange | null;
  refused: {
    units: ChangeUnit[];
    reason: 'permanent' | 'locked';
    until?: number | null;
  } | null;
  /** Problems found while normalising (imports). */
  errors?: string[];
}

export interface InterventionModel {
  url: string;
  host: string;
  kind:
    | 'block'
    | 'delay'
    | 'ask'
    | 'challenge'
    | 'close'
    | 'redirect'
    | 'session'
    | 'cooldown'
    | 'internal'
    | 'allow'
    | 'selftest';
  decision: DecisionView | null;
  group: { id: string; name: string; color: string; note: string; message: string } | null;
  /** The other rules that restrict the page too, each shown once this one lets it through. */
  others: { id: string; name: string; color: string }[];
  until: number | null;
  ticket: TicketView | null;
  pause: PauseOptions | null;
  hideUrl: boolean;
  customCss: string;
  redirectUrl: string | null;
  hour12: 'auto' | '12' | '24';
  locked: boolean;
  /** Seconds of grace not applicable here; kept for symmetry. */
  canSaveLater: boolean;
}

export interface PopupModel {
  tab: { id: number; url: string; host: string; title: string; incognito: boolean } | null;
  decision: DecisionView | null;
  groups: { id: string; name: string; color: string }[];
  sessions: FocusSession[];
  today: TodayStats;
  pause: PauseOptions | null;
  activePauses: Grant[];
  restorable: number;
  pendingReady: number;
  warnings: Warning[];
  laterCount: number;
  canAdd: boolean;
  /** A quick focus session has rules to apply: otherwise it would block nothing. */
  canFocus: boolean;
  quickMinutes: number[];
  onboarded: boolean;
}

export interface SessionRequest {
  kind: 'groups' | 'allowlist';
  groups: string[];
  allow: Target[];
  minutes?: number;
  until?: number;
  startInMinutes?: number;
  locked: boolean;
  noPauses: boolean;
}

export interface StatsDay {
  day: string;
  seconds: number;
  visits: number;
  /** Seconds per site of `StatsModel.stack`, in the same order. */
  sites: number[];
  /** Seconds on the other sites. */
  otherSites: number;
}

export interface StatsModel {
  from: string;
  to: string;
  days: StatsDay[];
  total: { seconds: number; visits: number };
  previous: { seconds: number; visits: number };
  groups: { id: string; name: string; color: string; seconds: number; visits: number }[];
  sites: { host: string; seconds: number; visits: number }[];
  /** The sites with the most time in the period, which the days split their time by. */
  stack: string[];
  counters: {
    shown: number;
    proceeded: number;
    left: number;
    pauses: number;
    pauseMinutes: number;
    sessions: number;
    impulses: number;
  };
  pauses: {
    at: number;
    groups: string[];
    scope: PauseScope;
    site?: string;
    url?: string;
    minutes: number;
    reason?: string;
    used?: number;
  }[];
  intentions: { at: number; groupId: string; text: string; minutes: number }[];
  /**
   * Seconds on limited sites per clock hour (index 0 to 23), or null when a day of the period
   * has time but no hours (recorded before they were kept).
   */
  hours: number[] | null;
}

export interface DiagModel {
  version: string;
  browser: string;
  rules: {
    dynamic: number;
    regex: number;
    redirects: number;
    limits: { regex: number; unsafe: number; total: number };
    overflow: string[];
    lastError: string | null;
    lastCompileMs: number;
  };
  permissions: { hostAccess: boolean; incognito: boolean; notifications: boolean };
  log: DecisionLogEntry[];
  counters: Record<string, number>;
  storageBytes: number | null;
  tamper: TamperEvent[];
  invalidTargets: string[];
}

export interface DecisionLogEntry {
  at: number;
  where: 'navigation' | 'tab' | 'page' | 'dnr' | 'internal';
  url: string;
  intervention: InterventionType;
  group?: string;
}

export interface LaterModel {
  /** `availableAt`: when the page opens again; null when the current rules never let it. */
  items: (LaterItem & { allowedNow: boolean; availableAt: number | null })[];
}

export interface ImportPreview {
  format: 'webhandbrake' | 'list' | 'unknown';
  groups: { name: string; sites: number; policies: number }[];
  warnings: string[];
  errors: string[];
  units: ChangeUnit[];
  directions: ('strengthen' | 'neutral' | 'weaken')[];
}

export interface TickResponse {
  tracked: boolean;
  /** Overlay timer. */
  timer: {
    seconds: number;
    label: string;
    color: string;
    kind: 'budget' | 'pause' | 'pass' | 'schedule' | 'session';
  } | null;
  filter: { css: string; mute: boolean } | null;
  intention: { text: string; until: number | null } | null;
  warning: { id: string; seconds: number; text: string } | null;
  settings: {
    timer: Config['settings']['timer'];
    showTimer: boolean;
    graceSeconds: number;
    idleSeconds: number;
    idleEnabled: boolean;
    countAudio: boolean;
    countInactive: boolean;
    sound: boolean;
  };
  labels?: Record<string, string>;
}
