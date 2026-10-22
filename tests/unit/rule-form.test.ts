import { describe, expect, it } from 'vitest';
import { conditionAdvanced, optionsAdvanced, whenKind } from '../../src/dashboard/rule-form';
import { defaultOptions, newPolicy } from '../../src/engine/defaults';

const office = [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }];
const day = { kind: 'day' as const };

describe('the rule editor: first questions and advanced options', () => {
  it('a condition is every time, at certain times or after some time', () => {
    expect(whenKind(newPolicy())).toBe('always');
    expect(whenKind(newPolicy({ schedule: { mode: 'during', windows: office } }))).toBe('schedule');
    expect(whenKind(newPolicy({ schedule: { mode: 'outside', windows: office } }))).toBe('schedule');
    expect(whenKind(newPolicy({ budget: { type: 'visits', count: 3, period: day } }))).toBe('limit');
  });

  it('a condition uses its advanced options beyond the first question', () => {
    expect(conditionAdvanced(newPolicy())).toBe(false);
    expect(conditionAdvanced(newPolicy({ schedule: { mode: 'during', windows: office } }))).toBe(false);
    expect(
      conditionAdvanced(newPolicy({ budget: { type: 'time', minutes: 30, period: { kind: 'days', n: 3 } } })),
    ).toBe(false);
    // Outside certain times, visits, continuous use, a calendar period, an offset, at certain times.
    for (const p of [
      newPolicy({ schedule: { mode: 'outside', windows: office } }),
      newPolicy({ budget: { type: 'visits', count: 3, period: day } }),
      newPolicy({ budget: { type: 'session', maxMinutes: 15, cooldownMinutes: 60 } }),
      newPolicy({ budget: { type: 'time', minutes: 30, period: { kind: 'week' } } }),
      newPolicy({ budget: { type: 'time', minutes: 30, period: { kind: 'minutes', n: 120, offset: 30 } } }),
      newPolicy({
        schedule: { mode: 'during', windows: office },
        budget: { type: 'time', minutes: 30, period: day },
      }),
    ])
      expect(conditionAdvanced(p)).toBe(true);
  });

  it('other windows and tabs', () => {
    expect(optionsAdvanced(defaultOptions())).toBe(false);
    expect(optionsAdvanced({ ...defaultOptions(), timer: false })).toBe(false);
    expect(optionsAdvanced({ ...defaultOptions(), privacy: 'normal' })).toBe(true);
    expect(optionsAdvanced({ ...defaultOptions(), quickSession: false })).toBe(true);
  });
});
