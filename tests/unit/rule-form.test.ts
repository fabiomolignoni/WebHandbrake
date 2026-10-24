import { describe, expect, it } from 'vitest';
import { optionsAdvanced, whenKind } from '../../src/dashboard/rule-form';
import { defaultOptions, newPolicy } from '../../src/engine/defaults';

const office = [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }];
const day = { kind: 'day' as const };

describe('the rule editor: When and advanced options', () => {
  it('a condition is every time, at certain times, after some time or after some visits', () => {
    expect(whenKind(newPolicy())).toBe('always');
    expect(whenKind(newPolicy({ schedule: { mode: 'during', windows: office } }))).toBe('schedule');
    expect(whenKind(newPolicy({ budget: { type: 'time', minutes: 30, period: day } }))).toBe('limit');
    expect(whenKind(newPolicy({ budget: { type: 'visits', count: 3, period: day } }))).toBe('visits');
  });

  it('other windows and tabs', () => {
    expect(optionsAdvanced(defaultOptions())).toBe(false);
    expect(optionsAdvanced({ ...defaultOptions(), timer: false })).toBe(false);
    expect(optionsAdvanced({ ...defaultOptions(), privacy: 'normal' })).toBe(true);
    expect(optionsAdvanced({ ...defaultOptions(), quickSession: false })).toBe(true);
  });
});
