import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { planSentence, rulePlan, sitesPhrase } from '../../src/dashboard/plan';
import type { ChangeUnit } from '../../src/engine/changes';
import { defaultIntervention, delayIntervention, withCountingGap } from '../../src/engine/defaults';
import type { Intervention, Period, Policy, TimeWindow } from '../../src/engine/types';

import { setFormatPrefs } from '../../src/shared/format';
import {
  describeBudget,
  describeDays,
  describeIntervention,
  describePeriod,
  describeRange,
  describeSchedule,
  describeTarget,
  describeUnit,
  describeWindows,
  settingLabel,
  setWeekStart,
  summarizeGroup,
} from '../../src/shared/summary';
import { BLOCK, group, t as target } from './helpers';

beforeAll(() => setFormatPrefs({ hour12: '24', dateFormat: 'auto' }));
afterEach(() => setWeekStart(1));

type DelayIntervention = Extract<Intervention, { type: 'delay' }>;

const office: TimeWindow = { days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 };

describe('days and times in words', () => {
  it('names the usual sets of days, and runs of three or more days', () => {
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(describeDays([])).toBe('No days');
    expect(describeDays([5, 4, 3, 2, 1])).toBe('Mon–Fri');
    expect(describeDays([6, 0])).toBe('Weekends');
    expect(describeDays([1, 2, 3, 5])).toBe('Mon–Wed, Fri');
    expect(describeDays([1, 3])).toBe('Mon, Wed');
  });

  it('follows the first day of the week', () => {
    setWeekStart(0);
    expect(describeDays([0, 1, 2, 6])).toBe('Sun–Tue, Sat');
    setWeekStart(1);
    expect(describeDays([0, 1, 2, 6])).toBe('Mon, Tue, Sat, Sun');
  });

  it('ranges, windows grouped by their days, and schedules', () => {
    expect(describeRange(office)).toBe('09:00–17:00');
    expect(describeRange({ days: [1], start: 22 * 60, end: 0 })).toBe('22:00–24:00');
    expect(describeRange({ days: [1], start: 0, end: 1440 })).toBe('all day');
    const lunch: TimeWindow = { days: [1, 2, 3, 4, 5], start: 12 * 60, end: 13 * 60 };
    const sunday: TimeWindow = { days: [0], start: 0, end: 1440 };
    expect(describeWindows([office, lunch, sunday])).toBe('Mon–Fri 09:00–17:00, 12:00–13:00; Sun all day');
    expect(describeWindows([])).toBe('no time set');
    expect(describeSchedule({ mode: 'always', windows: [] })).toBe('Always');
    expect(describeSchedule({ mode: 'during', windows: [office] })).toBe('Mon–Fri 09:00–17:00');
    expect(describeSchedule({ mode: 'outside', windows: [office] })).toBe('Outside Mon–Fri 09:00–17:00');
  });
});

describe('conditions in words', () => {
  it('periods and limits', () => {
    expect(describePeriod({ kind: 'hour' })).toBe('per hour');
    expect(describePeriod({ kind: 'minutes', n: 90 })).toBe('every 1 h 30 min');
    expect(describePeriod({ kind: 'days', n: 3 })).toBe('every 3 days');
    expect(describePeriod({ kind: 'rolling', n: 60 })).toBe('in any 1 h');
    expect(describeBudget({ type: 'time', minutes: 30, period: { kind: 'day' }, perSite: true })).toBe(
      'after 30 min per day (per site)',
    );
    expect(describeBudget({ type: 'visits', count: 3, period: { kind: 'week' }, maxVisitMinutes: 5 })).toBe(
      'after 3 visits per week (at most 5 min each)',
    );
    expect(describeBudget({ type: 'session', maxMinutes: 20, cooldownMinutes: 60 })).toBe(
      'after 20 min in a row (then a 1 h stop)',
    );
  });

  it('what happens', () => {
    expect(describeIntervention(delayIntervention(20))).toBe('Wait 20 s');
    const random = { ...(delayIntervention(20) as DelayIntervention), randomTo: 40, hideCountdown: true };
    expect(describeIntervention(random)).toBe('Wait 20–40 s (countdown hidden)');
    expect(describeIntervention({ type: 'ask', choices: [5], maxMinutes: 15 })).toBe(
      'Ask first (up to 15 min)',
    );
    expect(
      describeIntervention({
        type: 'challenge',
        kind: 'random',
        length: 30,
        grant: { scope: 'site', mode: 'visit' },
      }),
    ).toBe('Type 30 random characters');
    expect(describeIntervention({ type: 'filter', filter: 'blur', mute: true })).toBe('Blur, muted');
    expect(describeIntervention({ type: 'filter', filter: 'none', mute: true })).toBe('Mute the tab');
    expect(describeIntervention({ type: 'redirect', url: 'https://x.test' })).toBe('Go to https://x.test');
    expect(describeIntervention({ type: 'allow' })).toBe('Allowed, time not counted');
    expect(describeIntervention(BLOCK)).toBe('Block');
  });

  it('a rule as sentences, with what happens otherwise', () => {
    const limit: Partial<Policy> = {
      schedule: { mode: 'during', windows: [office] },
      budget: { type: 'time', minutes: 10, period: { kind: 'day' } },
      intervention: BLOCK,
    };
    expect(summarizeGroup(group('A', ['a.test'], [limit]))).toEqual([
      'Mon–Fri 09:00–17:00, after 10 min per day → Block',
      'At other times the sites open normally, and only their time is counted.',
    ]);
    expect(summarizeGroup(group('A', ['a.test'], [{ intervention: BLOCK }]))).toEqual(['Always → Block']);
    expect(summarizeGroup(group('A', ['a.test']))).toEqual([
      'No conditions yet: the sites open normally and only their time is counted.',
    ]);
  });

  it('entries', () => {
    expect(describeTarget(target('a.test/$'))).toBe('a.test/');
    expect(describeTarget(target('*'))).toBe('Every website');
    expect(describeTarget(target('+a.test/help'))).toBe('except a.test/help');
  });
});

describe('changes in words', () => {
  it('one line per change, naming the rule and the entry', () => {
    const g = group('Social', ['a.test']);
    const entry = target('a.test');
    const units: [ChangeUnit, string][] = [
      [{ kind: 'group.add', group: g }, 'Create the rule Social'],
      [
        { kind: 'group.field', groupId: 'Social', name: 'Social', field: 'policies', value: [], base: [] },
        'Change the conditions of Social',
      ],
      [
        {
          kind: 'target.add',
          owner: { kind: 'group', id: 'Social' },
          ownerName: 'Social',
          target: { ...entry, allow: true },
        },
        'Allow a.test in Social',
      ],
      [
        { kind: 'target.remove', owner: { kind: 'group', id: 'Social' }, ownerName: 'Social', target: entry },
        'Remove a.test from Social',
      ],
      [{ kind: 'setting', path: 'theme', value: 'dark', base: 'light' }, 'Change the setting “Theme”'],
    ];
    for (const [unit, line] of units) expect(describeUnit(unit)).toBe(line);
    expect(settingLabel('no.such.setting')).toBe('no.such.setting');
  });
});

describe('the plan of a rule', () => {
  it('names the sites, every website, or how many', () => {
    expect(sitesPhrase([target('a.test'), target('b.test'), target('c.test'), target('+a.test/x')])).toBe(
      'a.test, b.test and 1 more site',
    );
    expect(sitesPhrase([target('*')])).toBe('any website');
    expect(sitesPhrase([])).toBe('0 sites');
  });

  it('one if-then sentence: when, then what happens', () => {
    expect(planSentence('always', BLOCK, 'a.test', [], 0)).toBe(
      'Every time you open a.test, WebHandbrake blocks the page.',
    );
    expect(planSentence('schedule', { type: 'track' }, 'a.test', [office], 0)).toBe(
      'When you open a.test (Mon–Fri 09:00–17:00), WebHandbrake only counts the time; outside these times it counts nothing.',
    );
    expect(planSentence('daily', { type: 'ask', choices: [5], maxMinutes: 10 }, 'a.test', [], 30)).toBe(
      'After 30 min a day on a.test, WebHandbrake first asks what you want to do (for 10 min at most).',
    );
    // The wait on the page is said too.
    expect(planSentence('always', defaultIntervention('ask'), 'a.test', [], 0)).toBe(
      'Every time you open a.test, WebHandbrake first asks what you want to do (for 15 min at most), then lets you in after 10 seconds.',
    );
    expect(planSentence('daily', BLOCK, 'a.test', [], 10, 60)).toBe(
      'After 10 min an hour on a.test, WebHandbrake blocks the page.',
    );
    expect(planSentence('daily', BLOCK, 'a.test', [], 120, 3 * 1440)).toBe(
      'After 2 h every 3 days on a.test, WebHandbrake blocks the page.',
    );
    expect(planSentence('daily', BLOCK, 'a.test', [], 20, 180)).toBe(
      'After 20 min every 3 h on a.test, WebHandbrake blocks the page.',
    );
    // With several sites, whether they share the time allowed or each has its own.
    expect(planSentence('daily', BLOCK, 'a.test, b.test', [], 30, 1440, 'shared')).toBe(
      'After 30 min a day in total on a.test, b.test, WebHandbrake blocks the page.',
    );
    expect(planSentence('daily', BLOCK, 'a.test, b.test', [], 30, 1440, 'each')).toBe(
      'After 30 min a day on each of a.test, b.test, WebHandbrake blocks the page.',
    );
  });

  it('is said of a rule whose condition the first questions describe', () => {
    const during = { schedule: { mode: 'during' as const, windows: [office] } };
    const limit = (period: Period) => ({
      budget: { type: 'time' as const, minutes: 30, period },
    });
    expect(rulePlan(group('A', ['a.test'], [{ intervention: BLOCK }]))).toBe(
      'Every time you open a.test, WebHandbrake blocks the page.',
    );
    expect(rulePlan(group('A', ['a.test'], [{ ...during, intervention: BLOCK }]))).toBe(
      'When you open a.test (Mon–Fri 09:00–17:00), WebHandbrake blocks the page.',
    );
    expect(
      rulePlan(group('A', ['a.test', 'b.test'], [{ ...limit({ kind: 'days', n: 2 }), intervention: BLOCK }])),
    ).toBe('After 30 min every 2 days in total on a.test, b.test, WebHandbrake blocks the page.');
    // Counting at certain times leaves the other times alone: with that last condition only.
    const counting = group('A', ['a.test'], [{ ...during, intervention: { type: 'track' } }]);
    expect(rulePlan(counting)).toBeNull();
    expect(rulePlan({ ...counting, policies: withCountingGap(counting.policies) })).toMatch(
      /outside these times it counts nothing/,
    );
    // Anything else is listed condition by condition.
    for (const policies of [
      [{ schedule: { mode: 'outside' as const, windows: [office] }, intervention: BLOCK }],
      [{ ...limit({ kind: 'week' }), intervention: BLOCK }],
      [
        {
          budget: { type: 'visits' as const, count: 3, period: { kind: 'day' as const } },
          intervention: BLOCK,
        },
      ],
      [{ ...during, ...limit({ kind: 'day' }), intervention: BLOCK }],
      [{ ...during, intervention: BLOCK }, { intervention: delayIntervention(10) }],
      [],
    ])
      expect(rulePlan(group('A', ['a.test'], policies))).toBeNull();
  });
});
