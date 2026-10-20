import { describe, expect, it } from 'vitest';
import { decide } from '../../src/engine/decide';
import { everyPeriod, periodMinutes, QUICK_DELAY_SECONDS, quickPolicies } from '../../src/engine/defaults';
import type { TimeWindow } from '../../src/engine/types';
import { at, config, ctx, group } from './helpers';

const office: TimeWindow[] = [{ days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 }];

describe('quick rules: the conditions built by the creation wizard and onboarding', () => {
  it('maps "what happens" to interventions from the gentlest to the strongest', () => {
    expect(quickPolicies('always', 'track', office, 30)[0].intervention.type).toBe('track');
    expect(quickPolicies('always', 'ask', office, 30)[0].intervention.type).toBe('ask');
    const delay = quickPolicies('always', 'delay', office, 30)[0].intervention;
    expect(delay.type === 'delay' && delay.seconds).toBe(QUICK_DELAY_SECONDS);
    expect(quickPolicies('always', 'block', office, 30)[0].intervention.type).toBe('block');
  });

  it('maps "when" to one condition: always, during windows, or after a daily time limit', () => {
    const [always] = quickPolicies('always', 'block', office, 30);
    expect(always.schedule.mode).toBe('always');
    expect(always.budget).toBeUndefined();
    const [schedule] = quickPolicies('schedule', 'block', office, 30);
    expect(schedule.schedule).toEqual({ mode: 'during', windows: office });
    const [daily] = quickPolicies('daily', 'block', office, 45);
    expect(daily.schedule.mode).toBe('always');
    expect(daily.budget).toEqual({ type: 'time', minutes: 45, period: { kind: 'day' } });
    // The time allowed can start again every so many minutes, hours or days.
    const [hours] = quickPolicies('daily', 'block', office, 20, 120);
    expect(hours.budget).toEqual({ type: 'time', minutes: 20, period: { kind: 'minutes', n: 120 } });
    const [days] = quickPolicies('daily', 'block', office, 90, 3 * 1440);
    expect(days.budget).toEqual({ type: 'time', minutes: 90, period: { kind: 'days', n: 3 } });
  });

  it('a period in minutes is the clock hour, the calendar day, whole days or minutes', () => {
    expect(everyPeriod(60)).toEqual({ kind: 'hour' });
    expect(everyPeriod(1440)).toEqual({ kind: 'day' });
    expect(everyPeriod(2 * 1440)).toEqual({ kind: 'days', n: 2 });
    expect(everyPeriod(200 * 1440)).toEqual({ kind: 'days', n: 90 });
    expect(everyPeriod(30)).toEqual({ kind: 'minutes', n: 30 });
    expect(everyPeriod(1)).toEqual({ kind: 'minutes', n: 5 });
    expect(everyPeriod(36 * 60)).toEqual({ kind: 'minutes', n: 1440 });
    for (const m of [60, 1440, 2 * 1440, 30, 180]) expect(periodMinutes(everyPeriod(m))).toBe(m);
    expect(periodMinutes({ kind: 'week' })).toBe(7 * 1440);
    expect(periodMinutes({ kind: 'rolling', n: 45 })).toBe(45);
  });

  it('counting at certain times leaves the sites allowed and not counted outside them (#21)', () => {
    const policies = quickPolicies('schedule', 'track', office, 30);
    expect(policies.map((p) => [p.schedule.mode, p.intervention.type])).toEqual([
      ['during', 'track'],
      ['always', 'allow'],
    ]);
    const c = config([group('Work', ['work.test'], policies)]);
    expect(decide(ctx(c, at(0, 10)), 'https://work.test/').intervention.type).toBe('track');
    const outside = decide(ctx(c, at(0, 18)), 'https://work.test/');
    expect(outside.intervention.type).toBe('allow');
    expect(outside.groups.map((g) => g.intervention.type)).toEqual(['allow']);
    // Any other "what happens" keeps a single condition: the rule counts at all times.
    expect(quickPolicies('schedule', 'block', office, 30)).toHaveLength(1);
    expect(quickPolicies('daily', 'track', office, 30)).toHaveLength(1);
  });

  it('a scheduled block applies inside the window only', () => {
    const g = group('Social', ['social.test'], quickPolicies('schedule', 'block', office, 30));
    const c = config([g]);
    expect(decide(ctx(c, at(0, 10)), 'https://social.test/').intervention.type).toBe('block');
    expect(decide(ctx(c, at(0, 18)), 'https://social.test/').intervention.type).not.toBe('block');
  });
});
