import { describe, expect, it } from 'vitest';
import { delayIntervention } from '../../src/engine/defaults';
import type { Group, Period, Policy } from '../../src/engine/types';
import { hasErrors, isRedirectUrl, validateGroup, validateTargets } from '../../src/engine/validate';
import { BLOCK, group, t } from './helpers';

const keys = (g: Group) => validateGroup(g).map((i) => i.key);
const valid = (policies: Partial<Policy>[], lines = ['a.test']) => group('A', lines, policies);

describe('rule validation', () => {
  it('a rule with a name, sites and a condition has nothing to report', () => {
    const g = valid([{ intervention: BLOCK }]);
    expect(validateGroup(g)).toEqual([]);
  });

  it('a rule needs a name and a site that it restricts', () => {
    // Exceptions only: a rule that restricts nothing.
    const g = valid([{ intervention: BLOCK }], ['+a.test']);
    g.name = '  ';
    expect(keys(g)).toEqual(['validate.noName', 'validate.noTargets', 'validate.unusedException']);
    expect(hasErrors(validateGroup(g))).toBe(true);
  });

  it('a rule over every website is allowed, with a warning', () => {
    const issues = validateGroup(valid([{ intervention: BLOCK }], ['*']));
    expect(issues).toEqual([{ level: 'warning', key: 'validate.allSites' }]);
    expect(hasErrors(issues)).toBe(false);
  });

  it('times: no window, no day, a window that starts and ends at the same time', () => {
    expect(keys(valid([{ schedule: { mode: 'during', windows: [] }, intervention: BLOCK }]))).toEqual([
      'validate.noWindows',
    ]);
    const odd = { mode: 'during' as const, windows: [{ days: [], start: 600, end: 600 }] };
    const issues = validateGroup(valid([{ schedule: odd, intervention: BLOCK }]));
    expect(issues.map((i) => [i.level, i.key, i.policy])).toEqual([
      ['error', 'validate.noDays', 0],
      ['warning', 'validate.emptyWindow', 0],
    ]);
    // 00:00–00:00 is a whole day, not an empty window.
    const allDay = { mode: 'during' as const, windows: [{ days: [1], start: 0, end: 0 }] };
    expect(keys(valid([{ schedule: allDay, intervention: BLOCK }]))).toEqual([]);
  });

  it('a time limit as long as its period is never reached', () => {
    const limit = (minutes: number, period: Period) =>
      valid([{ budget: { type: 'time', minutes, period }, intervention: BLOCK }]);
    const never = validateGroup(limit(60, { kind: 'hour' })).find((i) => i.key === 'validate.neverReached');
    expect(never).toEqual({ level: 'error', key: 'validate.neverReached', policy: 0 });
    expect(keys(limit(30 * 60, { kind: 'minutes', n: 120 }))).toContain('validate.neverReached');
    expect(keys(limit(59, { kind: 'hour' }))).toEqual([]);
    expect(keys(limit(30 * 60, { kind: 'days', n: 2 }))).toEqual([]);
    // A week lasts 7 days, and a month 31 days at most: 30 days can be reached in a long month.
    expect(keys(limit(7 * 1440, { kind: 'week' }))).toContain('validate.neverReached');
    expect(keys(limit(7 * 1440 - 1, { kind: 'week' }))).toEqual([]);
    expect(keys(limit(31 * 1440, { kind: 'month' }))).toContain('validate.neverReached');
    expect(keys(limit(30 * 1440, { kind: 'month' }))).toEqual([]);
  });

  it('limits of nothing, and what happens: redirect address, phrase, durations', () => {
    expect(
      keys(valid([{ budget: { type: 'time', minutes: 0, period: { kind: 'day' } }, intervention: BLOCK }])),
    ).toContain('validate.zeroBudget');
    expect(
      keys(valid([{ budget: { type: 'visits', count: 0, period: { kind: 'day' } }, intervention: BLOCK }])),
    ).toContain('validate.zeroVisits');
    expect(keys(valid([{ intervention: { type: 'redirect', url: 'javascript:alert(1)' } }]))).toContain(
      'validate.redirectUrl',
    );
    expect(
      keys(
        valid([
          {
            intervention: {
              type: 'challenge',
              kind: 'phrase',
              phrase: ' ',
              grant: { scope: 'site', mode: 'visit' },
            },
          },
        ]),
      ),
    ).toContain('validate.phrase');
    // A random wait needs a longest wait over the shortest.
    const random = (randomTo: number) => ({ ...delayIntervention(30), randomTo }) as Policy['intervention'];
    expect(keys(valid([{ intervention: random(30) }]))).toContain('validate.randomWait');
    expect(keys(valid([{ intervention: random(31) }]))).not.toContain('validate.randomWait');
  });

  it('a rule that only counts time is fine', () => {
    expect(keys(valid([{ intervention: { type: 'track' } }]))).toEqual([]);
  });

  it('a break of no minutes is an error', () => {
    const g = valid([{ intervention: BLOCK }]);
    g.pause = { ...g.pause, allowed: true, maxMinutes: 0 };
    expect(keys(g)).toEqual(['validate.pauseDuration']);
    // A rule that never blocks has no breaks: their settings are not checked.
    const asks = valid([{ intervention: delayIntervention(30) }]);
    asks.pause = g.pause;
    expect(keys(asks)).toEqual([]);
  });

  it('regular expressions are checked for safety', () => {
    expect(validateTargets([{ id: 'r', type: 'regex', value: '(a+)+' }])).toEqual([
      { level: 'error', key: 'targets.error.regexNested', params: { value: '(a+)+' } },
    ]);
    expect(validateTargets([t('a.test'), { id: 'r', type: 'regex', value: '^https://a\\.test/' }])).toEqual(
      [],
    );
  });
});

describe('redirect addresses', () => {
  it('only web pages, with placeholders allowed', () => {
    expect(isRedirectUrl('https://example.com/focus')).toBe(true);
    expect(isRedirectUrl(' http://example.com/?from={url}&rule={group} ')).toBe(true);
    expect(isRedirectUrl('https://')).toBe(false);
    expect(isRedirectUrl('data:text/html,hi')).toBe(false);
    expect(isRedirectUrl('file:///etc/passwd')).toBe(false);
    expect(isRedirectUrl('not a url')).toBe(false);
  });
});
