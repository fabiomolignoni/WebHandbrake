import { beforeAll, describe, expect, it } from 'vitest';
import { delayIntervention, quickPolicies } from '../../src/engine/defaults';
import { SEVERITY } from '../../src/engine/severity';
import type { Intervention, Policy, TimeWindow } from '../../src/engine/types';
import { setFormatPrefs } from '../../src/shared/format';
import type { BudgetView, DecisionView, GroupDecisionView, GroupStatus } from '../../src/shared/models';
import {
  groupTone,
  interventionStatus,
  LADDER,
  meterLevel,
  ruleTypes,
  siteStatus,
  type Tone,
  toneOf,
} from '../../src/ui/status';
import { BLOCK } from './helpers';

const office: TimeWindow[] = [{ days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 }];
const policy = (intervention: Intervention): Policy =>
  ({ ...quickPolicies('always', 'block', office, 30)[0], intervention }) as Policy;

describe('rule types: what a rule does, whatever the time', () => {
  it('names the intervention of every rule the wizard creates, also outside its times', () => {
    expect(ruleTypes(quickPolicies('schedule', 'block', office, 30))).toEqual(['block']);
    expect(ruleTypes(quickPolicies('daily', 'ask', office, 30))).toEqual(['ask']);
    // Counting at certain times adds a "Don't count" condition for the other times.
    expect(ruleTypes(quickPolicies('schedule', 'track', office, 30))).toEqual(['track']);
  });

  it('lists several restrictions from the gentlest to the strongest, without the free ones', () => {
    const types = ruleTypes([
      policy({ type: 'block' }),
      policy({ type: 'track' }),
      policy(delayIntervention(10)),
    ]);
    expect(types).toEqual(['delay', 'block']);
  });

  it('only counts time without conditions, and says "Don\'t count" when every condition does', () => {
    expect(ruleTypes([])).toEqual(['track']);
    expect(ruleTypes([policy({ type: 'allow' })])).toEqual(['allow']);
  });
});

describe('the state of the current site', () => {
  const NOW = new Date(2026, 9, 5, 10).getTime();
  const later = new Date(2026, 9, 5, 17).getTime();
  const view = (patch: Partial<DecisionView>): DecisionView =>
    ({
      url: 'https://a.test/',
      host: 'a.test',
      exempt: false,
      severity: SEVERITY.track,
      intervention: { type: 'track' },
      source: 'policy',
      primary: null,
      session: null,
      groups: [],
      excepted: [],
      until: null,
      next: null,
      restriction: null,
      ...patch,
    }) as DecisionView;
  const rule = (patch: Partial<GroupDecisionView>): GroupDecisionView =>
    ({ groupId: 'A', name: 'A', policies: [], pause: null, pass: null, ...patch }) as GroupDecisionView;

  beforeAll(() => setFormatPrefs({ hour12: '24', dateFormat: 'auto' }));

  it('pages the extension does not act on, exceptions, no rules', () => {
    expect(siteStatus(null).title).toBe('WebHandbrake does not act on this page');
    expect(siteStatus(view({ exempt: true })).tone).toBe('neutral');
    expect(
      siteStatus(
        view({
          excepted: [{ groupId: 'A', name: 'A', entry: { type: 'path', value: 'a.test/x', allow: true } }],
        }),
      ).title,
    ).toBe('Allowed by an exception');
    expect(siteStatus(view({})).title).toBe('No rules on this site');
  });

  it('a restricted page says what applies and until when', () => {
    const s = siteStatus(view({ severity: SEVERITY.block, intervention: BLOCK, until: later }), NOW);
    expect(s).toMatchObject({ tone: 'protected', icon: 'brake' });
    expect(s.title).toMatch(/until 17:00$/);
    const session = siteStatus(
      view({
        severity: SEVERITY.block,
        intervention: BLOCK,
        session: { id: 's', kind: 'groups', endAt: later, locked: false },
      }),
      NOW,
    );
    expect(session).toMatchObject({ tone: 'protected', title: 'Focus session until 17:00' });
  });

  it('a break, an access, a limit, a filter, or the next restriction', () => {
    const on = (patch: Partial<GroupDecisionView>, d: Partial<DecisionView> = {}) =>
      siteStatus(view({ groups: [rule(patch)], ...d }), NOW).title;
    expect(on({ pause: { id: 'p', until: later, scope: 'site' } })).toBe('On a break until 17:00');
    expect(on({ pause: { id: 'p', remaining: 300, scope: 'site' } })).toBe('On a break · 5 min left');
    expect(on({ pass: { id: 'g', until: later, scope: 'site' } })).toBe('Access granted until 17:00');
    expect(on({ pass: { id: 'g', visit: true, scope: 'site' } })).toBe('Access granted for this visit');
    const budget = { type: 'visits', used: 2, limit: 3, remaining: 1, exhausted: false } as BudgetView;
    expect(
      on({
        policies: [{ index: 0, id: 'p', scheduleActive: true, active: false, budget, intervention: BLOCK }],
      }),
    ).toBe('1 visit left');
    expect(
      on({}, { intervention: { type: 'filter', filter: 'grayscale' }, severity: SEVERITY.filter }),
    ).toMatch(/^Allowed · /);
    expect(on({}, { restriction: { at: later, kind: 'schedule', intervention: BLOCK, groupId: 'A' } })).toBe(
      'Allowed until 17:00',
    );
    expect(on({})).toBe('Allowed');
  });

  it('tones, icons and the friction meter follow the ladder', () => {
    expect(LADDER.map(toneOf)).toEqual([
      'free',
      'gentle',
      'friction',
      'friction',
      'friction',
      'protected',
      'protected',
      'protected',
    ]);
    expect(
      ['neutral', 'calm', 'free', 'gentle', 'friction', 'protected'].map((x) => meterLevel(x as Tone)),
    ).toEqual([0, 0, 1, 2, 3, 4]);
    expect(interventionStatus({ type: 'track' }, null)).toMatchObject({
      tone: 'free',
      icon: 'check-circle',
      label: 'Allowed',
    });
    expect(interventionStatus(delayIntervention(20), null)).toMatchObject({
      icon: 'hourglass',
      label: 'Wait 20 s',
    });
    const g = { enabled: true, intervention: BLOCK, pause: null, source: 'policy' } as unknown as GroupStatus;
    expect(groupTone(g)).toBe('protected');
    expect(groupTone({ ...g, pause: { until: later } })).toBe('calm');
    expect(groupTone({ ...g, enabled: false })).toBe('neutral');
    expect(
      groupTone({ ...g, intervention: { type: 'ask', choices: [5], maxMinutes: 5 }, source: 'session' }),
    ).toBe('protected');
  });
});
