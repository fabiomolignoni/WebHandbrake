import { describe, expect, it } from 'vitest';
import {
  conditionAdvanced,
  interventionAdvanced,
  optionsAdvanced,
  pauseAdvanced,
  targetsAdvanced,
  whenKind,
} from '../../src/dashboard/rule-form';
import {
  defaultIntervention,
  defaultOptions,
  defaultPause,
  delayIntervention,
  newPolicy,
} from '../../src/engine/defaults';
import type { Intervention } from '../../src/engine/types';
import { BLOCK, t } from './helpers';

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

  it('what happens uses its advanced options beyond its main settings', () => {
    for (const type of ['track', 'filter', 'ask', 'delay', 'challenge', 'block', 'close'] as const)
      expect(interventionAdvanced(defaultIntervention(type))).toBe(false);
    // A shorter longest time leaves out the longer choices: still the main settings only.
    expect(interventionAdvanced({ type: 'ask', seconds: 10, choices: [5], maxMinutes: 5 })).toBe(false);
    const more: Intervention[] = [
      { type: 'filter', filter: 'custom', css: 'blur(2px)' },
      { type: 'filter', filter: 'grayscale', mute: true },
      { type: 'ask', seconds: 0, choices: [5, 10, 15], maxMinutes: 15 },
      { type: 'ask', seconds: 10, choices: [5, 10, 15], maxMinutes: 15, cooldownMinutes: 30 },
      { ...delayIntervention(30), onBlur: 'restart' } as Intervention,
      { ...delayIntervention(30), grant: { scope: 'group', mode: 'visit' } } as Intervention,
      {
        type: 'challenge',
        kind: 'random',
        length: 24,
        charset: 'digits',
        grant: { scope: 'site', mode: 'visit' },
      },
      { type: 'redirect', url: 'https://todo.test/?from={url}' },
    ];
    for (const i of more) expect(interventionAdvanced(i), JSON.stringify(i)).toBe(true);
    expect(interventionAdvanced(BLOCK)).toBe(false);
  });

  it('sites with exceptions, breaks during focus sessions, other windows and tabs', () => {
    expect(targetsAdvanced([t('a.test')])).toBe(false);
    expect(targetsAdvanced([t('a.test'), t('+a.test/learn')])).toBe(true);
    expect(pauseAdvanced(defaultPause())).toBe(false);
    expect(pauseAdvanced({ ...defaultPause(), allowed: true, duringSessions: true })).toBe(true);
    expect(optionsAdvanced(defaultOptions())).toBe(false);
    expect(optionsAdvanced({ ...defaultOptions(), timer: false })).toBe(false);
    expect(optionsAdvanced({ ...defaultOptions(), privacy: 'normal' })).toBe(true);
    expect(optionsAdvanced({ ...defaultOptions(), quickSession: false })).toBe(true);
  });
});
