import { describe, expect, it } from 'vitest';
import { decide } from '../../src/engine/decide';
import {
  defaultIntervention,
  everyPeriod,
  newPolicy,
  periodMinutes,
  QUICK_DELAY_SECONDS,
  withCountingGap,
} from '../../src/engine/defaults';
import type { TimeWindow } from '../../src/engine/types';
import { at, BLOCK, config, ctx, group } from './helpers';

const office: TimeWindow[] = [{ days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 }];
const during = (intervention = BLOCK) =>
  newPolicy({ schedule: { mode: 'during', windows: office }, intervention });

describe('a new rule: the conditions built by the rule editor and first run', () => {
  it('starts every intervention from its defaults', () => {
    const delay = defaultIntervention('delay');
    expect(delay.type === 'delay' && delay.seconds).toBe(QUICK_DELAY_SECONDS);
    expect(defaultIntervention('ask')).toMatchObject({ type: 'ask', maxMinutes: 15 });
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
    const policies = withCountingGap([during({ type: 'track' })]);
    expect(policies.map((p) => [p.schedule.mode, p.intervention.type])).toEqual([
      ['during', 'track'],
      ['always', 'allow'],
    ]);
    const c = config([group('Work', ['work.test'], policies)]);
    expect(decide(ctx(c, at(0, 10)), 'https://work.test/').intervention.type).toBe('track');
    const outside = decide(ctx(c, at(0, 18)), 'https://work.test/');
    expect(outside.intervention.type).toBe('allow');
    expect(outside.groups.map((g) => g.intervention.type)).toEqual(['allow']);
    // Any other condition stays as it is: the rule counts at all times.
    expect(withCountingGap([during()])).toHaveLength(1);
    const limit = newPolicy({
      budget: { type: 'time', minutes: 30, period: { kind: 'day' } },
      intervention: { type: 'track' },
    });
    expect(withCountingGap([limit])).toHaveLength(1);
    expect(withCountingGap([during({ type: 'track' }), during()])).toHaveLength(2);
  });

  it('a scheduled block applies inside the window only', () => {
    const g = group('Social', ['social.test'], [during()]);
    const c = config([g]);
    expect(decide(ctx(c, at(0, 10)), 'https://social.test/').intervention.type).toBe('block');
    expect(decide(ctx(c, at(0, 18)), 'https://social.test/').intervention.type).not.toBe('block');
  });
});
