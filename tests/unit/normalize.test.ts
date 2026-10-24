import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/engine/defaults';
import {
  canonicalJson,
  checksum,
  configChecksum,
  looksLikeConfig,
  migrate,
  normalizeConfig,
  normalizeGroup,
  normalizeIntervention,
  normalizePause,
  normalizePeriod,
  normalizePolicy,
  normalizeSettings,
  normalizeTarget,
  normalizeWindows,
} from '../../src/engine/schema';
import { scheduleActive } from '../../src/engine/time';
import { type Group, SCHEMA_VERSION } from '../../src/engine/types';

describe('normalising what is read from storage or a file', () => {
  it('entries: a known type and a value; unsafe expressions and junk are dropped', () => {
    expect(normalizeTarget({ id: 'x', type: 'domain', value: ' a.test ', allow: false, note: '' })).toEqual({
      id: 'x',
      type: 'domain',
      value: 'a.test',
    });
    // Sites had notes in earlier versions: they are dropped.
    const old = normalizeTarget({ type: 'nonsense', value: 'b.test', allow: 1, note: 'n' });
    expect(old).toMatchObject({ type: 'domain', allow: true });
    expect(old).not.toHaveProperty('note');
    expect(normalizeTarget({ type: 'regex', value: '(a+)+$' })).toBeNull();
    expect(normalizeTarget({ type: 'domain', value: '' })).toBeNull();
    expect(normalizeTarget('a.test')).toBeNull();
  });

  it('time windows: weekdays 0–6 once each, minutes within the day', () => {
    expect(normalizeWindows([{ days: [1, 1, 7, -1, 2.5, 3], start: -10, end: 2000 }, 'junk'])).toEqual([
      { days: [1, 3], start: 0, end: 1440 },
    ]);
    expect(normalizeWindows({})).toEqual([]);
  });

  it('periods: a known kind, with a length and an offset only where they mean something', () => {
    expect(normalizePeriod({ kind: 'minutes', n: 1, offset: 9999 })).toEqual({
      kind: 'minutes',
      n: 5,
      offset: 1440,
    });
    expect(normalizePeriod({ kind: 'days', n: 500 })).toEqual({ kind: 'days', n: 90 });
    expect(normalizePeriod({ kind: 'rolling' })).toEqual({ kind: 'rolling', n: 60 });
    expect(normalizePeriod({ kind: 'week', n: 3, offset: 1 })).toEqual({ kind: 'week' });
    expect(normalizePeriod('x')).toEqual({ kind: 'day' });
  });

  it('interventions keep their settings within range; anything unknown blocks', () => {
    expect(normalizeIntervention({ type: 'filter', filter: 'neon', intensity: 300 })).toEqual({
      type: 'filter',
      filter: 'grayscale',
      intensity: 100,
    });
    expect(normalizeIntervention({ type: 'ask', maxMinutes: 2000, minReasonLength: 999 })).toEqual({
      type: 'ask',
      maxMinutes: 1440,
      minReasonLength: 300,
    });
    expect(
      normalizeIntervention({
        type: 'delay',
        seconds: 0,
        randomTo: 50,
        increase: -2,
        onBlur: 'x',
        grant: { scope: 'all' },
      }),
    ).toEqual({
      type: 'delay',
      seconds: 1,
      randomTo: 50,
      autoContinue: false,
      onBlur: 'pause',
      hideCountdown: false,
      grant: { scope: 'site', mode: 'visit' },
    });
    expect(normalizeIntervention({ type: 'delay', seconds: 5, increase: 1000 })).toMatchObject({
      increase: 600,
    });
    expect(
      normalizeIntervention({
        type: 'challenge',
        kind: 'phrase',
        phrase: 'I choose',
        length: 2,
        grant: { mode: 'minutes', minutes: 9999 },
      }),
    ).toEqual({
      type: 'challenge',
      kind: 'phrase',
      length: 4,
      phrase: 'I choose',
      grant: { scope: 'site', mode: 'minutes', minutes: 1440 },
    });
    expect(normalizeIntervention({ type: 'redirect' })).toEqual({ type: 'redirect', url: 'about:blank' });
    expect(normalizeIntervention({ type: 'close', extra: 1 })).toEqual({ type: 'close' });
    expect(normalizeIntervention({ type: 'explode' })).toEqual({ type: 'block' });
    expect(normalizeIntervention(null)).toEqual({ type: 'block' });
  });

  it('interventions of earlier versions lose the settings that are gone', () => {
    // A custom filter or none at all is greyscale; a filter no longer mutes.
    for (const filter of ['custom', 'none'])
      expect(
        normalizeIntervention({ type: 'filter', filter, intensity: 40, css: 'blur(2px)', mute: true }),
      ).toEqual({ type: 'filter', filter: 'grayscale', intensity: 40 });
    // Ask first: the durations offered, the wait and the block afterwards; any reason will do.
    expect(
      normalizeIntervention({
        type: 'ask',
        seconds: 30,
        choices: [5, 30],
        maxMinutes: 20,
        cooldownMinutes: 5,
      }),
    ).toEqual({ type: 'ask', maxMinutes: 20, minReasonLength: 1 });
    // A wait both random and longer each time stays random.
    expect(
      normalizeIntervention({ type: 'delay', seconds: 10, randomTo: 50, increase: 5, grant: {} }),
    ).not.toHaveProperty('increase');
    // A challenge of random characters uses letters and digits.
    expect(
      normalizeIntervention({ type: 'challenge', kind: 'random', charset: 'digits' }),
    ).not.toHaveProperty('charset');
  });

  it('conditions: a schedule, a known limit, what happens', () => {
    const p = normalizePolicy({
      id: 'p',
      schedule: { mode: 'sometimes' },
      budget: { type: 'visits', count: 2.6, period: { kind: 'day' } },
      intervention: { type: 'block' },
    });
    expect(p).toEqual({
      id: 'p',
      schedule: { mode: 'always', windows: [] },
      budget: { type: 'visits', count: 3, period: { kind: 'day' }, perSite: false },
      intervention: { type: 'block' },
    });
    expect(normalizePolicy({ budget: { type: 'time', minutes: 0 } })?.budget).toMatchObject({ minutes: 0.1 });
    expect(normalizePolicy({ budget: { type: 'mystery' } })?.budget).toBeUndefined();
    expect(normalizePolicy(null)).toBeNull();
    expect(normalizePolicy({})?.id).toEqual(expect.any(String));
  });

  it('conditions of earlier versions: a limit at all times, starting again every so often', () => {
    const office = [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }];
    const limit = (budget: Record<string, unknown>) =>
      normalizePolicy({
        schedule: { mode: 'during', windows: office },
        budget,
        intervention: { type: 'block' },
      });
    // A limit only at certain times applies at all times.
    expect(limit({ type: 'time', minutes: 30, period: { kind: 'day' } })?.schedule).toEqual({
      mode: 'always',
      windows: [],
    });
    const period = (p: Record<string, unknown>) =>
      limit({ type: 'time', minutes: 30, period: p })?.budget?.period;
    expect(period({ kind: 'week' })).toEqual({ kind: 'days', n: 7 });
    expect(period({ kind: 'month' })).toEqual({ kind: 'days', n: 30 });
    expect(period({ kind: 'rolling', n: 60 })).toEqual({ kind: 'hour' });
    expect(period({ kind: 'rolling', n: 90 })).toEqual({ kind: 'minutes', n: 90 });
    expect(period({ kind: 'minutes', n: 120, offset: 30 })).toEqual({ kind: 'minutes', n: 120 });
    expect(period({ kind: 'days', n: 3, offset: 1 })).toEqual({ kind: 'days', n: 3 });
    // The longest visit is dropped.
    expect(limit({ type: 'visits', count: 3, period: { kind: 'day' }, maxVisitMinutes: 10 })?.budget).toEqual(
      {
        type: 'visits',
        count: 3,
        period: { kind: 'day' },
        perSite: false,
      },
    );
    // At most 15 minutes in a row, then a 60-minute stop: 15 minutes every 75 minutes.
    expect(limit({ type: 'session', maxMinutes: 15, cooldownMinutes: 60, perSite: true })?.budget).toEqual({
      type: 'time',
      minutes: 15,
      period: { kind: 'minutes', n: 75 },
      perSite: true,
    });
    // A stop of more than a day: whole days.
    expect(limit({ type: 'session', maxMinutes: 60, cooldownMinutes: 1500 })?.budget).toMatchObject({
      minutes: 60,
      period: { kind: 'days', n: 2 },
    });
    // "Outside these times" without the migration (a file of this version written by hand) is always.
    expect(normalizePolicy({ schedule: { mode: 'outside', windows: office } })?.schedule.mode).toBe('always');
  });

  it('breaks: a length within range, costs within range, absent limits stay absent', () => {
    const p = normalizePause({
      allowed: true,
      maxMinutes: 9999,
      limit: { count: 2.4 },
      cost: { type: 'challenge', kind: 'phrase', phrase: 'ok', length: 1 },
    });
    expect(p).toEqual({
      allowed: true,
      maxMinutes: 1440,
      limit: { count: 2, period: { kind: 'day' } },
      cost: { type: 'challenge', kind: 'phrase', length: 4, phrase: 'ok' },
    });
    expect(normalizePause({ allowed: true, maxMinutes: 0 }).maxMinutes).toBe(1);
    expect(normalizePause({}).maxMinutes).toBe(15);
    expect(normalizePause({ cost: { type: 'delay', seconds: 99999 } }).cost).toEqual({
      type: 'delay',
      seconds: 3600,
    });
    expect(normalizePause({ cost: { type: 'none' } }).cost).toEqual({ type: 'none' });
    expect(normalizePause({ cost: { type: 'password' } }).cost).toEqual({ type: 'password' });
    expect(normalizePause({ cost: 'free' }).cost).toEqual({ type: 'confirm' });
  });

  it('breaks of earlier versions last up to their longest length, cover the rule, never ask why, count the clock and leave focus sessions to decide', () => {
    const old = {
      allowed: true,
      duringSessions: true,
      scopes: ['page', 'site'],
      limit: { count: 3, period: { kind: 'day' } },
      cost: { type: 'confirm' },
      reason: 'required',
      metered: true,
    };
    const choices = normalizePause({ ...old, duration: { mode: 'choices', minutes: 10, choices: [5, 20] } });
    expect(choices).toEqual({
      allowed: true,
      maxMinutes: 20,
      limit: { count: 3, period: { kind: 'day' } },
      cost: { type: 'confirm' },
    });
    expect(
      normalizePause({ ...old, duration: { mode: 'fixed', minutes: 10, choices: [5, 20] } }).maxMinutes,
    ).toBe(10);
    expect(normalizePause({ ...old, duration: { mode: 'upTo', minutes: 30 } }).maxMinutes).toBe(30);
    // Fields of newer versions are kept.
    expect(normalizePause({ ...old, future: 1 })).toMatchObject({ future: 1 });
  });

  it('breaks lift a block only: a rule without a condition that blocks has none', () => {
    const rule = (type: string) =>
      normalizeGroup({ id: 'g', policies: [{ intervention: { type } }], pause: { allowed: true } }, []);
    expect(rule('block')?.pause.allowed).toBe(true);
    for (const type of ['ask', 'delay', 'challenge', 'filter', 'track', 'redirect', 'close'])
      expect(rule(type)?.pause.allowed, type).toBe(false);
  });

  it('rules: one condition; without one, the rule counts the time; alone, Don’t count counts', () => {
    const rule = (policies: unknown) => normalizeGroup({ id: 'g', policies }, [])?.policies;
    expect(rule([{ id: 'a', intervention: { type: 'block' } }, { id: 'b' }])).toEqual([
      { id: 'a', schedule: { mode: 'always', windows: [] }, intervention: { type: 'block' } },
    ]);
    for (const none of [undefined, [], ['junk']])
      expect(rule(none)).toEqual([
        { id: 'g-when', schedule: { mode: 'always', windows: [] }, intervention: { type: 'track' } },
      ]);
    expect(rule([{ id: 'a', intervention: { type: 'allow' } }])?.[0].intervention).toEqual({ type: 'track' });
  });

  it('rules: defaults for what is missing, valid colours only, unknown fields kept', () => {
    const errors: string[] = [];
    const g = normalizeGroup(
      {
        id: 'g',
        name: '',
        color: 'red',
        targets: [{ type: 'domain', value: 'a.test' }, { value: '' }],
        future: 1,
      },
      errors,
      5,
    );
    expect(g).toMatchObject({
      id: 'g',
      name: 'Group',
      rev: 1,
      updatedAt: 5,
      enabled: true,
      archived: false,
      future: 1,
    });
    expect(g?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(g?.targets).toHaveLength(1);
    expect(errors).toEqual(['Rule “”: an entry that could not be read was left out: {"value":""}']);
    expect(normalizeGroup([], [])).toBeNull();
  });

  it('rules: an entry repeated is kept once, without a word', () => {
    const errors: string[] = [];
    const g = normalizeGroup(
      {
        id: 'g',
        name: 'Video',
        targets: [
          { id: '1', type: 'domain', value: 'a.test' },
          { id: '2', type: 'domain', value: 'a.test' },
          { id: '3', type: 'host', value: 'a.test' },
          { id: '4', type: 'path', value: 'a.test/learn', allow: true },
          { id: '5', type: 'path', value: 'a.test/learn' },
          { id: '6', type: 'path', value: 'a.test/learn', allow: true },
        ],
      },
      errors,
    );
    expect(g?.targets.map((x) => x.id)).toEqual(['1', '3', '4', '5']);
    expect(errors).toEqual([]);
  });

  it('settings: numbers within their range', () => {
    const s = normalizeSettings({
      dayStart: 9999,
      weekStart: 8.6,
      tracking: { idleSeconds: 1, visitGapMinutes: 999, retentionDays: 1 },
      interventions: { graceSeconds: 9999 },
      protection: { emergencyHours: 1, confirmHours: 999 },
      pauseLimit: { count: 3, period: { kind: 'never' } },
    });
    expect([s.dayStart, s.weekStart]).toEqual([720, 6]);
    expect([s.tracking.idleSeconds, s.tracking.visitGapMinutes, s.tracking.retentionDays]).toEqual([
      15, 240, 7,
    ]);
    expect(s.interventions.graceSeconds).toBe(300);
    expect([s.protection.emergencyHours, s.protection.confirmHours]).toEqual([4, 168]);
    expect(s.pauseLimit).toEqual({ count: 3, period: { kind: 'day' } });
    // A value of the wrong type takes the default.
    expect(normalizeSettings({ theme: 3, timer: 'big' }).timer.enabled).toBe(true);
  });

  it('a configuration: unique rule ids', () => {
    const { config, errors } = normalizeConfig(
      { groups: [{ id: 'same' }, { id: 'same' }, 'junk'], tombstones: [{ id: 'x' }, 3] },
      7,
    );
    expect(config.schema).toBe(SCHEMA_VERSION);
    expect(new Set(config.groups.map((g) => g.id)).size).toBe(2);
    expect(config.tombstones).toEqual([{ id: 'x' }]);
    expect(errors).toEqual(['A rule that could not be read was left out.']);
    expect(normalizeConfig('nope')).toMatchObject({ errors: ['not an object'] });
  });

  it('schema 1: shared lists move into their rules, Always allowed becomes exceptions', () => {
    const { config } = normalizeConfig({
      schema: 1,
      groups: [
        { id: 'A', targets: [{ id: 'a1', type: 'domain', value: 'a.test' }], lists: ['L', 'gone'] },
        { id: 'B', targets: [{ id: 'b1', type: 'domain', value: 'news.test' }], lists: ['L'] },
        { id: 'C', targets: [{ id: 'c1', type: 'domain', value: 'c.test' }] },
      ],
      lists: [{ id: 'L', name: 'L', targets: [{ id: 'l1', type: 'domain', value: 'news.test' }] }, null],
      allowlist: [
        { id: 'w', type: 'path', value: 'news.test/weather' },
        { type: 'domain', value: 'bank.test' },
      ],
      tombstones: [
        { id: 'L0', kind: 'list' },
        { id: 'G0', kind: 'group' },
      ],
      settings: {},
    });
    const sites = (id: string) =>
      config.groups.find((g) => g.id === id)?.targets.map((t) => `${t.allow ? '+' : ''}${t.value}`);
    expect(sites('A')).toEqual(['a.test', 'news.test', '+news.test/weather']);
    // An entry the rule already has is not added twice.
    expect(sites('B')).toEqual(['news.test', '+news.test/weather']);
    // Always allowed reaches only the rules whose sites it may open.
    expect(sites('C')).toEqual(['c.test']);
    // The rule's own entries keep their ids, and every copy has one of its own.
    const ids = config.groups.flatMap((g) => g.targets.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(config.groups[0].targets[0].id).toBe('a1');
    expect(config.groups[0]).not.toHaveProperty('lists');
    expect(config).not.toHaveProperty('lists');
    expect(config).not.toHaveProperty('allowlist');
    expect(config.tombstones).toEqual([{ id: 'G0', kind: 'group' }]);
  });
});

describe('schema 2: one condition per rule', () => {
  const office = [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }];
  const migrated = (groups: unknown[], dayStart = 0) =>
    normalizeConfig({ schema: 2, groups, settings: { dayStart } }).config.groups;
  const when = (g: Group) => [g.policies[0].schedule, g.policies[0].budget, g.policies[0].intervention.type];

  it('“Outside these times” becomes the times outside them, on the days the engine applies them on', () => {
    const outside = { mode: 'outside', windows: office };
    const [g] = migrated([{ id: 'g', policies: [{ schedule: outside, intervention: { type: 'block' } }] }]);
    expect(g.policies[0].schedule).toEqual({
      mode: 'during',
      windows: [
        { days: [0, 6], start: 0, end: 1440 },
        { days: [1, 2, 3, 4, 5], start: 0, end: 540 },
        { days: [1, 2, 3, 4, 5], start: 1020, end: 1440 },
      ],
    });
    // A week without a change of the clocks, from Sunday 4 October 2026 at midnight.
    const sunday = new Date(2026, 9, 4).getTime();
    for (const dayStart of [0, 300]) {
      const cal = { dayStart, weekStart: 1 };
      const night = { mode: 'outside', windows: [{ days: [5], start: 1320, end: 120 }, ...office] };
      const [n] = migrated([{ id: 'n', policies: [{ schedule: night }] }], dayStart);
      for (let m = 0; m < 7 * 1440; m += 15) {
        const t = sunday + m * 60_000;
        expect([dayStart, m, scheduleActive(n.policies[0].schedule, t, cal)]).toEqual([
          dayStart,
          m,
          !scheduleActive({ mode: 'during', windows: night.windows }, t, cal),
        ]);
      }
    }
    // Outside no times: always.
    expect(
      migrated([{ id: 'a', policies: [{ schedule: { mode: 'outside', windows: [] } }] }])[0].policies[0]
        .schedule,
    ).toEqual({ mode: 'always', windows: [] });
  });

  it('a rule with several conditions becomes one rule for each condition that restricts', () => {
    const groups = migrated([
      {
        id: 'w',
        name: 'Work',
        targets: [{ id: 't', type: 'domain', value: 'a.test' }],
        policies: [
          { id: 'p1', schedule: { mode: 'during', windows: office }, intervention: { type: 'block' } },
          {
            id: 'p2',
            budget: { type: 'time', minutes: 30, period: { kind: 'day' } },
            intervention: { type: 'block' },
          },
          { id: 'p3', intervention: { type: 'delay', seconds: 10, grant: {} } },
        ],
        pause: { allowed: true },
        protection: { kind: 'wait', seconds: 60 },
      },
      { id: 'other', policies: [{ id: 'o', intervention: { type: 'block' } }] },
    ]);
    expect(groups.map((g) => [g.id, g.name, g.policies.map((p) => p.id)])).toEqual([
      ['w', 'Work', ['p1']],
      ['w-2', 'Work (2)', ['p2']],
      ['w-3', 'Work (3)', ['p3']],
      ['other', 'Group', ['o']],
    ]);
    // The last condition applies at the times of none before it that has no limit.
    expect(groups[2].policies[0].schedule).toEqual({
      mode: 'during',
      windows: [
        { days: [0, 6], start: 0, end: 1440 },
        { days: [1, 2, 3, 4, 5], start: 0, end: 540 },
        { days: [1, 2, 3, 4, 5], start: 1020, end: 1440 },
      ],
    });
    // Each copy has the sites, with ids of their own, the protection, and breaks only if it blocks.
    expect(groups.map((g) => g.targets.map((t) => `${t.id} ${t.value}`))).toEqual([
      ['t a.test'],
      ['t-2 a.test'],
      ['t-3 a.test'],
      [],
    ]);
    expect(groups.slice(0, 3).map((g) => [g.protection, g.pause.allowed])).toEqual([
      [{ kind: 'wait', seconds: 60 }, true],
      [{ kind: 'wait', seconds: 60 }, true],
      [{ kind: 'wait', seconds: 60 }, false],
    ]);
  });

  it('conditions that never apply, only count or do not count are left out', () => {
    const lunch = [{ days: [1, 2, 3, 4, 5], start: 720, end: 780 }];
    // Blocked except at lunch, when the sites are left alone.
    const [a, ...more] = migrated([
      {
        id: 'a',
        policies: [
          { schedule: { mode: 'during', windows: lunch }, intervention: { type: 'allow' } },
          { intervention: { type: 'block' } },
          {
            schedule: { mode: 'during', windows: office },
            intervention: { type: 'delay', seconds: 5, grant: {} },
          },
        ],
      },
    ]);
    expect(more).toEqual([]);
    expect(when(a)).toEqual([
      {
        mode: 'during',
        windows: [
          { days: [0, 6], start: 0, end: 1440 },
          { days: [1, 2, 3, 4, 5], start: 0, end: 720 },
          { days: [1, 2, 3, 4, 5], start: 780, end: 1440 },
        ],
      },
      undefined,
      'block',
    ]);
    // Counting at certain times and nothing at the others: the first condition alone.
    const [b] = migrated([
      {
        id: 'b',
        policies: [
          { schedule: { mode: 'during', windows: office }, intervention: { type: 'track' } },
          { intervention: { type: 'allow' } },
        ],
      },
    ]);
    expect(when(b)).toEqual([{ mode: 'during', windows: office }, undefined, 'track']);
    // A limit after a condition that always applies never applies.
    const [c, ...none] = migrated([
      {
        id: 'c',
        policies: [
          { intervention: { type: 'filter', filter: 'blur' } },
          { budget: { type: 'time', minutes: 5, period: { kind: 'day' } }, intervention: { type: 'block' } },
        ],
      },
    ]);
    expect([when(c), none]).toEqual([[{ mode: 'always', windows: [] }, undefined, 'filter'], []]);
  });
});

describe('integrity and versions', () => {
  it('a configuration looks like one with rules, settings and a schema', () => {
    expect(looksLikeConfig(defaultConfig())).toBe(true);
    expect(looksLikeConfig({ groups: [], settings: {} })).toBe(false);
    expect(looksLikeConfig(null)).toBe(false);
  });

  it('the checksum does not depend on the order of the keys', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"x":2,"y":1}]},"b":1}',
    );
    expect(configChecksum({ a: 1, b: 2 })).toBe(configChecksum({ b: 2, a: 1 }));
    expect(checksum('')).toBe('811c9dc5');
    expect(checksum('a')).not.toBe(checksum('b'));
  });

  it('schema 1: an Always allowed entry goes to the rules whose sites it may open', () => {
    const sites = ['news.example', 'video.example', 'bet.example', 'social.example'];
    const reached = (value: string, type = 'domain') =>
      normalizeConfig({
        schema: 1,
        groups: sites.map((site, i) => ({
          id: site,
          enabled: i < 3,
          targets: [{ id: site, type: 'domain', value: site }],
        })),
        allowlist: [{ type, value }],
      }).config.groups.flatMap((g) => (g.targets.some((x) => x.allow) ? [g.id] : []));
    expect(reached('m.video.example')).toEqual(['video.example']);
    expect(reached('example')).toEqual(sites);
    expect(reached('bank.example')).toEqual([]);
    // A rule that is off takes it too, for when it is on again.
    expect(reached('social.example')).toEqual(['social.example']);
    // Wildcards are widened to what follows them; anything else may open every rule's sites.
    expect(reached('*.bet.example')).toEqual(['bet.example']);
    expect(reached('casino.*')).toEqual(sites);
    expect(reached('news.example/today*', 'wildcard')).toEqual(['news.example']);
    expect(reached('*news*', 'wildcard')).toEqual(sites);
    expect(reached('^https://bank\\.example/', 'regex')).toEqual(sites);
  });

  it('migrations: the current schema stays, a newer one is kept as it is', () => {
    const current = { schema: SCHEMA_VERSION, groups: [] };
    expect(migrate(current)).toEqual({ data: current, from: SCHEMA_VERSION, migrated: false });
    const newer = { schema: SCHEMA_VERSION + 1, groups: [] };
    expect(migrate(newer).data).toBe(newer);
    expect(migrate({ groups: [] })).toMatchObject({
      from: 1,
      migrated: true,
      data: { schema: SCHEMA_VERSION },
    });
    expect(migrate('x')).toEqual({ data: 'x', from: 0, migrated: false });
  });
});
