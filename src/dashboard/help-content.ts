/**
 * The structure of the Help page (ONB-06): its topics, the blocks of each topic, the address
 * syntax table and the keyboard shortcuts. src/dashboard/pages/help.tsx renders it.
 *
 * This module is pure: it imports only engine modules and types, so that Node scripts can bundle
 * it. Every message key is written as a complete string literal, never built from a template, so
 * that scripts/check-i18n.mjs finds it.
 *
 * A default or a limit that a Help string mentions is an ICU parameter filled from helpFacts(),
 * never a number typed in the string. A block whose messages have placeholders declares them in
 * `params` (tests/unit/help-content.test.ts checks both directions).
 *
 * A question block is a heading and its answer, keyed `help.faq.<id>.q` and `help.faq.<id>.a`
 * whatever its topic. The topics are documented in this order in docs/user-guide.md, which
 * `npm run docs` generates from this module.
 */

import { defaultConfig } from '../engine/defaults';
import {
  BUDGET_KEEP_DAYS,
  DAILY_SNAPSHOTS,
  DEFAULT_SESSION_MINUTES,
  MINUTE_RETENTION_MINUTES,
  RECENT_SNAPSHOTS,
} from '../engine/limits';

/** The numbers the Help strings can use: defaults (not the user's settings) and limits. */
export interface HelpFacts {
  /** Wait before the emergency exit can be completed. */
  emergencyHours: number;
  /** Cooling-off period of a pending change (Strict). */
  coolingOffHours: number;
  /** Time to confirm a pending change once its cooling-off period is over. */
  confirmHours: number;
  /** Wait that a loosening costs at the Balanced level. */
  balancedSeconds: number;
  /** Time away after which coming back to a site starts a new visit. */
  visitGapMinutes: number;
  /** Inactivity after which time stops being counted. */
  idleSeconds: number;
  /** Grace period to finish typing before a page is replaced. */
  graceSeconds: number;
  /** How long statistics are kept. */
  retentionDays: number;
  /** When a day starts, as HH:MM. */
  dayStart: string;
  /** Days of totals kept for limits when statistics are deleted. */
  budgetKeepDays: number;
  /** Hours of minute counters kept for hourly and rolling limits. */
  minuteHours: number;
  /** Automatic backups kept from the most recent changes. */
  backupsRecent: number;
  /** Automatic backups kept one per day. */
  backupsDaily: number;
  /** Length of a focus session started with the keyboard shortcut. */
  sessionMinutes: number;
}

export function helpFacts(): HelpFacts {
  const s = defaultConfig().settings;
  const hhmm = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return {
    emergencyHours: s.protection.emergencyHours,
    coolingOffHours: s.protection.coolingOffHours,
    confirmHours: s.protection.confirmHours,
    balancedSeconds: s.protection.balancedDelaySeconds,
    visitGapMinutes: s.tracking.visitGapMinutes,
    idleSeconds: s.tracking.idleSeconds,
    graceSeconds: s.interventions.graceSeconds,
    retentionDays: s.tracking.retentionDays,
    dayStart: hhmm(s.dayStart),
    budgetKeepDays: BUDGET_KEEP_DAYS,
    minuteHours: MINUTE_RETENTION_MINUTES / 60,
    backupsRecent: RECENT_SNAPSHOTS,
    backupsDaily: DAILY_SNAPSHOTS,
    sessionMinutes: DEFAULT_SESSION_MINUTES,
  };
}

/** The ICU parameters of a block's messages, computed from the facts. */
export type HelpParams = (f: HelpFacts) => Record<string, string | number>;

export type HelpBlock =
  /** A paragraph. */
  | { p: string; params?: HelpParams }
  /** A bullet list, one message per item. */
  | { list: string[]; params?: HelpParams }
  /** The address syntax table (SYNTAX). */
  | { syntax: true }
  /** A question (a heading) and its answer. */
  | { q: string; a: string; params?: HelpParams }
  /** The keyboard shortcuts (SHORTCUTS), where the browser has keyboard shortcuts. */
  | { shortcuts: true };

export interface HelpTopic {
  /** Stable ID: the section's HTML id is `help-<id>`. */
  id: string;
  /** Message key of the topic's title. */
  title: string;
  blocks: HelpBlock[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'start',
    title: 'help.start.title',
    blocks: [{ p: 'help.start.p1' }, { p: 'help.start.p2' }, { p: 'help.start.p3' }, { p: 'help.start.p4' }],
  },
  {
    id: 'groups',
    title: 'help.groups.title',
    blocks: [{ p: 'help.groups.p1' }, { p: 'help.groups.p2' }, { p: 'help.groups.p3' }, { syntax: true }],
  },
  {
    id: 'rules',
    title: 'help.rules.title',
    blocks: [
      { p: 'help.rules.p1' },
      { p: 'help.rules.p2' },
      { p: 'help.rules.p3', params: (f) => ({ minutes: f.visitGapMinutes }) },
      { p: 'help.rules.p4' },
      { q: 'help.faq.reset.q', a: 'help.faq.reset.a', params: (f) => ({ dayStart: f.dayStart }) },
    ],
  },
  {
    id: 'interventions',
    title: 'help.interventions.title',
    blocks: [
      { p: 'help.interventions.p1' },
      { p: 'help.interventions.p2' },
      { p: 'help.interventions.p3', params: (f) => ({ seconds: f.graceSeconds }) },
    ],
  },
  {
    id: 'choosing',
    title: 'help.choosing.title',
    blocks: [
      { p: 'help.choosing.p1' },
      { p: 'help.choosing.p2' },
      { p: 'help.choosing.p3' },
      { p: 'help.choosing.p4' },
    ],
  },
  {
    id: 'pauses',
    title: 'help.pauses.title',
    blocks: [{ p: 'help.pauses.p1' }, { p: 'help.pauses.p2' }],
  },
  {
    id: 'focus',
    title: 'help.focus.title',
    blocks: [{ p: 'help.focus.p1' }, { p: 'help.focus.p2', params: (f) => ({ seconds: f.balancedSeconds }) }],
  },
  {
    id: 'protection',
    title: 'help.protection.title',
    blocks: [
      { p: 'help.protection.p1' },
      {
        p: 'help.protection.p2',
        params: (f) => ({
          seconds: f.balancedSeconds,
          hours: f.coolingOffHours,
          confirmHours: f.confirmHours,
        }),
      },
      { p: 'help.protection.p3' },
      { p: 'help.protection.p4' },
      { q: 'help.faq.clock.q', a: 'help.faq.clock.a' },
    ],
  },
  {
    id: 'emergency',
    title: 'help.emergency.title',
    blocks: [
      { p: 'help.emergency.p1', params: (f) => ({ hours: f.emergencyHours }) },
      { p: 'help.emergency.p2' },
    ],
  },
  {
    id: 'insights',
    title: 'help.insights.title',
    blocks: [{ p: 'help.insights.p1' }, { p: 'help.insights.p2' }],
  },
  {
    id: 'data',
    title: 'help.data.title',
    blocks: [
      { p: 'help.data.p1' },
      { p: 'help.data.p2' },
      { p: 'help.data.p3', params: (f) => ({ recent: f.backupsRecent, daily: f.backupsDaily }) },
      { p: 'help.data.p4' },
      { q: 'help.faq.sync.q', a: 'help.faq.sync.a' },
      { q: 'help.faq.restored.q', a: 'help.faq.restored.a' },
    ],
  },
  {
    id: 'privacy',
    title: 'help.privacy.title',
    blocks: [
      { p: 'help.privacy.p1' },
      { p: 'help.privacy.p2', params: (f) => ({ days: f.retentionDays, keepDays: f.budgetKeepDays }) },
      { p: 'help.privacy.p3' },
      { p: 'help.privacy.p4' },
    ],
  },
  {
    id: 'limits',
    title: 'help.limits.title',
    blocks: [
      { p: 'help.limits.p1' },
      {
        list: [
          'help.limits.item1',
          'help.limits.item2',
          'help.limits.item3',
          'help.limits.item4',
          'help.limits.item5',
          'help.limits.item6',
          'help.limits.item7',
        ],
      },
      { p: 'help.limits.p2' },
      { q: 'help.faq.uninstall.q', a: 'help.faq.uninstall.a' },
      { q: 'help.faq.harden.q', a: 'help.faq.harden.a' },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'help.troubleshooting.title',
    blocks: [
      { p: 'help.troubleshooting.p1' },
      { p: 'help.troubleshooting.p2' },
      { q: 'help.faq.notApplied.q', a: 'help.faq.notApplied.a' },
      { q: 'help.faq.private.q', a: 'help.faq.private.a' },
      { q: 'help.faq.flash.q', a: 'help.faq.flash.a' },
      { q: 'help.faq.notCounted.q', a: 'help.faq.notCounted.a', params: (f) => ({ seconds: f.idleSeconds }) },
      { q: 'help.faq.locked.q', a: 'help.faq.locked.a' },
    ],
  },
  {
    id: 'accessibility',
    title: 'help.accessibility.title',
    blocks: [{ p: 'help.accessibility.p1' }, { p: 'help.accessibility.p2' }, { p: 'help.accessibility.p3' }],
  },
  {
    id: 'mobile',
    title: 'help.mobile.title',
    blocks: [{ p: 'help.mobile.p1' }, { p: 'help.mobile.p2' }],
  },
  {
    id: 'shortcuts',
    title: 'help.shortcuts',
    blocks: [{ shortcuts: true }, { p: 'help.shortcutsNote' }],
  },
];

/** The address syntax table: an example entry and the message key of its meaning. */
export const SYNTAX: [entry: string, meaningKey: string][] = [
  ['youtube.com', 'help.syntax.domain'],
  ['amazon.*', 'help.syntax.countries'],
  ['=m.youtube.com', 'help.syntax.host'],
  ['reddit.com/r/funny', 'help.syntax.path'],
  ['example.com/page$', 'help.syntax.page'],
  ['example.com/$', 'help.syntax.homepage'],
  ['reddit.com/r/*/comments/*', 'help.syntax.wildcard'],
  ['news.*/sport/**', 'help.syntax.doubleWildcard'],
  ['youtube.com/watch?list=*', 'help.syntax.query'],
  ['+reddit.com/r/rust', 'help.syntax.exception'],
  ['/^https?:\\/\\/(www\\.)?example\\.com\\/a+$/', 'help.syntax.regex'],
  ['# comment', 'help.syntax.comment'],
  ['||example.com^  ·  *://*.example.com/*', 'help.syntax.import'],
];

/**
 * The keyboard shortcuts listed in Help: a command of the manifest (`commands`) and the message key
 * that describes it. The key shown is the command's default (`suggested_key`), read from the
 * manifest; a command without a default key is not listed.
 */
export const SHORTCUTS: { command: string; description: string; params?: HelpParams }[] = [
  { command: '_execute_action', description: 'help.shortcut.popup' },
  {
    command: 'start-session',
    description: 'help.shortcut.focus',
    params: (f) => ({ minutes: f.sessionMinutes }),
  },
  { command: 'block-site', description: 'help.shortcut.block' },
];

/** The default key of a manifest command (`suggested_key`), or null when it has none. */
export function defaultShortcut(
  commands: Record<string, { suggested_key?: string | { default?: string } }> | undefined,
  command: string,
): string | null {
  const key = commands?.[command]?.suggested_key;
  return (typeof key === 'string' ? key : key?.default) || null;
}
