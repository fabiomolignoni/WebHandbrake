import { describe, expect, it } from 'vitest';
import { decide } from '../../src/engine/decide';
import { QUICK_DELAY_SECONDS, quickPolicies } from '../../src/engine/defaults';
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
  });

  it('a scheduled block applies inside the window only', () => {
    const g = group('Social', ['social.test'], quickPolicies('schedule', 'block', office, 30));
    const c = config([g]);
    expect(decide(ctx(c, at(0, 10)), 'https://social.test/').intervention.type).toBe('block');
    expect(decide(ctx(c, at(0, 18)), 'https://social.test/').intervention.type).not.toBe('block');
  });
});
