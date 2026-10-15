import { describe, expect, it } from 'vitest';
import { decide } from '../../src/engine/decide';
import { defaultState, delayIntervention } from '../../src/engine/defaults';
import { HORIZON_DAYS } from '../../src/engine/limits';
import {
  candidateTimes,
  expiredGrants,
  nextGlobalChange,
  nextRestriction,
  untilFor,
} from '../../src/engine/next';
import { DAY, MINUTE } from '../../src/engine/time';
import type { FocusSession, Grant, PendingChange } from '../../src/engine/types';
import { Usage, usageKeys } from '../../src/engine/usage';
import { at, BLOCK, config, ctx, group } from './helpers';

const cal = { dayStart: 0, weekStart: 1 };
const U = { incognito: false };
const office = { mode: 'during' as const, windows: [{ days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 }] };

function session(patch: Partial<FocusSession>): FocusSession {
  return {
    id: 's',
    kind: 'groups',
    groups: [],
    allow: [],
    startAt: 0,
    endAt: 0,
    createdAt: 0,
    locked: false,
    noPauses: false,
    ...patch,
  };
}

function grant(patch: Partial<Grant>): Grant {
  return {
    id: 'g',
    kind: 'pause',
    groups: ['A'],
    scope: 'group',
    createdAt: at(0, 9),
    severity: 99,
    ...patch,
  };
}

describe('when a restriction ends', () => {
  it('a window ends at its end time, then the site is only counted', () => {
    const c = ctx(config([group('A', ['a.test'], [{ schedule: office, intervention: BLOCK }])]), at(0, 10));
    expect(untilFor(c, 'https://a.test/', U)).toEqual({ until: at(0, 17), next: { type: 'track' } });
  });

  it('extension pages and allowed sites have nothing to end', () => {
    const c = ctx(config([group('A', ['a.test'], [{ intervention: BLOCK }])]), at(0, 10));
    expect(untilFor(c, 'chrome-extension://x/dashboard.html', U)).toEqual({ until: null, next: null });
    // A rule without conditions never ends.
    expect(untilFor(c, 'https://a.test/', U)).toEqual({ until: null, next: null });
  });

  it('a rolling limit per site ends when that site falls back under it (regression)', () => {
    const rolling = { kind: 'rolling' as const, n: 60 };
    const g = group(
      'A',
      ['a.test', 'b.test'],
      [{ budget: { type: 'time', minutes: 10, period: rolling, perSite: true }, intervention: BLOCK }],
    );
    const usage = new Usage();
    usage.add(usageKeys.site('A', 'a.test'), at(0, 9, 30), 600, 1, cal);
    const c = ctx(config([g]), at(0, 10), defaultState(), usage);
    expect(untilFor(c, 'https://a.test/', U).until).toBe(at(0, 10, 31));
    expect(untilFor(c, 'https://b.test/', U).until).toBeNull();
  });

  it('a cool-down ends at its end; of two, the one that ends last', () => {
    const state = defaultState();
    state.cooldowns['ask:A:a.test'] = { until: at(0, 10, 30), group: 'A', site: 'a.test', kind: 'ask' };
    state.cooldowns['ask:A:'] = { until: at(0, 10, 20), group: 'A', kind: 'ask' };
    const c = ctx(config([group('A', ['a.test'], [{ intervention: { type: 'track' } }])]), at(0, 10), state);
    expect(decide(c, 'https://a.test/').primary?.cooldown?.until).toBe(at(0, 10, 30));
    expect(untilFor(c, 'https://a.test/', U).until).toBe(at(0, 10, 30));
  });
});

describe('the next restriction of an open site', () => {
  it('a window that starts later', () => {
    const c = ctx(config([group('A', ['a.test'], [{ schedule: office, intervention: BLOCK }])]), at(0, 8));
    expect(nextRestriction(c, 'https://a.test/', U)).toEqual({
      at: at(0, 9),
      kind: 'schedule',
      intervention: BLOCK,
      groupId: 'A',
    });
  });

  it('a focus session that starts later', () => {
    const state = defaultState();
    state.sessions.push(session({ groups: ['A'], startAt: at(0, 9), endAt: at(0, 10) }));
    const c = ctx(config([group('A', ['a.test'], [{ intervention: { type: 'track' } }])]), at(0, 8), state);
    expect(nextRestriction(c, 'https://a.test/', U)).toMatchObject({ at: at(0, 9), kind: 'session' });
  });

  it('a break or a pass that ends: its own end, or the minutes left of a metered break', () => {
    const g = group('A', ['a.test'], [{ intervention: BLOCK }]);
    const state = defaultState();
    state.grants.push(grant({ until: at(0, 10, 15) }));
    const c = ctx(config([g]), at(0, 10), state);
    expect(nextRestriction(c, 'https://a.test/', U)).toMatchObject({ at: at(0, 10, 15), kind: 'grant' });
    state.grants = [grant({ remaining: 120 })];
    expect(nextRestriction(c, 'https://a.test/', U)).toMatchObject({ at: at(0, 10, 2), kind: 'grant' });
  });

  it('the longest visit of a visit limit runs out', () => {
    const g = group(
      'A',
      ['a.test'],
      [
        {
          budget: { type: 'visits', count: 3, period: { kind: 'day' }, maxVisitMinutes: 10 },
          intervention: BLOCK,
        },
      ],
    );
    const state = defaultState();
    state.activity[usageKeys.group('A')] = {
      last: at(0, 10),
      visitStart: at(0, 9, 56),
      visitSeconds: 240,
      run: 240,
    };
    const c = ctx(config([g]), at(0, 10), state);
    expect(nextRestriction(c, 'https://a.test/', U)).toMatchObject({ at: at(0, 10, 6), kind: 'budget' });
  });

  it('nothing for a page already restricted, or for an exempt one', () => {
    const c = ctx(config([group('A', ['a.test'], [{ intervention: delayIntervention(5) }])]), at(0, 10));
    expect(nextRestriction(c, 'https://a.test/', U)).toBeNull();
    expect(nextRestriction(c, 'moz-extension://x/popup.html', U)).toBeNull();
  });
});

describe('the background alarm', () => {
  it('wakes up at the next change of any rule, pending change or emergency exit', () => {
    const state = defaultState();
    const c = ctx(
      config([group('A', ['a.test'], [{ schedule: office, intervention: BLOCK }])]),
      at(0, 10),
      state,
    );
    expect(nextGlobalChange(c)).toBe(at(0, 17));
    const pending: PendingChange = {
      id: 'p',
      createdAt: 0,
      readyAt: at(0, 12),
      expiresAt: at(2, 0),
      units: [],
    };
    state.pending.push(pending);
    expect(nextGlobalChange(c)).toBe(at(0, 12));
    state.emergency = { requestedAt: at(0, 9), readyAt: at(0, 11) };
    expect(nextGlobalChange(c)).toBe(at(0, 11));
  });

  it('has nothing to wait for without timed rules or state', () => {
    const c = ctx(config([group('A', ['a.test'], [{ intervention: BLOCK }])]), at(0, 10));
    expect(nextGlobalChange(c)).toBeNull();
  });

  it('looks ahead a limited number of days, and collects sessions, cool-downs and forfeits', () => {
    const state = defaultState();
    state.sessions.push(session({ startAt: at(0, 11), endAt: at(0, 12) }));
    state.cooldowns.x = { until: at(0, 13), group: 'A', kind: 'session' };
    state.forfeits.p = at(0, 14);
    state.forfeits.far = at(0, 10) + (HORIZON_DAYS + 1) * DAY;
    const c = ctx(config([]), at(0, 10), state);
    expect(candidateTimes(c, [])).toEqual([at(0, 11), at(0, 12), at(0, 13), at(0, 14)]);
  });
});

describe('expired grants', () => {
  it('a recheck ends at its time; a break for every rule at its end', () => {
    const state = defaultState();
    const recheck = grant({
      id: 'r',
      kind: 'recheck',
      groups: [],
      scope: 'page',
      until: at(0, 10),
      severity: 0,
    });
    const all = grant({ id: 'all', groups: '*', scope: 'all', until: at(0, 11) });
    state.grants.push(recheck, all);
    const c = ctx(config([]), at(0, 10, 30), state);
    expect(expiredGrants(c).map((g) => g.id)).toEqual(['r']);
    expect(expiredGrants({ ...c, now: at(0, 11) }).map((g) => g.id)).toEqual(['r', 'all']);
  });

  it('an access for the visit ends after the visit gap without activity', () => {
    const state = defaultState();
    state.grants.push(
      grant({ kind: 'pass', visit: true, scope: 'site', site: 'a.test', createdAt: at(0, 10) }),
    );
    state.activity[usageKeys.site('A', 'a.test')] = {
      last: at(0, 10, 20),
      visitStart: at(0, 10),
      visitSeconds: 60,
      run: 60,
    };
    const c = ctx(config([]), at(0, 10, 24), state);
    expect(expiredGrants(c)).toEqual([]);
    expect(expiredGrants({ ...c, now: at(0, 10, 20) + 5 * MINUTE + 1 })).toHaveLength(1);
  });

  it('a metered break ends when its minutes are used up', () => {
    const state = defaultState();
    state.grants.push(grant({ remaining: 0 }));
    expect(expiredGrants(ctx(config([]), at(0, 10), state))).toHaveLength(1);
  });
});
