import { beforeAll, describe, expect, it } from 'vitest';
import { pickIntervention, quickInterventionReady } from '../../src/dashboard/components/how-picker';
import { gridToWindows, windowsToGrid } from '../../src/dashboard/components/schedule';
import { SEVERITY } from '../../src/engine/severity';
import type { TimeWindow } from '../../src/engine/types';
import { setFormatPrefs } from '../../src/shared/format';
import type { BudgetView, DecisionView, PauseOptions } from '../../src/shared/models';
import { durationUnit } from '../../src/ui/components';
import { budgetText, verdict } from '../../src/ui/explain';
import { breakSubject, costLabel, costsLabel, pauseBudgetLabel, pauseSummary } from '../../src/ui/pause';
import { BLOCK } from './helpers';

beforeAll(() => setFormatPrefs({ hour12: '24', dateFormat: 'auto' }));

describe('the week grid of the schedule editor', () => {
  const on = (grid: boolean[][]) =>
    grid.flatMap((col, day) => col.flatMap((v, slot) => (v ? [`${day}:${slot}`] : [])));

  it('paints windows in half hours, an overnight window across midnight', () => {
    const grid = windowsToGrid([{ days: [1], start: 23 * 60, end: 60 }], 0);
    expect(on(grid)).toEqual(['1:46', '1:47', '2:0', '2:1']);
    expect(on(windowsToGrid([{ days: [0], start: 0, end: 1440 }], 0))).toHaveLength(48);
  });

  it('turns painted cells back into windows, one per range with its days', () => {
    const windows: TimeWindow[] = [
      { days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 },
      { days: [6], start: 0, end: 1440 },
    ];
    expect(gridToWindows(windowsToGrid(windows, 0), 0)).toEqual(windows);
  });

  it('columns are logical days: with days starting at 04:00 a night stays in its evening', () => {
    const night: TimeWindow[] = [{ days: [5], start: 22 * 60, end: 2 * 60 }];
    const grid = windowsToGrid(night, 4 * 60);
    expect(on(grid)).toEqual(['5:36', '5:37', '5:38', '5:39', '5:40', '5:41', '5:42', '5:43']);
    expect(gridToWindows(grid, 4 * 60)).toEqual(night);
  });
});

describe('the cost and the breaks left, in words', () => {
  const options = (patch: Partial<PauseOptions>): PauseOptions =>
    ({
      costs: [],
      remainingCount: null,
      remainingMinutes: null,
      countPeriod: null,
      minutesPeriod: null,
      ...patch,
    }) as PauseOptions;
  const day = { kind: 'day' as const };

  it('names every cost', () => {
    expect(costLabel({ type: 'none' })).toBe('no cost');
    expect(costLabel({ type: 'delay', seconds: 30 })).toMatch(/30/);
    expect(costLabel({ type: 'challenge', kind: 'random', length: 24 })).toMatch(/24/);
    expect(costsLabel([])).toBe(costLabel({ type: 'none' }));
    expect(costsLabel([{ type: 'delay', seconds: 30 }, { type: 'password' }])).toBe(
      `${costLabel({ type: 'delay', seconds: 30 })} + ${costLabel({ type: 'password' })}`,
    );
  });

  it('breaks and minutes left, together when they share their period', () => {
    expect(pauseBudgetLabel(options({}))).toBeNull();
    expect(pauseBudgetLabel(options({ remainingCount: 3, countPeriod: day }))).toBe('3 breaks left today');
    expect(
      pauseBudgetLabel(
        options({ remainingCount: 3, countPeriod: day, remainingMinutes: 29.6, minutesPeriod: day }),
      ),
    ).toBe('3 breaks left today, 30 min in total');
    expect(
      pauseBudgetLabel(
        options({
          remainingCount: 1,
          countPeriod: day,
          remainingMinutes: 50,
          minutesPeriod: { kind: 'week' },
        }),
      ),
    ).toBe('1 break left today · 50 min of breaks left this week');
  });

  it('the line next to "Take a break"', () => {
    expect(
      pauseSummary(options({ costs: [{ type: 'delay', seconds: 30 }], remainingCount: 3, countPeriod: day })),
    ).toBe('Cost: a 30 s wait · 3 breaks left today');
    expect(pauseSummary(options({}))).toBe('No cost');
    // Extending a break: how much longer it can last, no break counted.
    expect(
      pauseSummary(
        options({
          extend: { grantId: 'x', scope: 'site', minutes: 5 },
          duration: { mode: 'upTo', minutes: 10 },
        }),
      ),
    ).toBe('No cost · up to 10 min more');
  });

  it('what a break covers: its site or page and its rules', () => {
    const names: Record<string, string> = { S: 'Social', N: 'News' };
    const nameOf = (id: string) => names[id];
    expect(breakSubject({ groups: ['S'], scope: 'site', site: 'youtube.com' }, nameOf)).toBe(
      'youtube.com · Social',
    );
    expect(
      breakSubject({ groups: ['S', 'N'], scope: 'page', url: 'https://youtube.com/watch?v=1' }, nameOf),
    ).toBe('youtube.com/watch?v=1 · Social and News');
    expect(breakSubject({ groups: ['S'], scope: 'group' }, nameOf)).toBe('Social');
    expect(breakSubject({ groups: ['gone'], scope: 'group' }, nameOf)).toBe('Deleted rule');
    expect(breakSubject({ groups: '*', scope: 'all' }, nameOf)).toBe('All rules');
    expect(breakSubject({ groups: ['*'], scope: 'all' }, nameOf)).toBe('All rules');
  });
});

describe('"Why?"', () => {
  const NOW = new Date(2026, 9, 5, 10).getTime();
  const view = (patch: Partial<DecisionView>): DecisionView =>
    ({
      exempt: false,
      severity: SEVERITY.track,
      intervention: { type: 'track' },
      groups: [],
      excepted: [],
      until: null,
      restriction: null,
      ...patch,
    }) as DecisionView;

  it('one sentence for the decision', () => {
    expect(verdict(view({ exempt: true }))).toMatch(/./);
    expect(
      verdict(view({ severity: SEVERITY.block, intervention: BLOCK, until: NOW + 3_600_000 }), NOW),
    ).toMatch(/11:00/);
    expect(verdict(view({ severity: SEVERITY.block, intervention: BLOCK }), NOW)).not.toMatch(/11:00/);
    const sentences = new Set(
      [
        view({}),
        view({
          excepted: [{ groupId: 'A', name: 'A', entry: { type: 'domain', value: 'a.test', allow: true } }],
        }),
        view({ groups: [{ pause: { id: 'p', scope: 'site' } } as never] }),
        view({ groups: [{ pass: { id: 'p', scope: 'site' } } as never] }),
        view({
          groups: [{} as never],
          restriction: { at: NOW + 60_000, kind: 'budget', intervention: BLOCK, groupId: 'A' },
        }),
        view({ groups: [{} as never] }),
      ].map((d) => verdict(d, NOW)),
    );
    expect(sentences.size).toBe(6);
  });

  it('what a limit has used', () => {
    const b = (type: BudgetView['type'], used: number, limit: number) =>
      ({ type, used, limit }) as BudgetView;
    expect(budgetText(b('visits', 2, 3))).toMatch(/2.*3/);
    expect(budgetText(b('time', 600, 1800))).toMatch(/10 min.*30 min/);
    expect(budgetText(b('session', 60, 600))).toMatch(/1 min.*10 min/);
  });
});

describe('"What should happen?" in the wizard', () => {
  it('starts from the defaults, keeps what was set, and a redirect needs an address', () => {
    expect(pickIntervention('block')).toEqual(BLOCK);
    expect(pickIntervention('redirect')).toEqual({ type: 'redirect', url: '' });
    const kept = {
      delay: {
        type: 'delay' as const,
        seconds: 90,
        grant: { scope: 'site' as const, mode: 'visit' as const },
      },
    };
    expect(pickIntervention('delay', kept)).toBe(kept.delay);
    expect(quickInterventionReady(null)).toBe(false);
    expect(quickInterventionReady({ type: 'redirect', url: 'https://x.test' })).toBe(true);
    expect(quickInterventionReady({ type: 'redirect', url: '' })).toBe(false);
    expect(
      quickInterventionReady({
        type: 'challenge',
        kind: 'phrase',
        phrase: ' ',
        grant: { scope: 'site', mode: 'visit' },
      }),
    ).toBe(false);
    expect(quickInterventionReady(BLOCK)).toBe(true);
  });
});

describe('a length of time as a number and a unit', () => {
  it('shows an amount in the largest unit in which it is a whole number', () => {
    expect(durationUnit(120, ['minutes', 'hours', 'days'])).toBe('hours');
    expect(durationUnit(90, ['minutes', 'hours', 'days'])).toBe('minutes');
    expect(durationUnit(2880, ['minutes', 'hours', 'days'])).toBe('days');
    expect(durationUnit(2880, ['minutes', 'hours'])).toBe('hours');
    expect(durationUnit(0.5, ['minutes', 'hours'])).toBe('minutes');
    expect(durationUnit(0, ['seconds', 'minutes'], 'seconds')).toBe('seconds');
    expect(durationUnit(120, ['seconds', 'minutes'], 'seconds')).toBe('minutes');
    expect(durationUnit(48, ['hours', 'days'], 'hours')).toBe('days');
  });
});
