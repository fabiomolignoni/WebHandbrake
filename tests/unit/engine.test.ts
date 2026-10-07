import { describe, expect, it } from 'vitest';
import { decide, SEVERITY } from '../../src/engine/decide';
import { defaultState, delayIntervention } from '../../src/engine/defaults';
import { compileDnr } from '../../src/engine/dnr';
import { nextRestriction, untilFor } from '../../src/engine/next';
import { inWindows, periodRange, scheduleActive, windowInterval } from '../../src/engine/time';
import type { Grant, TimeWindow } from '../../src/engine/types';
import { pageKey } from '../../src/engine/url';
import { Usage, usageKeys } from '../../src/engine/usage';
import { at, BLOCK, config, ctx, group } from './helpers';

const cal = { dayStart: 0, weekStart: 1 };
const weekdays = [1, 2, 3, 4, 5];

describe('windows (SCH-01, SEM-09)', () => {
  it('handles overnight windows belonging to the start day', () => {
    const w: TimeWindow = { days: [1], start: 22 * 60, end: 2 * 60 }; // Monday 22:00 → Tuesday 02:00
    expect(inWindows([w], at(0, 23), cal)).toBe(true);
    expect(inWindows([w], at(1, 1, 30), cal)).toBe(true);
    expect(inWindows([w], at(1, 2, 0), cal)).toBe(false);
    expect(inWindows([w], at(1, 23), cal)).toBe(false); // Tuesday night is not selected
  });

  it('supports all-day windows and custom day starts', () => {
    const allDay: TimeWindow = { days: [1], start: 0, end: 1440 };
    expect(inWindows([allDay], at(0, 0, 0), cal)).toBe(true);
    expect(inWindows([allDay], at(1, 0, 0), cal)).toBe(false);
    const late = { dayStart: 4 * 60, weekStart: 1 };
    // With days starting at 04:00, Monday lasts until Tuesday 04:00.
    expect(inWindows([allDay], at(1, 3, 0), late)).toBe(true);
    expect(inWindows([allDay], at(1, 4, 0), late)).toBe(false);
    // A 01:00–03:00 window on Monday happens in the night after Monday.
    const night: TimeWindow = { days: [1], start: 60, end: 180 };
    expect(windowInterval(night, { y: 2026, m: 9, d: 5 }, late)).toEqual([at(1, 1), at(1, 3)]);
  });

  it('computes period ranges', () => {
    const week = periodRange({ kind: 'week' }, at(2, 10), cal);
    expect(week.kind === 'days' && week.days).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    const two = periodRange({ kind: 'minutes', n: 120 }, at(0, 13, 30), cal);
    expect([two.start, two.end]).toEqual([at(0, 12), at(0, 14)]);
    const month = periodRange({ kind: 'month' }, at(0, 9), cal);
    expect(month.kind === 'days' && month.days.length).toBe(5);
  });

  it('modes during/outside/always (SCH-03)', () => {
    const windows = [{ days: weekdays, start: 9 * 60, end: 17 * 60 }];
    expect(scheduleActive({ mode: 'outside', windows }, at(0, 18), cal)).toBe(true);
    expect(scheduleActive({ mode: 'outside', windows }, at(0, 10), cal)).toBe(false);
    expect(scheduleActive({ mode: 'always', windows: [] }, at(0, 10), cal)).toBe(true);
  });
});

describe('decisions', () => {
  const office = { mode: 'during' as const, windows: [{ days: weekdays, start: 9 * 60, end: 17 * 60 }] };

  it('SEM-03: the most severe intervention wins whatever the group order', () => {
    const a = group('A', ['example.com'], [{ intervention: delayIntervention(30) }]);
    const b = group('B', ['example.com'], [{ schedule: office, intervention: BLOCK }]);
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const c = ctx(config(order), at(0, 15));
      const d = decide(c, 'https://example.com/x');
      expect(d.intervention.type).toBe('block');
      expect(d.primary?.group.id).toBe('B');
      expect(untilFor(c, 'https://example.com/x', { incognito: false }).until).toBe(at(0, 17));
    }
  });

  it('SEM-04: exceptions only work in their own group', () => {
    const a = group('A', ['reddit.com', '+reddit.com/r/rust'], [{ intervention: BLOCK }]);
    const b = group('B', ['reddit.com'], [{ intervention: delayIntervention(10) }]);
    const d = decide(ctx(config([a, b]), at(0, 10)), 'https://reddit.com/r/rust');
    expect(d.intervention.type).toBe('delay');
    expect(d.excepted.map((e) => e.group.id)).toEqual(['A']);
  });

  it('SEM-05: the global allowlist prevails', () => {
    const a = group('A', ['example.com'], [{ intervention: BLOCK }]);
    const c = config([a], (cfg) => {
      cfg.allowlist = [{ id: 'x', type: 'path', value: 'example.com/docs' }];
    });
    expect(decide(ctx(c, at(0, 10)), 'https://example.com/docs/a').intervention.type).toBe('allow');
    expect(decide(ctx(c, at(0, 10)), 'https://example.com/').intervention.type).toBe('block');
  });

  it('SEM-02: first matching policy wins; budget escalation (LIM-09)', () => {
    const g = group(
      'V',
      ['youtube.com'],
      [
        { schedule: office, intervention: BLOCK },
        {
          schedule: { mode: 'always', windows: [] },
          budget: { type: 'time', minutes: 45, period: { kind: 'day' } },
          intervention: delayIntervention(30),
        },
      ],
    );
    const usage = new Usage();
    usage.add(usageKeys.group('V'), at(0, 18), 44 * 60, 1, cal);
    const c = ctx(config([g]), at(0, 19), defaultState(), usage);
    expect(decide(c, 'https://youtube.com/').intervention.type).toBe('track');
    const r = nextRestriction(c, 'https://youtube.com/', { incognito: false });
    expect(r?.kind).toBe('budget');
    expect(r?.at).toBe(at(0, 19) + 60_000);
    usage.add(usageKeys.group('V'), at(0, 18, 30), 60, 0, cal);
    expect(decide(c, 'https://youtube.com/').intervention.type).toBe('delay');
    expect(decide({ ...c, now: at(0, 10) }, 'https://youtube.com/').intervention.type).toBe('block');
    // The budget refills the next day.
    expect(untilFor(c, 'https://youtube.com/', { incognito: false }).until).toBe(at(1, 0));
  });

  it('LIM-03: per-site budgets', () => {
    const g = group(
      'S',
      ['a.com', 'b.com'],
      [
        {
          budget: { type: 'time', minutes: 10, period: { kind: 'day' }, perSite: true },
          intervention: BLOCK,
        },
      ],
    );
    const usage = new Usage();
    usage.add(usageKeys.site('S', 'a.com'), at(0, 9), 600, 1, cal);
    const c = ctx(config([g]), at(0, 10), defaultState(), usage);
    expect(decide(c, 'https://www.a.com/').intervention.type).toBe('block');
    expect(decide(c, 'https://b.com/').intervention.type).toBe('track');
  });

  it('LIM-11: giving up a per-site budget covers every site, visited or not (regression)', () => {
    const g = group(
      'S',
      ['a.com', 'b.com'],
      [
        {
          budget: { type: 'time', minutes: 10, period: { kind: 'rolling', n: 60 }, perSite: true },
          intervention: BLOCK,
        },
      ],
    );
    const state = defaultState();
    state.forfeits['S-p0'] = at(0, 11);
    const c = ctx(config([g]), at(0, 10), state);
    expect(decide(c, 'https://a.com/').intervention.type).toBe('block');
    expect(decide(c, 'https://b.com/').intervention.type).toBe('block');
    expect(decide({ ...c, now: at(0, 11) }, 'https://b.com/').intervention.type).toBe('track');
  });

  it('LIM-04: visit budgets allow the current visit', () => {
    const g = group(
      'M',
      ['mail.example'],
      [{ budget: { type: 'visits', count: 3, period: { kind: 'day' } }, intervention: BLOCK }],
    );
    const usage = new Usage();
    usage.add(usageKeys.group('M'), at(0, 9), 60, 3, cal);
    const state = defaultState();
    state.activity[usageKeys.group('M')] = {
      last: at(0, 9, 58),
      visitStart: at(0, 9, 50),
      visitSeconds: 60,
      run: 60,
    };
    const c = ctx(config([g]), at(0, 10), state, usage);
    expect(decide(c, 'https://mail.example/').intervention.type).toBe('track');
    expect(decide({ ...c, now: at(0, 10, 10) }, 'https://mail.example/').intervention.type).toBe('block');
  });

  it('pauses and passes (BRK, INT-02)', () => {
    const g = group('P', ['site.example'], [{ intervention: delayIntervention(30) }]);
    const state = defaultState();
    const pass: Grant = {
      id: 'g',
      kind: 'pass',
      groups: ['P'],
      scope: 'site',
      site: 'site.example',
      createdAt: at(0, 9),
      until: at(0, 9, 10),
      severity: SEVERITY.delay,
    };
    state.grants.push(pass);
    const c = ctx(config([g]), at(0, 9, 5), state);
    expect(decide(c, 'https://site.example/a').intervention.type).toBe('track');
    expect(decide({ ...c, now: at(0, 9, 11) }, 'https://site.example/a').intervention.type).toBe('delay');
    // A pass for a delay does not open a block.
    const g2 = group('P', ['site.example'], [{ intervention: BLOCK }]);
    expect(decide(ctx(config([g2]), at(0, 9, 5), state), 'https://site.example/').intervention.type).toBe(
      'block',
    );
    // A pause does.
    state.grants = [{ ...pass, kind: 'pause', scope: 'group', severity: 99 }];
    expect(decide(ctx(config([g2]), at(0, 9, 5), state), 'https://site.example/').intervention.type).toBe(
      'track',
    );
  });

  it('focus sessions block groups and allowlist sessions block the rest (FOC-01, FOC-02)', () => {
    const g = group('F', ['news.example'], [{ intervention: { type: 'track' } }]);
    const state = defaultState();
    state.sessions.push({
      id: 's',
      kind: 'groups',
      groups: ['F'],
      allow: [],
      startAt: at(0, 9),
      endAt: at(0, 10),
      createdAt: at(0, 9),
      locked: false,
      noPauses: true,
    });
    const c = ctx(config([g]), at(0, 9, 30), state);
    expect(decide(c, 'https://news.example/').source).toBe('session');
    state.sessions = [
      {
        id: 's2',
        kind: 'allowlist',
        groups: [],
        allow: [{ id: 'a', type: 'domain', value: 'docs.example' }],
        startAt: at(0, 9),
        endAt: at(0, 10),
        createdAt: at(0, 9),
        locked: true,
        noPauses: true,
      },
    ];
    const c2 = ctx(config([g]), at(0, 9, 30), state);
    expect(decide(c2, 'https://other.example/').intervention.type).toBe('block');
    expect(decide(c2, 'https://docs.example/a').intervention.type).toBe('allow');
  });

  it('MAT-19: private-only groups', () => {
    const g = group('Pr', ['a.com'], [{ intervention: BLOCK }], {
      options: { privacy: 'private', embeds: false, tabs: 'all', timer: true, quickSession: true },
    });
    const c = ctx(config([g]), at(0, 9));
    expect(decide(c, 'https://a.com/', { incognito: true }).intervention.type).toBe('block');
    expect(decide(c, 'https://a.com/', { incognito: false }).intervention.type).toBe('allow');
    expect(decide(c, 'https://a.com/', { incognito: null }).intervention.type).toBe('allow');
  });
});

describe('DNR compilation', () => {
  const opts = {
    interventionUrl: 'chrome-extension://id/intervention.html',
    hostAccess: true,
    limits: { regex: 1000, unsafe: 5000, total: 30000 },
  };

  it('emits redirect and exception rules by specificity', () => {
    const a = group(
      'A',
      ['reddit.com', 'youtube.com', '+reddit.com/r/rust', 'twitch.tv'],
      [{ intervention: BLOCK }],
    );
    const { rules } = compileDnr(ctx(config([a]), at(0, 9)), opts);
    const redirect = rules.find((r) => r.condition.requestDomains);
    expect(redirect?.condition.requestDomains).toEqual(['reddit.com', 'twitch.tv', 'youtube.com']);
    expect(redirect?.condition.regexFilter).toBe('^(.*)$');
    const allow = rules.find((r) => r.action.type === 'allow');
    expect(allow?.priority).toBeGreaterThan(redirect!.priority);
    expect(new RegExp(allow!.condition.regexFilter!, 'i').test('https://reddit.com/r/rust/x')).toBe(true);
  });

  it('emits nothing when nothing intervenes, and blocks without host access (ENF-12)', () => {
    const a = group('A', ['reddit.com'], [{ intervention: { type: 'track' } }]);
    expect(compileDnr(ctx(config([a]), at(0, 9)), opts).rules).toEqual([]);
    const b = group('B', ['reddit.com'], [{ intervention: BLOCK }]);
    const { rules } = compileDnr(ctx(config([b]), at(0, 9)), { ...opts, hostAccess: false });
    expect(rules[0].action.type).toBe('block');
    expect(rules[0].condition.regexFilter).toBeUndefined();
  });

  it('a pass for one http:// page opens that page in the browser filters too (regression)', () => {
    const a = group('A', ['wait.example'], [{ intervention: delayIntervention(5) }]);
    const state = defaultState();
    const pass: Grant = {
      id: 'g1',
      kind: 'pass',
      groups: ['A'],
      scope: 'page',
      url: pageKey('http://wait.example/thread/1'),
      createdAt: at(0, 9),
      visit: true,
      severity: SEVERITY.delay,
    };
    state.grants.push(pass);
    const c = ctx(config([a]), at(0, 9), state);
    expect(decide(c, 'http://wait.example/thread/1').intervention.type).toBe('track');
    expect(decide(c, 'https://wait.example/thread/1').intervention.type).toBe('track');
    expect(decide(c, 'http://wait.example/thread/2').intervention.type).toBe('delay');
    // The page gets an allow rule above the redirect of the site, for http and https alike.
    const { rules } = compileDnr(c, opts);
    const allow = rules.find((r) => r.action.type === 'allow');
    expect(allow?.priority).toBeGreaterThan(rules.find((r) => r.action.type === 'redirect')!.priority);
    const re = new RegExp(allow!.condition.regexFilter!, 'i');
    expect(re.test('http://wait.example/thread/1')).toBe(true);
    expect(re.test('https://www.wait.example/thread/1')).toBe(true);
    expect(re.test('http://wait.example/thread/2')).toBe(false);
  });

  it('follows the engine for cross-group regions', () => {
    const a = group('A', ['reddit.com', '+reddit.com/r/rust'], [{ intervention: BLOCK }]);
    const b = group('B', ['reddit.com'], [{ intervention: delayIntervention(10) }]);
    const { rules } = compileDnr(ctx(config([a, b]), at(0, 9)), opts);
    // reddit.com/r/rust is still intervened (group B), so no allow rule is emitted for it.
    expect(rules.every((r) => r.action.type === 'redirect')).toBe(true);
  });
});

describe('redirect destinations (ENF-09)', () => {
  it('exempts only the destination page, not its whole site', () => {
    const a = group(
      'A',
      ['social.example'],
      [{ intervention: { type: 'redirect', url: 'https://news.example/?from={url}' } }],
    );
    const b = group('B', ['news.example'], [{ intervention: BLOCK }]);
    const c = ctx(config([a, b]), at(0, 10));
    expect(decide(c, 'https://news.example/?from=x').exempt).toBe(true);
    expect(decide(c, 'https://www.news.example/').exempt).toBe(true);
    expect(decide(c, 'https://news.example/politics').intervention.type).toBe('block');
    const { rules } = compileDnr(c, {
      interventionUrl: 'chrome-extension://id/i.html',
      hostAccess: true,
      limits: { regex: 1000, unsafe: 5000, total: 30000 },
    });
    const allow = rules.find((r) => r.condition.urlFilter);
    expect(allow?.condition.urlFilter).toBe('||news.example/^');
  });
});
