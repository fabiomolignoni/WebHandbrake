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
import { SCHEMA_VERSION } from '../../src/engine/types';

describe('normalising what is read from storage or a file', () => {
  it('entries: a known type and a value; unsafe expressions and junk are dropped', () => {
    expect(normalizeTarget({ id: 'x', type: 'domain', value: ' a.test ', allow: false, note: '' })).toEqual({
      id: 'x',
      type: 'domain',
      value: 'a.test',
    });
    expect(normalizeTarget({ type: 'nonsense', value: 'b.test', allow: 1, note: 'n' })).toMatchObject({
      type: 'domain',
      allow: true,
      note: 'n',
    });
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
    expect(
      normalizeIntervention({ type: 'filter', filter: 'neon', intensity: 300, css: 'x'.repeat(300) }),
    ).toEqual({
      type: 'filter',
      filter: 'grayscale',
      intensity: 100,
      css: 'x'.repeat(200),
      mute: false,
    });
    expect(
      normalizeIntervention({ type: 'ask', choices: [5, 30, -1, 'x'], maxMinutes: 20, cooldownMinutes: 5 }),
    ).toEqual({
      type: 'ask',
      seconds: 0,
      choices: [5],
      maxMinutes: 20,
      cooldownMinutes: 5,
    });
    // No choice under the maximum: the maximum is the choice.
    expect(normalizeIntervention({ type: 'ask', choices: [30], maxMinutes: 10 })).toMatchObject({
      choices: [10],
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
      charset: 'alnum',
      phrase: 'I choose',
      grant: { scope: 'site', mode: 'minutes', minutes: 1440 },
    });
    expect(normalizeIntervention({ type: 'redirect' })).toEqual({ type: 'redirect', url: 'about:blank' });
    expect(normalizeIntervention({ type: 'close', extra: 1 })).toEqual({ type: 'close' });
    expect(normalizeIntervention({ type: 'explode' })).toEqual({ type: 'block' });
    expect(normalizeIntervention(null)).toEqual({ type: 'block' });
  });

  it('conditions: a schedule, a known limit, what happens', () => {
    const p = normalizePolicy({
      id: 'p',
      schedule: { mode: 'sometimes' },
      budget: { type: 'visits', count: 2.6, period: { kind: 'day' }, maxVisitMinutes: 0.1 },
      intervention: { type: 'block' },
    });
    expect(p).toEqual({
      id: 'p',
      schedule: { mode: 'always', windows: [] },
      budget: { type: 'visits', count: 3, period: { kind: 'day' }, perSite: false, maxVisitMinutes: 0.5 },
      intervention: { type: 'block' },
    });
    expect(
      normalizePolicy({ budget: { type: 'session', maxMinutes: 0, cooldownMinutes: 0 } })?.budget,
    ).toEqual({
      type: 'session',
      maxMinutes: 0.5,
      cooldownMinutes: 1,
      perSite: false,
    });
    expect(normalizePolicy({ budget: { type: 'time', minutes: 0 } })?.budget).toMatchObject({ minutes: 0.1 });
    expect(normalizePolicy({ budget: { type: 'mystery' } })?.budget).toBeUndefined();
    expect(normalizePolicy(null)).toBeNull();
    expect(normalizePolicy({})?.id).toEqual(expect.any(String));
  });

  it('breaks: known scopes once, costs within range, absent limits stay absent', () => {
    const p = normalizePause({
      allowed: true,
      scopes: ['page', 'page', 'galaxy'],
      duration: { mode: 'choices', minutes: 0, choices: [5, 9999] },
      limit: { count: 2.4 },
      cost: { type: 'challenge', kind: 'phrase', phrase: 'ok', length: 1 },
      reason: 'maybe',
    });
    expect(p).toMatchObject({
      allowed: true,
      scopes: ['page'],
      duration: { mode: 'choices', minutes: 1, choices: [5] },
      limit: { count: 2, period: { kind: 'day' } },
      cost: { type: 'challenge', kind: 'phrase', length: 4, phrase: 'ok' },
    });
    expect(p.limit.minutes).toBeUndefined();
    expect(normalizePause({ cost: { type: 'delay', seconds: 99999 } }).cost).toEqual({
      type: 'delay',
      seconds: 3600,
    });
    expect(normalizePause({ cost: { type: 'none' } }).cost).toEqual({ type: 'none' });
    expect(normalizePause({ cost: { type: 'password' } }).cost).toEqual({ type: 'password' });
    expect(normalizePause({ cost: 'free' }).cost).toEqual({ type: 'confirm' });
  });

  it('breaks lift a block only: a rule without a condition that blocks has none', () => {
    const rule = (type: string) =>
      normalizeGroup({ id: 'g', policies: [{ intervention: { type } }], pause: { allowed: true } }, []);
    expect(rule('block')?.pause.allowed).toBe(true);
    for (const type of ['ask', 'delay', 'challenge', 'filter', 'track', 'redirect', 'close'])
      expect(rule(type)?.pause.allowed, type).toBe(false);
    // One condition that blocks is enough, whatever the others do.
    const mixed = normalizeGroup(
      {
        policies: [{ intervention: { type: 'delay', seconds: 30 } }, { intervention: { type: 'block' } }],
        pause: { allowed: true },
      },
      [],
    );
    expect(mixed?.pause.allowed).toBe(true);
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
    expect(errors).toEqual(['group "": invalid entry {"value":""}']);
    expect(normalizeGroup([], [])).toBeNull();
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
    expect(errors).toEqual(['invalid group']);
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
