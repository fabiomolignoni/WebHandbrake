import { describe, expect, it } from 'vitest';
import { defaultState, delayIntervention } from '../../src/engine/defaults';
import { collectRegions, compileDnr, type DnrResource, type DnrRuleData } from '../../src/engine/dnr';
import type { FocusSession, Group, RuntimeState } from '../../src/engine/types';
import { at, BLOCK, config, ctx, group, t } from './helpers';

const OPTS = {
  interventionUrl: 'chrome-extension://id/intervention.html',
  hostAccess: true,
  limits: { regex: 1000, unsafe: 5000, total: 30000 },
};

/** What the browser does with a request: the action of the matching rule of highest priority. */
function browser(rules: DnrRuleData[], url: string, type: DnrResource = 'main_frame'): string {
  const host = new URL(url).hostname;
  const matching = rules.filter((r) => {
    const c = r.condition;
    if (!c.resourceTypes.includes(type)) return false;
    if (c.requestDomains && !c.requestDomains.some((d) => host === d || host.endsWith(`.${d}`))) return false;
    return !c.regexFilter || new RegExp(c.regexFilter, 'i').test(url);
  });
  if (!matching.length) return 'none';
  const top = matching.reduce((a, b) => (b.priority > a.priority ? b : a));
  return top.action.type;
}

function compile(groups: Group[], state: RuntimeState = defaultState(), opts = OPTS) {
  return compileDnr(ctx(config(groups), at(0, 10), state), opts);
}

describe('browser filters', () => {
  it('redirect the restricted pages and let the rest through', () => {
    const { rules, overflow } = compile([
      group(
        'A',
        ['news.test', '=m.video.test', 'shop.test/cart$', 'blog.test/$', 'q.test/watch?list=*'],
        [{ intervention: BLOCK }],
      ),
    ]);
    expect(overflow).toEqual([]);
    expect(browser(rules, 'https://www.news.test/x')).toBe('redirect');
    expect(browser(rules, 'https://m.video.test/')).toBe('redirect');
    expect(browser(rules, 'https://www.video.test/')).toBe('none');
    expect(browser(rules, 'https://shop.test/cart/')).toBe('redirect');
    expect(browser(rules, 'https://shop.test/cart/item')).toBe('none');
    expect(browser(rules, 'https://blog.test/')).toBe('redirect');
    expect(browser(rules, 'https://blog.test/post')).toBe('none');
    expect(browser(rules, 'https://q.test/watch?v=1&list=2')).toBe('redirect');
    expect(browser(rules, 'https://q.test/watch?v=1')).toBe('none');
    expect(browser(rules, 'https://other.test/')).toBe('none');
  });

  it('an allowlist session redirects every website but the ones it allows', () => {
    const state = defaultState();
    const session: FocusSession = {
      id: 's',
      kind: 'allowlist',
      groups: [],
      allow: [t('docs.test')],
      startAt: at(0, 9),
      endAt: at(0, 11),
      createdAt: at(0, 9),
      locked: false,
      noPauses: false,
    };
    state.sessions.push(session);
    const { rules } = compile([group('A', ['news.test'], [{ intervention: BLOCK }])], state);
    expect(browser(rules, 'https://news.test/')).toBe('redirect');
    // Every other website is redirected during the session, the allowed ones are not.
    expect(browser(rules, 'https://anything.test/')).toBe('redirect');
    expect(browser(rules, 'https://docs.test/page')).toBe('allow');
  });

  it('frames of the sites of a rule are blocked only when the rule says so', () => {
    const plain = compile([group('A', ['video.test'], [{ intervention: BLOCK }])]);
    expect(browser(plain.rules, 'https://video.test/embed', 'sub_frame')).toBe('none');
    const embeds = compile([
      group('A', ['video.test', '+video.test/ok', 'clips.test/x'], [{ intervention: BLOCK }], {
        options: { privacy: 'all', embeds: true, tabs: 'all', timer: true, quickSession: true },
      }),
    ]);
    expect(browser(embeds.rules, 'https://video.test/embed', 'sub_frame')).toBe('block');
    expect(browser(embeds.rules, 'https://video.test/ok', 'sub_frame')).toBe('allow');
    expect(browser(embeds.rules, 'https://clips.test/x/1', 'sub_frame')).toBe('block');
  });

  it('regular expressions: a blocking one for its rule; an exception only when no other rule restricts', () => {
    const a = group('A', ['/^https?://re\\.test/', '+/^https?://re\\.test/ok/'], [{ intervention: BLOCK }]);
    const exception = a.targets[1].value;
    const alone = compile([a]);
    expect(alone.overflow).toEqual([]);
    expect(browser(alone.rules, 'https://re.test/x')).toBe('redirect');
    expect(browser(alone.rules, 'https://re.test/ok/1')).toBe('allow');
    // Another rule restricts too: the exception is left to the intervention page.
    const other = compile([a, group('B', ['re.test'], [{ intervention: delayIntervention(5) }])]);
    expect(other.overflow).toEqual([exception]);
    expect(browser(other.rules, 'https://re.test/ok/1')).toBe('redirect');
  });

  it('rules for normal or private windows only are left to the navigation listeners', () => {
    const g = group('A', ['news.test'], [{ intervention: BLOCK }]);
    g.options.privacy = 'private';
    expect(compile([g]).rules).toEqual([]);
  });

  it('an access to a site makes it a region of its own, allowed above the rule', () => {
    const state = defaultState();
    state.grants.push({
      id: 'g',
      kind: 'pass',
      groups: ['A'],
      scope: 'site',
      site: 'news.test',
      createdAt: at(0, 9),
      until: at(0, 11),
      severity: 5,
    });
    const g = group('A', ['news.test'], [{ intervention: delayIntervention(10) }]);
    expect(collectRegions(ctx(config([g]), at(0, 10), state)).map((r) => r.cp.key)).toEqual([
      'domain|news.test',
    ]);
    expect(compile([g], state).rules).toEqual([]);
  });

  it('within the browser limits, navigation rules first; the rest is reported', () => {
    const many = Array.from({ length: 6 }, (_, i) => `site${i}.test/path`);
    const g = group('A', [...many, '+site0.test/path/ok'], [{ intervention: BLOCK }]);
    const capped = compile([g], defaultState(), {
      ...OPTS,
      limits: { regex: 3, unsafe: 5000, total: 30000 },
    });
    expect(capped.rules.filter((r) => r.condition.regexFilter)).toHaveLength(3);
    expect(capped.overflow).toHaveLength(4);
    expect(capped.rules.every((r) => r.action.type === 'redirect')).toBe(true);
    const total = compile([g], defaultState(), { ...OPTS, limits: { regex: 1000, unsafe: 5000, total: 2 } });
    expect(total.rules).toHaveLength(2);
    expect(total.stats.total).toBe(2);
  });

  it('thousands of plain domains are split into rules of 2000', () => {
    const sites = Array.from({ length: 4500 }, (_, i) => `s${i}.test`);
    const { rules } = compile([group('A', sites, [{ intervention: BLOCK }])]);
    expect(rules.map((r) => r.condition.requestDomains?.length)).toEqual([2000, 2000, 500]);
  });
});
