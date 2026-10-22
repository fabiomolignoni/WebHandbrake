import { describe, expect, it } from 'vitest';
import {
  applyUnits,
  type ChangeUnit,
  classify,
  classifySetting,
  compareInterventions,
  compareOptions,
  comparePause,
  comparePolicies,
  compareProtection,
  compareSchedules,
  deepEqual,
  diffConfig,
  getPath,
  isStale,
  scheduleBitmap,
  unusedExceptions,
} from '../../src/engine/changes';
import { defaultOptions, defaultPause, delayIntervention, newPolicy } from '../../src/engine/defaults';
import { scheduleActive } from '../../src/engine/time';
import type { Budget, Config, Intervention, PausePolicy, Policy, Schedule } from '../../src/engine/types';
import { BLOCK, config, group, t } from './helpers';

const NOW = 1_000_000;
const day = { kind: 'day' as const };

/** The direction of a change of the only condition of a rule. */
function conditionChange(before: Partial<Policy>, after: Partial<Policy>) {
  return comparePolicies([newPolicy({ id: 'p', ...before })], [newPolicy({ id: 'p', ...after })]);
}

describe('helpers', () => {
  it('deepEqual treats a missing field like an undefined or null one', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: null }, {})).toBe(true);
    expect(deepEqual([1, { x: 2 }], [1, { x: 2 }])).toBe(true);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual({ a: 0 }, {})).toBe(false);
    expect(getPath({ a: { b: { c: 3 } } }, 'a.b.c')).toBe(3);
    expect(getPath({ a: 1 }, 'a.b')).toBeUndefined();
  });

  it('schedules compare minute by minute over the week', () => {
    const office = { mode: 'during' as const, windows: [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }] };
    const longer = { mode: 'during' as const, windows: [{ days: [1, 2, 3, 4, 5], start: 480, end: 1020 }] };
    const other = { mode: 'during' as const, windows: [{ days: [6], start: 540, end: 1020 }] };
    expect(compareSchedules(office, office)).toBe('equal');
    expect(compareSchedules(office, longer)).toBe('superset');
    expect(compareSchedules(longer, office)).toBe('subset');
    expect(compareSchedules(office, other)).toBe('other');
    expect(compareSchedules(office, { mode: 'always', windows: [] })).toBe('superset');
    expect(compareSchedules({ mode: 'outside', windows: office.windows }, office)).toBe('other');
    // A window past midnight and one that ends where it starts.
    const night = { mode: 'during' as const, windows: [{ days: [1], start: 1380, end: 60 }] };
    const fullDay = { mode: 'during' as const, windows: [{ days: [1], start: 600, end: 600 }] };
    // Monday 23:00–01:00 lies within the 24 hours from Monday 10:00.
    expect(compareSchedules(night, fullDay)).toBe('superset');
    expect(
      compareSchedules({ mode: 'during', windows: [{ days: [1], start: 1380, end: 1440 }] }, night),
    ).toBe('superset');
  });

  it('schedules are compared on the logical days that the engine applies them on', () => {
    const schedules: Schedule[] = [
      { mode: 'during', windows: [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }] },
      { mode: 'during', windows: [{ days: [1], start: 60, end: 1380 }] },
      { mode: 'during', windows: [{ days: [6], start: 1380, end: 120 }] },
      { mode: 'during', windows: [{ days: [0, 3], start: 0, end: 1440 }] },
      { mode: 'outside', windows: [{ days: [2], start: 200, end: 200 }] },
    ];
    // A week without a change of the clocks, from Sunday 4 October 2026 at midnight.
    const sunday = new Date(2026, 9, 4).getTime();
    for (const dayStart of [0, 300]) {
      const cal = { dayStart, weekStart: 1 };
      for (const s of schedules) {
        const bits = scheduleBitmap(s, dayStart);
        for (let m = 0; m < 7 * 1440; m += 15)
          expect([dayStart, m, bits[m] === 1]).toEqual([
            dayStart,
            m,
            scheduleActive(s, sunday + m * 60_000, cal),
          ]);
      }
    }
  });

  it('a window that starts before the day start belongs to the night after its day', () => {
    // With days starting at 05:00, "Monday 01:00–23:00" runs on Tuesday: Monday daytime is left free.
    const monday = { mode: 'during' as const, windows: [{ days: [1], start: 360, end: 1320 }] };
    const early = { mode: 'during' as const, windows: [{ days: [1], start: 60, end: 1380 }] };
    expect(compareSchedules(monday, early)).toBe('superset');
    expect(compareSchedules(monday, early, 300)).toBe('other');
    const c = config([group('g', ['a.com'], [{ schedule: monday }])], (x) => {
      x.settings.dayStart = 300;
    });
    const unit: ChangeUnit = {
      kind: 'group.field',
      groupId: 'g',
      name: 'g',
      field: 'policies',
      base: c.groups[0].policies,
      value: [{ ...c.groups[0].policies[0], schedule: early }],
    };
    expect(classify(unit, c)).toBe('weaken');
  });
});

describe('limits', () => {
  const time = (minutes: number, period = day): Budget => ({ type: 'time', minutes, period });
  const change = (a?: Budget, b?: Budget) =>
    conditionChange({ budget: a, intervention: BLOCK }, { budget: b, intervention: BLOCK });

  it('less time, fewer visits or shorter use in a row restrict sooner', () => {
    expect(change(time(30), time(20))).toBe('strengthen');
    expect(change(time(20), time(30))).toBe('weaken');
    const visits = (count: number, max?: number): Budget => ({
      type: 'visits',
      count,
      period: day,
      maxVisitMinutes: max,
    });
    expect(change(visits(3), visits(2))).toBe('strengthen');
    expect(change(visits(3), visits(3, 10))).toBe('strengthen');
    expect(change(visits(3, 10), visits(3))).toBe('weaken');
    // Fewer visits but longer ones: not provably stricter.
    expect(change(visits(3, 5), visits(2, 10))).toBe('weaken');
    const run = (max: number, stop: number): Budget => ({
      type: 'session',
      maxMinutes: max,
      cooldownMinutes: stop,
    });
    expect(change(run(20, 30), run(10, 60))).toBe('strengthen');
    expect(change(run(20, 30), run(20, 10))).toBe('weaken');
  });

  it('another period, another kind of limit or per site cannot be compared', () => {
    expect(change(time(30), time(30, { kind: 'week' } as never))).toBe('weaken');
    expect(change(time(30), { type: 'visits', count: 1, period: day })).toBe('weaken');
    expect(change(time(30), { ...time(30), perSite: true })).toBe('weaken');
    // Removing the limit makes the condition apply always; adding one makes it apply less.
    expect(change(time(30), undefined)).toBe('strengthen');
    expect(change(undefined, time(30))).toBe('weaken');
  });
});

describe('interventions of the same severity', () => {
  const cmp = (a: Intervention, b: Intervention) => compareInterventions(a, b);
  const delay = delayIntervention(30) as Extract<Intervention, { type: 'delay' }>;

  it('a wait: longer, growing, without automatic continuation, restarting on blur, narrower access', () => {
    expect(cmp(delay, { ...delay, seconds: 60 })).toBe('strengthen');
    expect(cmp(delay, { ...delay, randomTo: 90 })).toBe('strengthen');
    expect(cmp(delay, { ...delay, increase: 5 })).toBe('strengthen');
    expect(cmp(delay, { ...delay, autoContinue: true })).toBe('weaken');
    expect(cmp(delay, { ...delay, onBlur: 'restart' })).toBe('strengthen');
    expect(cmp(delay, { ...delay, onBlur: 'ignore' })).toBe('weaken');
    expect(cmp(delay, { ...delay, grant: { scope: 'page', mode: 'visit' } })).toBe('strengthen');
    expect(cmp(delay, { ...delay, grant: { scope: 'site', mode: 'minutes', minutes: 5 } })).toBe('weaken');
    const minutes = { ...delay, grant: { scope: 'site' as const, mode: 'minutes' as const, minutes: 10 } };
    expect(cmp(minutes, { ...minutes, grant: { ...minutes.grant, minutes: 5 } })).toBe('strengthen');
  });

  it('a challenge: longer is stricter; another kind or phrase is not comparable', () => {
    const c = { type: 'challenge' as const, kind: 'random' as const, length: 24, grant: delay.grant };
    expect(cmp(c, { ...c, length: 40 })).toBe('strengthen');
    expect(cmp(c, { ...c, kind: 'math' })).toBe('weaken');
    const p = { ...c, kind: 'phrase' as const, phrase: 'I choose' };
    expect(cmp(p, { ...p, phrase: 'Other' })).toBe('weaken');
  });

  it('a question: less time, a longer reason', () => {
    const a = { type: 'ask' as const, maxMinutes: 15, minReasonLength: 10 };
    expect(cmp(a, { ...a, maxMinutes: 10 })).toBe('strengthen');
    expect(cmp(a, { ...a, maxMinutes: 30 })).toBe('weaken');
    expect(cmp(a, { ...a, minReasonLength: 20 })).toBe('strengthen');
    expect(cmp(a, { ...a, minReasonLength: 1 })).toBe('weaken');
  });

  it('a filter: stronger; another filter is not comparable', () => {
    const f = { type: 'filter' as const, filter: 'grayscale' as const, intensity: 50 };
    expect(cmp(f, { ...f, intensity: 80 })).toBe('strengthen');
    expect(cmp(f, { ...f, filter: 'blur' })).toBe('weaken');
  });

  it('block and redirect are as strict; the gentlest kinds have no settings', () => {
    expect(cmp(BLOCK, { type: 'redirect', url: 'https://x.test' })).toBe('neutral');
    expect(
      cmp({ type: 'redirect', url: 'https://x.test' }, { type: 'redirect', url: 'https://y.test' }),
    ).toBe('neutral');
    expect(cmp({ type: 'close' }, { type: 'close' })).toBe('neutral');
    expect(cmp({ type: 'track' }, { type: 'allow' })).toBe('weaken');
  });
});

describe('protections', () => {
  it('Locked and Permanent compared with each other and with the rest', () => {
    expect(compareProtection({ kind: 'locked', until: 5 }, { kind: 'locked', until: 9 })).toBe('strengthen');
    expect(compareProtection({ kind: 'locked', until: 9 }, { kind: 'locked', until: 5 })).toBe('weaken');
    expect(compareProtection({ kind: 'permanent' }, { kind: 'locked', until: 9 })).toBe('weaken');
    expect(compareProtection({ kind: 'wait', seconds: 30 }, { kind: 'locked', until: 9 })).toBe('strengthen');
    expect(compareProtection({ kind: 'locked', until: 9 }, { kind: 'reminder' })).toBe('weaken');
    expect(compareProtection({ kind: 'wait', seconds: 30 }, { kind: 'reminder' })).toBe('weaken');
  });
});

describe('breaks and options', () => {
  const base = (): PausePolicy => ({ ...defaultPause(), allowed: true });

  it('fewer, shorter, costlier breaks are stricter', () => {
    const p = base();
    expect(comparePause(p, structuredClone(p))).toBe('neutral');
    expect(comparePause(p, { ...p, allowed: false })).toBe('strengthen');
    expect(comparePause({ ...p, allowed: false }, p)).toBe('weaken');
    expect(comparePause({ ...p, allowed: false }, { ...p, allowed: false, maxMinutes: 60 })).toBe('neutral');
    expect(comparePause(p, { ...p, maxMinutes: 5 })).toBe('strengthen');
    expect(comparePause(p, { ...p, maxMinutes: 30 })).toBe('weaken');
    expect(comparePause(p, { ...p, limit: { ...p.limit, count: 1 } })).toBe('strengthen');
    expect(comparePause(p, { ...p, limit: { count: 3, period: day } })).toBe('weaken');
    expect(comparePause(p, { ...p, limit: { ...p.limit, period: { kind: 'week' } } })).toBe('weaken');
    expect(comparePause(p, { ...p, cost: { type: 'password' } })).toBe('strengthen');
    expect(comparePause(p, { ...p, cost: { type: 'confirm' } })).toBe('weaken');
    const challenge = { ...p, cost: { type: 'challenge' as const, kind: 'random' as const, length: 24 } };
    expect(
      comparePause(challenge, { ...challenge, cost: { type: 'challenge', kind: 'math', length: 24 } }),
    ).toBe('weaken');
  });

  it('rule options: every window, embedded frames, every tab are stricter', () => {
    const o = defaultOptions();
    expect(compareOptions(o, { ...o, privacy: 'private' })).toBe('weaken');
    expect(compareOptions({ ...o, privacy: 'normal' }, o)).toBe('strengthen');
    expect(compareOptions(o, { ...o, embeds: true })).toBe('strengthen');
    expect(compareOptions(o, { ...o, tabs: 'active' })).toBe('weaken');
    expect(compareOptions(o, { ...o, timer: false, quickSession: false })).toBe('neutral');
  });
});

describe('settings', () => {
  it('appearance and notices are neutral; what counts time and what protects is not', () => {
    expect(classifySetting('theme', 'light', 'dark')).toBe('neutral');
    expect(classifySetting('timer.corner', 'top-left', 'bottom-left')).toBe('neutral');
    // A shorter inactivity delay stops counting sooner: less time is counted.
    expect(classifySetting('tracking.idleSeconds', 120, 60)).toBe('weaken');
    expect(classifySetting('tracking.idleSeconds', 120, 600)).toBe('strengthen');
    expect(classifySetting('tracking.visitGapMinutes', 5, 30)).toBe('weaken');
    expect(classifySetting('tracking.idleEnabled', true, false)).toBe('strengthen');
    expect(classifySetting('tracking.countAudio', false, true)).toBe('strengthen');
    expect(classifySetting('protection.emergencyHours', 24, 4)).toBe('weaken');
    expect(classifySetting('protection.internalPagesFollowPause', false, true)).toBe('weaken');
    expect(classifySetting('protection.internalPages', 'auto', 'always')).toBe('strengthen');
    expect(classifySetting('protection.internalPages', 'auto', 'never')).toBe('weaken');
    expect(classifySetting('pauseLimit', { count: 5, period: day }, { count: 3, period: day })).toBe(
      'strengthen',
    );
    expect(classifySetting('pauseLimit', { count: 5, period: day }, { period: day })).toBe('weaken');
    expect(classifySetting('pauseLimit', { period: day }, { period: { kind: 'week' } })).toBe('weaken');
    expect(classifySetting('dayStart', 0, 240)).toBe('weaken');
    expect(classifySetting('dayStart', 0, 0)).toBe('neutral');
  });
});

describe('every kind of change, from the diff to the configuration', () => {
  function initial(): Config {
    return config([
      group('A', ['a.test', '+a.test/help'], [{ intervention: BLOCK }]),
      group('B', ['b.test'], [{ intervention: BLOCK }]),
    ]);
  }

  it('finds, classifies and applies each change; applied changes are stale', () => {
    const a = initial();
    const b = structuredClone(a);
    b.groups.reverse(); // order
    const ga = b.groups.find((g) => g.id === 'A')!;
    ga.targets.push(t('a2.test')); // target.add
    ga.targets = ga.targets.filter((x) => !x.allow); // target.remove of an exception
    b.groups.find((g) => g.id === 'B')!.targets = []; // target.remove
    b.settings.theme = 'dark'; // setting

    const units = diffConfig(a, b);
    expect(units.map((u) => u.kind).sort()).toEqual(
      ['order', 'setting', 'target.add', 'target.remove', 'target.remove'].sort(),
    );
    const direction = Object.fromEntries(
      units.map((u) => [`${u.kind}:${JSON.stringify(u).length}`, classify(u, a)]),
    );
    expect(Object.values(direction)).not.toContain(undefined);
    // Removing a site loosens; removing an exception tightens.
    const removed = units.filter((u) => u.kind === 'target.remove');
    expect(removed.map((u) => classify(u, a)).sort()).toEqual(['strengthen', 'weaken']);
    expect(classify(units.find((u) => u.kind === 'order')!, a)).toBe('neutral');

    const applied = applyUnits(a, units, NOW);
    expect(diffConfig(applied, b)).toEqual([]);
    expect(applied.groups.find((g) => g.id === 'A')!.rev).toBeGreaterThan(1);
    // The order can be applied again (it is neutral); every other change is done.
    for (const u of units.filter((x) => x.kind !== 'order')) expect(isStale(u, applied), u.kind).toBe(true);
    // The input is never changed.
    expect(a.groups.map((g) => g.id)).toEqual(['A', 'B']);
  });

  it('removing a rule leaves a tombstone; adding it back removes it', () => {
    const a = initial();
    const b = structuredClone(a);
    b.groups = b.groups.filter((g) => g.id !== 'B');
    const units = diffConfig(a, b);
    expect(units.map((u) => u.kind)).toEqual(['group.remove']);
    expect(classify(units[0], a)).toBe('weaken');
    const applied = applyUnits(a, units, NOW);
    expect(applied.tombstones.map((x) => [x.kind, x.id])).toEqual([['group', 'B']]);
    const add: ChangeUnit = { kind: 'group.add', group: a.groups[1] };
    const back = applyUnits(applied, [add], NOW);
    expect(back.tombstones).toEqual([]);
    expect(isStale(add, back)).toBe(true);
    // Adding twice does nothing more.
    expect(applyUnits(back, [add], NOW).groups).toHaveLength(2);
  });

  it('changes to rules that are off or archived are neutral', () => {
    const a = initial();
    a.groups[1].enabled = false;
    const off = a.groups[1];
    const units: ChangeUnit[] = [
      { kind: 'group.remove', groupId: 'B', name: 'B', base: off },
      { kind: 'group.field', groupId: 'B', name: 'B', field: 'policies', value: [], base: off.policies },
      { kind: 'group.field', groupId: 'B', name: 'B', field: 'pause', value: {}, base: off.pause },
      { kind: 'group.field', groupId: 'B', name: 'B', field: 'archived', value: true, base: false },
      { kind: 'target.remove', owner: { kind: 'group', id: 'B' }, ownerName: 'B', target: off.targets[0] },
    ];
    for (const u of units) expect(classify(u, a), u.kind).toBe('neutral');
  });

  it('a pending change is stale once the configuration it was made for has moved on', () => {
    const a = initial();
    const setting: ChangeUnit = { kind: 'setting', path: 'theme', value: 'dark', base: 'light' };
    expect(isStale(setting, a)).toBe(true);
    expect(isStale({ ...setting, base: a.settings.theme }, a)).toBe(false);
    const field: ChangeUnit = {
      kind: 'group.field',
      groupId: 'A',
      name: 'A',
      field: 'meta',
      value: {},
      base: { name: 'A', color: a.groups[0].color, icon: a.groups[0].icon },
    };
    expect(isStale(field, a)).toBe(false);
    expect(isStale({ ...field, groupId: 'gone' }, a)).toBe(true);
    // A field of an earlier version is never applied.
    expect(isStale({ ...field, field: 'level' as never }, a)).toBe(true);
    // Nor are the shared lists and Always allowed of earlier versions.
    const listed = { kind: 'list', id: 'L' } as never;
    expect(isStale({ kind: 'target.add', owner: listed, ownerName: '', target: t('x.test') }, a)).toBe(true);
    expect(isStale({ kind: 'list.name', listId: 'L', value: 'x', base: 'y' } as never, a)).toBe(true);
    expect(isStale({ kind: 'order', ids: [] }, a)).toBe(false);
  });

  it('a setting is applied at its path, creating what is missing', () => {
    const a = initial();
    const next = applyUnits(
      a,
      [{ kind: 'setting', path: 'future.flag', value: { on: true }, base: undefined }],
      NOW,
    );
    expect(getPath(next.settings, 'future.flag.on')).toBe(true);
  });
});

describe('exceptions that are never used', () => {
  it('an exception outside every blocked site does nothing', () => {
    expect(
      unusedExceptions([t('a.test'), t('+a.test/help'), t('+other.test'), t('+*.sub.a.test')]).map(
        (x) => x.value,
      ),
    ).toEqual(['other.test']);
    // Without blocking entries every exception is unused.
    expect(unusedExceptions([t('+a.test')])).toHaveLength(1);
  });
});
