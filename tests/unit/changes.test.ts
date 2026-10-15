import { describe, expect, it } from 'vitest';
import {
  applyUnits,
  classify,
  compareInterventions,
  comparePolicies,
  compareProtection,
  diffConfig,
  isStale,
  ruleProtection,
  unitGroups,
} from '../../src/engine/changes';
import { delayIntervention, newPolicy, pausePolicyFor } from '../../src/engine/defaults';
import type { Config, Group, Policy, Target } from '../../src/engine/types';
import { BLOCK, config, group, lockedUntil, PERMANENT, REMINDER, t, wait } from './helpers';

const office = { mode: 'during' as const, windows: [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }] };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function classifyAll(a: Config, b: Config) {
  return diffConfig(a, b).map((u) => [u.kind, classify(u, a)] as const);
}

describe('change classification', () => {
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
    b.settings.protection.emergencyHours = 48;
    b.settings.tracking.idleSeconds = 600;
    expect(classifyAll(base, b)).toEqual([
      ['setting', 'neutral'],
      ['setting', 'weaken'],
      ['setting', 'strengthen'],
    ]);
  });
});

describe('the protection of a rule', () => {
  const PW = { kind: 'password', hash: 'pbkdf2-sha256$1000$c2FsdA==$aGFzaA==' } as const;
  const PARTNER = { kind: 'partner', secret: 'A'.repeat(32), breaks: true } as const;

  it('Permanent is the firmest, then Locked (a later date is firmer), and Reminder the gentlest', () => {
    expect(compareProtection(REMINDER, wait(30))).toBe('strengthen');
    expect(compareProtection(wait(30), REMINDER)).toBe('weaken');
    expect(compareProtection(wait(30), wait(3600))).toBe('strengthen');
    expect(compareProtection(wait(3600), wait(30))).toBe('weaken');
    expect(compareProtection(PW, lockedUntil(1000))).toBe('strengthen');
    expect(compareProtection(lockedUntil(1000), lockedUntil(2000))).toBe('strengthen');
    expect(compareProtection(lockedUntil(2000), lockedUntil(1000))).toBe('weaken');
    expect(compareProtection(lockedUntil(2000), PERMANENT)).toBe('strengthen');
    expect(compareProtection(PERMANENT, lockedUntil(2000))).toBe('weaken');
    expect(compareProtection(PERMANENT, PERMANENT)).toBe('neutral');
  });

  it('a wait, a password and a partner code cannot be compared: changing between them is a loosening', () => {
    expect(compareProtection(wait(3600), PW)).toBe('weaken');
    expect(compareProtection(PW, PARTNER)).toBe('weaken');
    expect(compareProtection(PARTNER, wait(30))).toBe('weaken');
    expect(compareProtection(PW, { ...PW, hash: 'pbkdf2-sha256$1000$c2FsdA==$b3RoZXI=' })).toBe('weaken');
    expect(compareProtection(PARTNER, { ...PARTNER, secret: 'B'.repeat(32) })).toBe('weaken');
    // The same partner's code asked for breaks is firmer.
    expect(compareProtection({ ...PARTNER, breaks: false }, PARTNER)).toBe('strengthen');
    expect(compareProtection(PARTNER, { ...PARTNER, breaks: false })).toBe('weaken');
  });

  it('is one change of the rule, neutral while the rule is off', () => {
    const base = config([
      group('Video', ['video.test'], [{ intervention: BLOCK }], { protection: REMINDER }),
    ]);
    const to = (p: Group['protection'], from = base) => {
      const b = clone(from);
      b.groups[0].protection = p;
      return classifyAll(from, b);
    };
    expect(to(PW)).toEqual([['group.field', 'strengthen']]);
    const off = clone(base);
    off.groups[0].enabled = false;
    off.groups[0].protection = PERMANENT;
    expect(to(REMINDER, off)).toEqual([['group.field', 'neutral']]);
    // Applying it replaces the protection with its secret, or without one.
    const next = clone(base);
    next.groups[0].protection = PW;
    const withPw = applyUnits(base, diffConfig(base, next), 1);
    expect(withPw.groups[0].protection).toEqual(PW);
  });

  it('Locked asks only for a reminder after its date, Permanent never ends; their breaks are none', () => {
    const g = group('Bets', ['bet.test'], [{ intervention: BLOCK }], { protection: lockedUntil(1000) });
    expect(ruleProtection(g, 999)).toEqual(lockedUntil(1000));
    expect(ruleProtection(g, 1000)).toEqual(REMINDER);
    expect(ruleProtection({ ...g, protection: PERMANENT }, Number.MAX_SAFE_INTEGER)).toEqual(PERMANENT);
    expect(pausePolicyFor(PERMANENT).allowed).toBe(false);
    expect(pausePolicyFor(lockedUntil(1000)).allowed).toBe(false);
  });

  it('the breaks of a new rule follow its protection', () => {
    expect(pausePolicyFor(REMINDER).cost).toEqual({ type: 'confirm' });
    expect(pausePolicyFor(wait(45)).cost).toEqual({ type: 'delay', seconds: 45 });
    expect(pausePolicyFor(wait(3600)).cost).toMatchObject({ type: 'challenge' });
    expect(pausePolicyFor(PW).cost).toEqual({ type: 'password' });
    expect(pausePolicyFor(PARTNER).cost).toEqual({ type: 'confirm' });
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

describe('the rules a change follows', () => {
  const T0 = Date.UTC(2026, 9, 12, 12);
  const rules = config([
    group('Soft', ['news.example'], [{ intervention: BLOCK }], { protection: REMINDER }),
    group('Balanced', ['video.example'], [{ intervention: BLOCK }], { protection: wait(30) }),
    group('Strict', ['bet.example'], [{ intervention: BLOCK }], { protection: wait(86_400) }),
    group('Locked', ['casino.example'], [{ intervention: BLOCK }], {
      protection: lockedUntil(T0 + 86_400_000),
    }),
    group('Off', ['social.example'], [{ intervention: BLOCK }], { protection: PERMANENT, enabled: false }),
  ]);
  const touched = (mutate: (c: Config) => void, base = rules) => {
    const next = clone(base);
    mutate(next);
    return diffConfig(base, next).map((u) => unitGroups(u, base));
  };
  const allow =
    (value: string, type: Target['type'] = 'domain') =>
    (c: Config) =>
      c.allowlist.push({ id: `a-${value}`, type, value });

  it('an Always allowed entry follows the active rules whose sites it may open', () => {
    expect(touched(allow('m.video.example'))).toEqual([['Balanced']]);
    expect(touched(allow('example'))).toEqual([['Soft', 'Balanced', 'Strict', 'Locked']]);
    expect(touched(allow('bank.example'))).toEqual([[]]);
    // A rule that is off restricts nothing.
    expect(touched(allow('social.example'))).toEqual([[]]);
    // Wildcards are widened to what follows them; anything else may open every rule's sites.
    expect(touched(allow('*.bet.example'))).toEqual([['Strict']]);
    expect(touched(allow('casino.*'))).toEqual([['Soft', 'Balanced', 'Strict', 'Locked']]);
    expect(touched(allow('news.example/today*', 'wildcard'))).toEqual([['Soft']]);
    expect(touched(allow('*news*', 'wildcard'))).toEqual([['Soft', 'Balanced', 'Strict', 'Locked']]);
    expect(touched(allow('^https://bank\\.example/', 'regex'))).toEqual([
      ['Soft', 'Balanced', 'Strict', 'Locked'],
    ]);
  });

  it('a setting that concerns every rule follows every active rule; a shared list, the active rules using it', () => {
    expect(touched((c) => (c.settings.dayStart = 240))).toEqual([['Soft', 'Balanced', 'Strict', 'Locked']]);
    const withList = clone(rules);
    withList.lists = [{ id: 'L', name: 'List', rev: 1, updatedAt: 0, targets: [] }];
    withList.groups[0].lists = ['L'];
    withList.groups[4].lists = ['L'];
    expect(
      touched((c) => c.lists[0].targets.push({ id: 'x', type: 'domain', value: 'x.example' }), withList),
    ).toEqual([['Soft']]);
  });
});

describe('redirect destinations', () => {
  const base = config([group('Video', ['youtube.com'], [{ intervention: BLOCK }])]);
  const toRedirect = (url: string) => {
    const b = clone(base);
    b.groups[0].policies[0].intervention = { type: 'redirect', url };
    return b;
  };

  it("a redirect into the rule's own sites lets that page through, so it is a loosening", () => {
    expect(classifyAll(base, toRedirect('https://www.youtube.com/watch'))).toEqual([
      ['group.field', 'weaken'],
    ]);
    // Elsewhere, Block and Redirect are as strict.
    expect(classifyAll(base, toRedirect('https://news.example/'))).toEqual([['group.field', 'neutral']]);
    // A redirect that already went there changes nothing.
    const already = toRedirect('https://www.youtube.com/watch');
    const other = clone(already);
    other.groups[0].name = 'Videos';
    expect(classifyAll(already, other)).toEqual([['group.field', 'neutral']]);
  });

  it('a new rule is stricter even when it redirects into its own sites: it restricts only more', () => {
    const b = clone(base);
    b.groups.push(
      group('Fun', ['fun.example'], [{ intervention: { type: 'redirect', url: 'https://fun.example/ok' } }]),
    );
    expect(classifyAll(base, b)).toEqual([['group.add', 'strengthen']]);
  });
});

describe('interventions compared with the access they give', () => {
  const ask = (seconds = 0, maxMinutes = 5) =>
    ({ type: 'ask', seconds, choices: [5], maxMinutes }) as const satisfies Policy['intervention'];
  const delay = (
    seconds: number,
    grant: { scope: 'page' | 'site' | 'group'; mode: 'visit' | 'minutes'; minutes?: number },
  ) => ({ type: 'delay', seconds, grant }) as const satisfies Policy['intervention'];
  const math = (grant: { scope: 'page' | 'site' | 'group'; mode: 'visit' | 'minutes'; minutes?: number }) =>
    ({ type: 'challenge', kind: 'math', grant }) as const satisfies Policy['intervention'];

  it('a stronger kind that opens more, or waits less, is a loosening (regression)', () => {
    expect(compareInterventions(ask(60), delay(1, { scope: 'group', mode: 'minutes', minutes: 1440 }))).toBe(
      'weaken',
    );
    expect(
      compareInterventions(
        delay(3600, { scope: 'page', mode: 'visit' }),
        math({ scope: 'group', mode: 'minutes', minutes: 1440 }),
      ),
    ).toBe('weaken');
    expect(compareInterventions(ask(60), delay(1, { scope: 'site', mode: 'visit' }))).toBe('weaken');
  });

  it('up the ladder with the same access stays stricter', () => {
    expect(compareInterventions(ask(), delay(30, { scope: 'site', mode: 'visit' }))).toBe('strengthen');
    expect(
      compareInterventions(
        delay(30, { scope: 'site', mode: 'visit' }),
        math({ scope: 'site', mode: 'visit' }),
      ),
    ).toBe('strengthen');
    expect(compareInterventions(delay(30, { scope: 'site', mode: 'visit' }), BLOCK)).toBe('strengthen');
  });

  it('a new first condition that opens more than the ones after it is a loosening', () => {
    const base = config([
      group('Video', ['video.example'], [{ intervention: delay(600, { scope: 'page', mode: 'visit' }) }]),
    ]);
    const b = clone(base);
    b.groups[0].policies.unshift(
      newPolicy({ id: 'first', intervention: math({ scope: 'group', mode: 'minutes', minutes: 1440 }) }),
    );
    expect(classifyAll(base, b)).toEqual([['group.field', 'weaken']]);
  });
});
