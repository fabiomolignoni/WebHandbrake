import { describe, expect, it } from 'vitest';
import { applyUnits, classify, comparePolicies, diffConfig, isStale } from '../../src/engine/changes';
import { delayIntervention, newPolicy } from '../../src/engine/defaults';
import type { Config, Policy } from '../../src/engine/types';
import { BLOCK, config, group, t } from './helpers';

const office = { mode: 'during' as const, windows: [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }] };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function classifyAll(a: Config, b: Config) {
  return diffConfig(a, b).map((u) => [u.kind, classify(u, a)] as const);
}

describe('change classification (PRO-02)', () => {
  const base = config([
    group('Social', ['reddit.com', '+reddit.com/r/rust'], [{ schedule: office, intervention: BLOCK }]),
  ]);

  it('adding a site is strengthening, removing it is weakening', () => {
    const b = clone(base);
    b.groups[0].targets.push(t('news.example'));
    expect(classifyAll(base, b)).toEqual([['target.add', 'strengthen']]);
    const c = clone(base);
    c.groups[0].targets = c.groups[0].targets.filter((x) => x.value !== 'reddit.com');
    expect(classifyAll(base, c)).toEqual([['target.remove', 'weaken']]);
  });

  it('exceptions work the other way round', () => {
    const b = clone(base);
    b.groups[0].targets = b.groups[0].targets.filter((x) => !x.allow);
    expect(classifyAll(base, b)).toEqual([['target.remove', 'strengthen']]);
    const c = clone(base);
    c.groups[0].targets.push(t('+reddit.com/r/books'));
    expect(classifyAll(base, c)).toEqual([['target.add', 'weaken']]);
  });

  it('renaming is neutral, disabling is weakening, new groups are strengthening', () => {
    const b = clone(base);
    b.groups[0].name = 'Social media';
    expect(classifyAll(base, b)).toEqual([['group.field', 'neutral']]);
    const c = clone(base);
    c.groups[0].enabled = false;
    expect(classifyAll(base, c)).toEqual([['group.field', 'weaken']]);
    const d = clone(base);
    d.groups.push(group('New', ['x.com'], [{ intervention: BLOCK }]));
    expect(classifyAll(base, d)).toEqual([['group.add', 'strengthen']]);
  });

  it('allowlist additions are weakening', () => {
    const b = clone(base);
    b.allowlist.push(t('bank.example'));
    expect(classifyAll(base, b)).toEqual([['target.add', 'weaken']]);
  });

  it('settings', () => {
    const b = clone(base);
    b.settings.theme = 'dark';
    b.settings.protection.level = 'strict';
    b.settings.tracking.idleSeconds = 600;
    expect(classifyAll(base, b)).toEqual([
      ['setting', 'neutral'],
      ['setting', 'weaken'],
      ['setting', 'strengthen'],
    ]);
  });

  it('a gentler level loosens nothing while nothing is protected yet (first run)', () => {
    const empty = config([]);
    const next = clone(empty);
    next.settings.protection.level = 'soft';
    next.groups.push(group('Video', ['video.test'], [{ schedule: office, intervention: BLOCK }]));
    const dirs = (opts: { unprotected?: boolean }) =>
      diffConfig(empty, next).map((u) => classify(u, empty, opts));
    expect(dirs({ unprotected: true })).toEqual(['strengthen', 'neutral']);
    // A running focus session restricts without rules: the caller reports it as protected.
    expect(dirs({ unprotected: false })).toEqual(['strengthen', 'weaken']);
    expect(dirs({})).toEqual(['strengthen', 'weaken']);
    // With rules, lowering the level is always a weakening.
    const lower = clone(base);
    lower.settings.protection.level = 'soft';
    expect(diffConfig(base, lower).map((u) => classify(u, base, { unprotected: true }))).toEqual(['weaken']);
    // Locked stays locked.
    const locked = clone(empty);
    locked.settings.protection.level = 'locked';
    const unlocked = clone(locked);
    unlocked.settings.protection.level = 'soft';
    expect(diffConfig(locked, unlocked).map((u) => classify(u, locked, { unprotected: true }))).toEqual([
      'weaken',
    ]);
  });
});

describe('policy comparison', () => {
  const p = (partial: Partial<Policy>, id = 'p1') => newPolicy({ id, ...partial });

  it('stricter intervention under the same condition', () => {
    expect(
      comparePolicies(
        [p({ intervention: delayIntervention(30) })],
        [p({ intervention: delayIntervention(60) })],
      ),
    ).toBe('strengthen');
    expect(comparePolicies([p({ intervention: delayIntervention(30) })], [p({ intervention: BLOCK })])).toBe(
      'strengthen',
    );
    expect(comparePolicies([p({ intervention: BLOCK })], [p({ intervention: delayIntervention(60) })])).toBe(
      'weaken',
    );
  });

  it('wider windows are stricter only for the most severe policy', () => {
    const wide = { mode: 'during' as const, windows: [{ days: [1, 2, 3, 4, 5], start: 480, end: 1080 }] };
    expect(comparePolicies([p({ schedule: office })], [p({ schedule: wide })])).toBe('strengthen');
    expect(comparePolicies([p({ schedule: wide })], [p({ schedule: office })])).toBe('weaken');
    // A wider delay window would shadow a later block: weakening.
    const later = p({ intervention: BLOCK }, 'p2');
    expect(
      comparePolicies(
        [p({ schedule: office, intervention: delayIntervention(10) }), later],
        [p({ schedule: wide, intervention: delayIntervention(10) }), later],
      ),
    ).toBe('weaken');
  });

  it('smaller budgets are stricter; removing a budget makes the policy unconditional', () => {
    const budget = (minutes: number) => ({
      type: 'time' as const,
      minutes,
      period: { kind: 'day' as const },
    });
    expect(comparePolicies([p({ budget: budget(45) })], [p({ budget: budget(30) })])).toBe('strengthen');
    expect(comparePolicies([p({ budget: budget(30) })], [p({ budget: budget(45) })])).toBe('weaken');
    expect(comparePolicies([p({ budget: budget(30) })], [p({})])).toBe('strengthen');
  });

  it('a policy placed before a stricter one of the same severity is a weakening (regression)', () => {
    const long = p({ intervention: delayIntervention(60) }, 'p2');
    // A 1 s delay inserted before a 60 s delay shadows it.
    expect(comparePolicies([long], [p({ intervention: delayIntervention(1) }), long])).toBe('weaken');
    // The same delay first changes nothing; a block first is stronger.
    expect(comparePolicies([long], [p({ intervention: delayIntervention(60) }), long])).toBe('strengthen');
    expect(comparePolicies([long], [p({ intervention: BLOCK }), long])).toBe('strengthen');
    // Widening the window of a short delay that precedes a long one is a weakening too.
    const wide = { mode: 'during' as const, windows: [{ days: [1, 2, 3, 4, 5], start: 480, end: 1080 }] };
    expect(
      comparePolicies(
        [p({ schedule: office, intervention: delayIntervention(1) }), long],
        [p({ schedule: wide, intervention: delayIntervention(1) }), long],
      ),
    ).toBe('weaken');
  });

  it('a shorter wait before the intention question is a weakening', () => {
    const ask = (seconds: number) =>
      p({ intervention: { type: 'ask', seconds, choices: [5], maxMinutes: 15 } });
    expect(comparePolicies([ask(30)], [ask(0)])).toBe('weaken');
    expect(comparePolicies([ask(0)], [ask(30)])).toBe('strengthen');
  });

  it('appending is strengthening, removing or reordering is weakening', () => {
    const a = p({ intervention: delayIntervention(10) });
    const b = p({ intervention: BLOCK }, 'p2');
    expect(comparePolicies([a], [a, b])).toBe('strengthen');
    expect(comparePolicies([a, b], [a])).toBe('weaken');
    expect(comparePolicies([a, b], [b, a])).toBe('weaken');
  });
});

describe('applying units', () => {
  it('applies and detects stale pending units', () => {
    const a = config([group('G', ['a.com'], [{ intervention: BLOCK }])]);
    const b = clone(a);
    b.groups[0].targets = [];
    const units = diffConfig(a, b);
    const applied = applyUnits(a, units, 1);
    expect(applied.groups[0].targets).toEqual([]);
    expect(applied.groups[0].rev).toBe(2);
    expect(isStale(units[0], applied)).toBe(true);
    expect(isStale(units[0], a)).toBe(false);
  });
});

describe('shared lists created in the same save', () => {
  it('linking a new list with exceptions is a weakening (protection bypass regression)', () => {
    const a = config([group('Social', ['reddit.com'], [{ intervention: BLOCK }])]);
    const b = clone(a);
    b.lists.push({ id: 'L', rev: 1, updatedAt: 0, name: 'Loophole', targets: [t('+reddit.com')] });
    b.groups[0].lists.push('L');
    const res = diffConfig(a, b).map((u) => [u.kind, classify(u, a)]);
    expect(res).toContainEqual(['group.link', 'weaken']);
  });

  it('linking an existing list edited in the same save is judged by its new entries', () => {
    const a = config([group('Social', ['reddit.com'], [{ intervention: BLOCK }])]);
    a.lists.push({ id: 'L', rev: 1, updatedAt: 0, name: 'List', targets: [t('x.com')] });
    const b = clone(a);
    b.lists[0].targets.push(t('+reddit.com'));
    b.groups[0].lists.push('L');
    const res = diffConfig(a, b).map((u) => [u.kind, classify(u, a)]);
    expect(res).toContainEqual(['group.link', 'weaken']);
  });
});

describe('pause policy normalisation', () => {
  it('keeps "no limit" when the limit is absent', async () => {
    const { normalizePause } = await import('../../src/engine/schema');
    const p = normalizePause({
      allowed: true,
      scopes: ['site'],
      duration: { mode: 'fixed', minutes: 5 },
      limit: { period: { kind: 'day' } },
      cost: { type: 'none' },
      reason: 'none',
      metered: false,
    });
    expect(p.limit).toEqual({ period: { kind: 'day' } });
    expect(p.cost).toEqual({ type: 'none' });
    expect(normalizePause({ limit: { count: 2, period: { kind: 'week' } } }).limit).toEqual({
      count: 2,
      period: { kind: 'week' },
    });
  });
});
