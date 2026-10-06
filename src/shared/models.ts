/**
 * View models exchanged between the background (single source of truth, PRO-14) and the UI
 * surfaces. Everything here is plain JSON.
 */

import type { ChangeUnit } from '../engine/changes';
import type {
  Alternative,
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
  ProtectionLevel,
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
  kind: 'budget' | 'schedule' | 'grant' | 'session';
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
  allowlisted: Pick<Target, 'type' | 'value'> | null;
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
  level: ProtectionLevel;
  /** PRO-04: weakening refused right now (Strict level while active). */
  lockedNow: boolean;
  /** SEM-07 upcoming changes for this group. */
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
  level: ProtectionLevel;
  lockedUntil: number | null;
  emergency: EmergencyState | null;
  restorable: number;
  laterCount: number;
  pauses: Grant[];
}

export interface ConfigModel {
  config: Config;
  now: number;
  /** Effective level and current lock state per group. */
  groups: Record<string, { level: ProtectionLevel; lockedNow: boolean; activeNow: boolean }>;
  globalLockedNow: boolean;
  hasPassword: boolean;
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
  metered: boolean;
  site: string | null;
  url: string | null;
  /** Window context the options were computed for (groups limited to private/normal windows). */
  incognito: boolean | null;
  /** Options of the "all" scope, which also covers the groups that are not on this page. */
  all?: PauseOptions;
}

export interface PauseRequest {
  url?: string;
  incognito?: boolean | null;
  groupId?: string;
  scope: PauseScope;
  minutes: number;
  reason?: string;
}

export type StepView =
  | { type: 'confirm' }
  | { type: 'wait'; seconds: number; readyAt: number }
  | { type: 'text'; text: string; length: number }
  | { type: 'phrase'; phrase: string }
  | { type: 'math'; question: string }
  | { type: 'password' }
  | { type: 'reason'; required: boolean }
  | {
      type: 'intention';
      choices: number[];
      maxMinutes: number;
      requireIntention: boolean;
      seconds: number;
      readyAt: number;
    };

export type TicketPurposeKind =
  | 'units'
  | 'pending'
  | 'pause'
  | 'pass'
  | 'session.end'
  | 'emergency.complete'
  | 'password';

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

export interface SaveResult {
  applied: ChangeUnit[];
  ticket: TicketView | null;
  pending: PendingChange | null;
  refused: {
    units: ChangeUnit[];
    reason: 'locked' | 'lockedNow' | 'accessWindow';
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
  until: number | null;
  ticket: TicketView | null;
  pause: PauseOptions | null;
  alternatives: Alternative[];
  hideUrl: boolean;
  customCss: string;
  redirectUrl: string | null;
  hour12: 'auto' | '12' | '24';
  locked: boolean;
  /** Seconds of grace (INT-13) not applicable here; kept for symmetry. */
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
  /** A quick focus session has rules to apply (FOC-01): otherwise it would block nothing. */
  canFocus: boolean;
  quickMinutes: number[];
  onboarded: boolean;
  /** Global protection level (shown in the popup header). */
  level: ProtectionLevel;
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
}

export interface StatsModel {
  from: string;
  to: string;
  days: StatsDay[];
  total: { seconds: number; visits: number };
  previous: { seconds: number; visits: number };
  groups: { id: string; name: string; color: string; seconds: number; visits: number }[];
  sites: { host: string; seconds: number; visits: number }[];
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
    minutes: number;
    reason?: string;
    used?: number;
  }[];
  intentions: { at: number; groupId: string; text: string; minutes: number }[];
  hours: number[];
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
  items: (LaterItem & { allowedNow: boolean })[];
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
  /** Overlay timer (NOT-01). */
  timer: {
    seconds: number;
    label: string;
    color: string;
    kind: 'budget' | 'grant' | 'schedule' | 'session';
  } | null;
  filter: { css: string; mute: boolean } | null;
  remind: { id: string; group: string; color: string; note: string; message: string } | null;
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
