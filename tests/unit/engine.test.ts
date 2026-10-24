import { describe, expect, it } from 'vitest';
import { decide, pageFilters } from '../../src/engine/decide';
import { defaultState, delayIntervention } from '../../src/engine/defaults';
import { compileDnr } from '../../src/engine/dnr';
import { nextRestriction, untilFor } from '../../src/engine/next';
import { SEVERITY } from '../../src/engine/severity';
import { inWindows, periodRange, scheduleActive, windowInterval } from '../../src/engine/time';
import type { Grant, TimeWindow } from '../../src/engine/types';
import { pageKey } from '../../src/engine/url';
import { Usage, usageKeys } from '../../src/engine/usage';
import { at, BLOCK, config, ctx, group, PERMANENT, t } from './helpers';

const cal = { dayStart: 0, weekStart: 1 };
const weekdays = [1, 2, 3, 4, 5];

describe('windows', () => {
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

  it('modes during/always', () => {
    const windows = [{ days: weekdays, start: 9 * 60, end: 17 * 60 }];
    expect(scheduleActive({ mode: 'during', windows }, at(0, 18), cal)).toBe(false);
    expect(scheduleActive({ mode: 'during', windows }, at(0, 10), cal)).toBe(true);
    expect(scheduleActive({ mode: 'always', windows: [] }, at(0, 10), cal)).toBe(true);
  });
});

describe('decisions', () => {
  const office = { mode: 'during' as const, windows: [{ days: weekdays, start: 9 * 60, end: 17 * 60 }] };

  it('the most severe intervention wins whatever the group order', () => {
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

  it('exceptions only work in their own group', () => {
    const a = group('A', ['reddit.com', '+reddit.com/r/rust'], [{ intervention: BLOCK }]);
    const b = group('B', ['reddit.com'], [{ intervention: delayIntervention(10) }]);
    const d = decide(ctx(config([a, b]), at(0, 10)), 'https://reddit.com/r/rust');
    expect(d.intervention.type).toBe('delay');
    expect(d.excepted.map((e) => e.group.id)).toEqual(['A']);
  });

  it('a limit steps in once used up; the strictest rule wins', () => {
    const v = group('V', ['youtube.com'], [{ schedule: office, intervention: BLOCK }]);
    const w = group(
      'W',
      ['youtube.com'],
      [
        {
          budget: { type: 'time', minutes: 45, period: { kind: 'day' } },
          intervention: delayIntervention(30),
        },
      ],
    );
    const usage = new Usage();
    usage.add(usageKeys.group('W'), at(0, 18), 44 * 60, 1, cal);
    const c = ctx(config([v, w]), at(0, 19), defaultState(), usage);
    expect(decide(c, 'https://youtube.com/').intervention.type).toBe('track');
    const r = nextRestriction(c, 'https://youtube.com/', { incognito: false });
    expect(r?.kind).toBe('budget');
    expect(r?.at).toBe(at(0, 19) + 60_000);
    usage.add(usageKeys.group('W'), at(0, 18, 30), 60, 0, cal);
    expect(decide(c, 'https://youtube.com/').intervention.type).toBe('delay');
    expect(decide({ ...c, now: at(0, 10) }, 'https://youtube.com/').intervention.type).toBe('block');
    // The budget refills the next day.
    expect(untilFor(c, 'https://youtube.com/', { incognito: false }).until).toBe(at(1, 0));
  });

  it('per-site budgets', () => {
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

  it('giving up a per-site budget covers every site, visited or not (regression)', () => {
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

  it('visit budgets allow the current visit', () => {
    const g = group(
      'M',
      ['mail.example'],
      [{ budget: { type: 'visits', count: 3, period: { kind: 'day' } }, intervention: BLOCK }],
    );
    const usage = new Usage();
    usage.add(usageKeys.group('M'), at(0, 9), 60, 3, cal);
    const state = defaultState();
    state.activity[usageKeys.group('M')] = { last: at(0, 9, 58) };
    const c = ctx(config([g]), at(0, 10), state, usage);
    expect(decide(c, 'https://mail.example/').intervention.type).toBe('track');
    expect(decide({ ...c, now: at(0, 10, 10) }, 'https://mail.example/').intervention.type).toBe('block');
  });

  it('pauses and passes', () => {
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
    g2.pause.allowed = true;
    expect(decide(ctx(config([g2]), at(0, 9, 5), state), 'https://site.example/').intervention.type).toBe(
      'block',
    );
    // A pause does.
    state.grants = [{ ...pass, kind: 'pause', scope: 'group', severity: 99 }];
    expect(decide(ctx(config([g2]), at(0, 9, 5), state), 'https://site.example/').intervention.type).toBe(
      'track',
    );
  });

  it('a break lifts a block, and only a block', () => {
    const evening = { mode: 'during' as const, windows: [{ days: [1], start: 18 * 60, end: 24 * 60 }] };
    // A wait during the day, a block in the evening, and a break for the site until 23:00.
    const g = group(
      'B',
      ['site.example'],
      [{ schedule: evening, intervention: BLOCK }, { intervention: delayIntervention(30) }],
    );
    g.pause.allowed = true;
    const state = defaultState();
    state.grants.push({
      id: 'b',
      kind: 'pause',
      groups: ['B'],
      scope: 'site',
      site: 'site.example',
      createdAt: at(0, 17),
      until: at(0, 23),
      severity: 99,
    });
    const blocked = decide(ctx(config([g]), at(0, 19), state), 'https://site.example/');
    expect(blocked.intervention.type).toBe('track');
    expect(blocked.groups[0].pausable).toBe(true);
    // The wait has its own way in: the break neither opens the page nor is offered there.
    const waiting = decide(ctx(config([g]), at(0, 17, 30), state), 'https://site.example/');
    expect(waiting.intervention.type).toBe('delay');
    expect(waiting.groups[0].pause).toBeUndefined();
    expect(waiting.groups[0].pausable).toBe(false);
    // Nor does a filter take breaks.
    const f = group('B', ['site.example'], [{ intervention: { type: 'filter', filter: 'grayscale' } }]);
    const filtered = decide(ctx(config([f]), at(0, 19), state), 'https://site.example/');
    expect(filtered.intervention.type).toBe('filter');
    expect(filtered.groups[0].pausable).toBe(false);
  });

  it('focus sessions block groups and allowlist sessions block the rest', () => {
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
    // The session decides whether the rule's breaks are allowed during it.
    g.pause = { ...g.pause, allowed: true };
    expect(decide(c, 'https://news.example/').groups[0].pausable).toBe(false);
    state.sessions[0].noPauses = false;
    expect(decide(c, 'https://news.example/').groups[0].pausable).toBe(true);
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

  it('blocklist sessions block their own sites, except their exceptions, and nothing else', () => {
    const g = group('F', ['news.example'], [{ intervention: delayIntervention(30) }]);
    const state = defaultState();
    state.sessions.push({
      id: 's',
      kind: 'blocklist',
      groups: [],
      allow: [],
      block: [t('video.example'), t('+video.example/lectures'), t('news.example')],
      startAt: at(0, 9),
      endAt: at(0, 10),
      createdAt: at(0, 9),
      locked: false,
      noPauses: false,
    });
    const c = ctx(config([g]), at(0, 9, 30), state);
    const video = decide(c, 'https://m.video.example/watch');
    expect(video).toMatchObject({ source: 'session', primary: null, session: { id: 's' } });
    expect(video.intervention.type).toBe('block');
    expect(decide(c, 'https://video.example/lectures/1').intervention.type).toBe('allow');
    expect(decide(c, 'https://other.example/').intervention.type).toBe('allow');
    // A rule's gentler intervention gives way to the session, which offers no break.
    const news = decide(c, 'https://news.example/');
    expect(news.intervention.type).toBe('block');
    expect(news.session?.id).toBe('s');
    // Before it starts and once it is over, the session blocks nothing; nor does one of an
    // earlier version without a list.
    expect(decide(ctx(config([g]), at(0, 8), state), 'https://video.example/').intervention.type).toBe(
      'allow',
    );
    expect(decide(ctx(config([g]), at(0, 10), state), 'https://video.example/').intervention.type).toBe(
      'allow',
    );
    const { block: _, ...earlier } = state.sessions[0];
    state.sessions = [earlier];
    expect(decide(ctx(config([g]), at(0, 9, 30), state), 'https://video.example/').intervention.type).toBe(
      'allow',
    );
  });

  it('private-only groups', () => {
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

  it('emits nothing when nothing intervenes, and blocks without host access', () => {
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

describe('redirect destinations', () => {
  const dnrOpts = {
    interventionUrl: 'chrome-extension://id/i.html',
    hostAccess: true,
    limits: { regex: 1000, unsafe: 5000, total: 30000 },
  };
  const redirect = (url: string) => ({ intervention: { type: 'redirect' as const, url } });
  /** The action of the browser filter that decides a main-frame URL (highest priority). */
  const filterAction = (rules: ReturnType<typeof compileDnr>['rules'], url: string) =>
    rules
      .filter((r) => r.condition.resourceTypes.includes('main_frame'))
      .filter((r) =>
        r.condition.regexFilter
          ? new RegExp(r.condition.regexFilter, 'i').test(url)
          : (r.condition.requestDomains ?? []).some((d) => new URL(url).hostname.endsWith(d)),
      )
      .sort((a, b) => b.priority - a.priority)[0]?.action.type;

  it('the redirecting rule never restricts its destination, even inside its own sites', () => {
    const a = group('A', ['fun.example'], [redirect('https://fun.example/allowed?from={url}')]);
    const c = ctx(config([a]), at(0, 10));
    expect(decide(c, 'https://fun.example/game').intervention.type).toBe('redirect');
    expect(decide(c, 'https://fun.example/allowed?from=x').intervention.type).toBe('allow');
    expect(decide(c, 'https://fun.example/allowed/deeper').intervention.type).toBe('redirect');
    const { rules } = compileDnr(c, dnrOpts);
    expect(filterAction(rules, 'https://fun.example/allowed?from=x')).toBe('allow');
    expect(filterAction(rules, 'https://fun.example/game')).toBe('redirect');
  });

  it('other rules still restrict the destination, and a redirect to a restricted page blocks instead', () => {
    const a = group('A', ['social.example'], [redirect('https://news.example/?from={url}')]);
    const b = group('B', ['news.example'], [{ intervention: BLOCK }]);
    const c = ctx(config([a, b]), at(0, 10));
    expect(decide(c, 'https://news.example/?from=x').intervention.type).toBe('block');
    expect(decide(c, 'https://social.example/').intervention.type).toBe('block');
    expect(filterAction(compileDnr(c, dnrOpts).rules, 'https://news.example/?from=x')).toBe('redirect');
    // Without the other rule, the redirect goes ahead.
    expect(decide(ctx(config([a]), at(0, 10)), 'https://social.example/').intervention.type).toBe('redirect');
  });

  it('a rule that is off, archived or not redirecting now exempts nothing (regression)', () => {
    const video = group('Video', ['youtube.com'], [{ intervention: BLOCK }], { protection: PERMANENT });
    const off = group('Off', ['example.org'], [redirect('https://www.youtube.com/watch')], {
      enabled: false,
    });
    const archived = group('Archived', ['example.net'], [redirect('https://www.youtube.com/watch')], {
      archived: true,
    });
    const active = group('Active', ['example.com'], [redirect('https://www.youtube.com/watch')]);
    const c = ctx(config([video, off, archived, active]), at(0, 10));
    expect(decide(c, 'https://www.youtube.com/watch?v=abc').intervention.type).toBe('block');
    expect(decide(c, 'https://example.com/').intervention.type).toBe('block');
    expect(filterAction(compileDnr(c, dnrOpts).rules, 'https://www.youtube.com/watch?v=abc')).toBe(
      'redirect',
    );
  });

  it('two rules that redirect to each other block instead of looping', () => {
    const a = group('A', ['a.example'], [redirect('https://b.example/')]);
    const b = group('B', ['b.example'], [redirect('https://a.example/')]);
    const c = ctx(config([a, b]), at(0, 10));
    expect(decide(c, 'https://a.example/x').intervention.type).toBe('block');
    expect(decide(c, 'https://b.example/y').intervention.type).toBe('block');
  });
});

describe('rules over every website and address wildcards', () => {
  const opts = {
    interventionUrl: 'chrome-extension://id/intervention.html',
    hostAccess: true,
    limits: { regex: 1000, unsafe: 5000, total: 30000 },
  };
  const FILTER = { type: 'filter', filter: 'grayscale', intensity: 100 } as const;

  it('a rule over every website applies everywhere but its exceptions', () => {
    const all = group('All', ['*', '+*work*', '+bank.test'], [{ intervention: BLOCK }]);
    const c = ctx(config([all]), at(0, 9));
    expect(decide(c, 'https://video.test/').intervention.type).toBe('block');
    expect(decide(c, 'https://intranet.test/my-work/today').intervention.type).toBe('allow');
    expect(decide(c, 'https://www.bank.test/login').intervention.type).toBe('allow');
    // The extension's own pages are never restricted.
    expect(decide(c, 'chrome-extension://id/dashboard.html').intervention.type).toBe('allow');
  });

  it('with another rule on the same site, the most severe result wins', () => {
    const all = group('Gray', ['*'], [{ intervention: FILTER }]);
    const video = group('Video', ['video.test'], [{ intervention: delayIntervention(10) }]);
    const c = ctx(config([all, video]), at(0, 9));
    expect(decide(c, 'https://video.test/').intervention.type).toBe('delay');
    expect(decide(c, 'https://news.test/').intervention.type).toBe('filter');
  });

  it('the filters of every rule on the page add up, the stronger of each kind', () => {
    const all = group('Gray', ['*'], [{ intervention: { ...FILTER, intensity: 60 } }]);
    const video = group('Video', ['video.test'], [{ intervention: delayIntervention(10) }]);
    const darker = group('Darker', ['video.test'], [{ intervention: { ...FILTER, intensity: 90 } }]);
    const blur = group('Blur', ['video.test'], [{ intervention: { type: 'filter', filter: 'blur' } }]);
    const state = defaultState();
    const c = ctx(config([all, video, darker, blur]), at(0, 9), state);
    // A page that is replaced shows no filter.
    expect(pageFilters(decide(c, 'https://video.test/'))).toEqual([]);
    // Once the wait is passed, every filter applies.
    state.grants.push({
      id: 'p',
      kind: 'pass',
      groups: ['Video'],
      scope: 'site',
      site: 'video.test',
      createdAt: at(0, 9),
      visit: true,
      severity: SEVERITY.delay,
    });
    expect(pageFilters(decide(c, 'https://video.test/'))).toEqual([
      { ...FILTER, intensity: 90 },
      { type: 'filter', filter: 'blur' },
    ]);
    expect(pageFilters(decide(c, 'https://news.test/'))).toEqual([{ ...FILTER, intensity: 60 }]);
  });

  it('a wildcard decides inside its rule like any entry', () => {
    const g = group('Shorts', ['*shorts*', '+*shorts*/help'], [{ intervention: BLOCK }]);
    const c = ctx(config([g]), at(0, 9));
    expect(decide(c, 'https://video.test/shorts/1').intervention.type).toBe('block');
    expect(decide(c, 'https://shorts.test/').intervention.type).toBe('block');
    expect(decide(c, 'https://video.test/shorts/help').intervention.type).toBe('allow');
    expect(decide(c, 'https://video.test/watch').groups).toEqual([]);
  });

  it('the browser filters redirect every website, below the exceptions', () => {
    const all = group('All', ['*', '+bank.test'], [{ intervention: BLOCK }]);
    const { rules } = compileDnr(ctx(config([all]), at(0, 9)), opts);
    const redirect = rules.find((r) => r.action.type === 'redirect')!;
    const allow = rules.find((r) => r.action.type === 'allow')!;
    expect(new RegExp(redirect.condition.regexFilter!, 'i').test('https://video.test/a?b=1')).toBe(true);
    expect(allow.priority).toBeGreaterThan(redirect.priority);
    expect(allow.condition.requestDomains).toEqual(['bank.test']);
  });
});

describe('validation of rules with wildcards', () => {
  it('warns about a rule over every website, and never calls a wildcard exception unused', async () => {
    const { validateGroup } = await import('../../src/engine/validate');
    const keys = (g: ReturnType<typeof group>) => validateGroup(g).map((i) => i.key);
    expect(keys(group('All', ['*'], [{ intervention: BLOCK }]))).toContain('validate.allSites');
    expect(keys(group('Some', ['*news*'], [{ intervention: BLOCK }]))).not.toContain('validate.allSites');
    expect(keys(group('Video', ['video.test', '+*help*'], [{ intervention: BLOCK }]))).not.toContain(
      'validate.unusedException',
    );
  });
});
