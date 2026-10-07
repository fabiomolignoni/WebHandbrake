/**
 * Enforcement and matching in a real browser (ENF, MAT, SEM): what the declarativeNetRequest
 * rules, the navigation listeners and the intervention page do together.
 */

import { TEMPLATES } from '../../src/data/templates';
import { expect, test } from './harness';
import { BLOCK, CLOSE, delay, group, policy, redirect, TRACK, target } from './harness/config';
import { expectAllowed, expectBlocked, sleep } from './helpers';

test.describe('what is blocked', () => {
  test('ENF-01: a blocked site never receives a request; other sites load', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Block', ['blocked.test'], [policy(BLOCK)])];
    });
    const p = await expectBlocked(h, 'http://www.blocked.test/page?x=1');
    await p.expectUrl('/intervention.html#http://www.blocked.test/page?x=1');
    await p.role('heading', /protected/).expectVisible();
    await expectBlocked(h, 'http://deep.sub.blocked.test/');
    await expectAllowed(h, 'http://notblocked.test/');
    await expectAllowed(h, 'http://blocked.test.other.test/');
    expect(h.server.hits('www.blocked.test')).toEqual([]);
  });

  test('MAT-01: "this host only" leaves the other subdomains alone', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Host', ['=host.test'], [policy(BLOCK)])];
    });
    await expectBlocked(h, 'http://host.test/a');
    await expectBlocked(h, 'http://www.host.test/a');
    await expectAllowed(h, 'http://m.host.test/a');
  });

  test('MAT-03: paths (segment aware), exact pages and home pages', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Paths', ['paths.test/r/funny', 'pages.test/a?x=1$', 'home.test/$'], [policy(BLOCK)]),
      ];
    });
    await expectBlocked(h, 'http://paths.test/r/funny');
    await expectBlocked(h, 'http://paths.test/r/Funny/comments/1');
    await expectAllowed(h, 'http://paths.test/r/funnyvideos');
    await expectAllowed(h, 'http://paths.test/');
    await expectBlocked(h, 'http://pages.test/a?x=1');
    await expectBlocked(h, 'http://pages.test/a?y=2&x=1');
    await expectAllowed(h, 'http://pages.test/a');
    await expectAllowed(h, 'http://pages.test/a/b?x=1');
    await expectBlocked(h, 'http://home.test/');
    await expectBlocked(h, 'http://home.test/?ref=1');
    await expectAllowed(h, 'http://home.test/news');
  });

  test('MAT-05: wildcards in labels and segments, sites in every country', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group(
          'Wild',
          ['wild.test/r/*/comments', 'deep.test/**/end', 'shop.*', '*.cdn.test'],
          [policy(BLOCK)],
        ),
      ];
    });
    await expectBlocked(h, 'http://wild.test/r/rust/comments/1');
    await expectAllowed(h, 'http://wild.test/r/rust/hot');
    await expectBlocked(h, 'http://deep.test/a/b/c/end');
    await expectAllowed(h, 'http://deep.test/a/b/c');
    await expectBlocked(h, 'http://www.shop.co.test/item');
    await expectBlocked(h, 'http://shop.test/');
    await expectAllowed(h, 'http://shopping.test/');
    await expectBlocked(h, 'http://img.cdn.test/x');
  });

  test('MAT-07: query parameters that must be present', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Lists', ['tube.test/watch?list=*'], [policy(BLOCK)])];
    });
    await expectBlocked(h, 'http://tube.test/watch?v=1&list=PL');
    await expectAllowed(h, 'http://tube.test/watch?v=1');
  });

  test('MAT-06: regular expressions (advanced) are compiled to browser filters', async ({ h }) => {
    await h.configure((c) => {
      c.settings.advanced = true;
      c.groups = [group('Regex', ['/^https?:\\/\\/(www\\.)?rx\\.test\\/(a|b)\\//'], [policy(BLOCK)])];
    });
    const d = await h.rpc('diag.get');
    expect(d.rules.overflow).toEqual([]);
    await expectBlocked(h, 'http://rx.test/a/1');
    await expectBlocked(h, 'http://www.rx.test/b/2');
    await expectAllowed(h, 'http://rx.test/c/3');
  });

  test('ENF-01: every ready-made list fits the browser filters (none left to the fallback)', async ({
    h,
  }) => {
    await h.configure((c) => {
      c.groups = TEMPLATES.map((tpl) => group(tpl.id, tpl.sites, [policy(BLOCK)]));
    });
    const d = await h.rpc('diag.get');
    expect(d.rules.lastError).toBeNull();
    expect(d.rules.overflow).toEqual([]);
    expect(d.rules.regex).toBeGreaterThan(0);
    expect(d.rules.dynamic).toBeLessThanOrEqual(d.rules.limits.total);
    // A site of every list is stopped before the request.
    for (const tpl of TEMPLATES) {
      const site = tpl.sites.find((s) => /^[a-z0-9.-]+\.[a-z]+$/.test(s));
      if (site) await expectBlocked(h, `http://${site}/`);
    }
  });
});

test.describe('evaluation semantics', () => {
  test('SEM-06 / MAT-04: exceptions and exceptions of exceptions', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Reddit', ['reddit.test', '+reddit.test/r/*/comments', 'reddit.test/r/funny'], [policy(BLOCK)]),
      ];
    });
    await expectAllowed(h, 'http://reddit.test/r/rust/comments/1');
    await expectBlocked(h, 'http://reddit.test/r/funny/comments/1');
    await expectBlocked(h, 'http://reddit.test/');
    const why = await h.rpc('explain', { url: 'http://reddit.test/r/rust/comments/1' });
    expect(why.excepted[0].entry.value).toBe('reddit.test/r/*/comments');
  });

  test('SEM-04: an exception only affects its own group', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('A', ['news.test', '+news.test/sport'], [policy(BLOCK)]),
        group('B', ['news.test/sport'], [policy(BLOCK)]),
      ];
    });
    await expectBlocked(h, 'http://news.test/sport/today');
    const why = await h.rpc('explain', { url: 'http://news.test/sport/today' });
    expect(why.primary.name).toBe('B');
    expect(why.excepted.map((e: any) => e.name)).toEqual(['A']);
  });

  test('SEM-03: the most severe group wins whatever the order of the groups', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Soft', ['both.test'], [policy(delay(30))]),
        group('Hard', ['both.test'], [policy(BLOCK)]),
      ];
    });
    const p = await expectBlocked(h, 'http://both.test/');
    await p.get('.meta').expectText('Hard');
    await p.button('Continue').expectCount(0);
    // Reordering the groups changes nothing (Appendix A #11).
    await h.configure((c) => {
      c.groups.reverse();
    });
    const q = await expectBlocked(h, 'http://both.test/x');
    await q.get('.meta').expectText('Hard');
  });

  test('SEM-05: "always allowed" prevails over the groups and over focus sessions', async ({ h }) => {
    await h.configure((c) => {
      c.settings.protection.level = 'soft';
    });
    await h.configure((c) => {
      c.groups = [group('Block', ['bank.test'], [policy(BLOCK)])];
      c.allowlist = [target('bank.test/login')];
    });
    await expectAllowed(h, 'http://bank.test/login/x');
    await expectBlocked(h, 'http://bank.test/other');
    await h.rpc('session.start', {
      kind: 'allowlist',
      groups: [],
      allow: [target('docs.test')],
      minutes: 30,
      locked: false,
      noPauses: true,
    });
    await expectAllowed(h, 'http://bank.test/login/y');
    await expectAllowed(h, 'http://docs.test/manual');
    await expectBlocked(h, 'http://anything.test/');
  });

  test('disabled and archived rules do not restrict; enabling one restricts the open tabs (ENF-02)', async ({
    h,
  }) => {
    await h.configure((c) => {
      c.settings.protection.level = 'soft';
      c.groups = [
        group('Off', ['off.test'], [policy(BLOCK)], { enabled: false }),
        group('Archived', ['archived.test'], [policy(BLOCK)], { archived: true }),
      ];
    });
    const off = await expectAllowed(h, 'http://off.test/');
    await expectAllowed(h, 'http://archived.test/');
    await h.configure((c) => {
      c.groups[0].enabled = true;
    });
    await off.expectIntervention(true, 5000);
  });

  test('MAT-18: a shared list blocks in every rule linked to it', async ({ h }) => {
    const listId = 'list-social';
    await h.configure((c) => {
      c.lists = [
        { id: listId, rev: 1, updatedAt: Date.now(), name: 'Social', targets: [target('social.test')] },
      ];
      c.groups = [group('Weekdays', [], [policy(BLOCK)], { lists: [listId] })];
    });
    await expectBlocked(h, 'http://social.test/feed');
    const why = await h.rpc('explain', { url: 'http://social.test/feed' });
    expect(why.primary.name).toBe('Weekdays');
  });
});

test.describe('navigation layers', () => {
  test('ENF-03: single page navigations (pushState, replaceState) are caught', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Shorts', ['spa.test/shorts'], [policy(BLOCK)])];
    });
    const p = await expectAllowed(h, 'http://spa.test/home');
    await p.eval(() => history.pushState({}, '', '/shorts/123'));
    await p.expectUrl('intervention.html#http://spa.test/shorts/123');
    const q = await expectAllowed(h, 'http://spa.test/feed');
    await q.eval(() => history.replaceState({}, '', '/shorts/9'));
    await q.expectUrl('intervention.html#http://spa.test/shorts/9');
  });

  test('ENF-03 / MAT-07: fragment routes are checked only when an entry names a fragment', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Hash', ['app.test/web#/feed'], [policy(BLOCK)])];
    });
    const p = await expectAllowed(h, 'http://app.test/web');
    await p.eval(() => {
      location.hash = '#/inbox';
    });
    await sleep(800);
    expect(await p.isIntervention()).toBe(false);
    await p.eval(() => {
      location.hash = '#/feed';
    });
    await p.expectIntervention();
  });

  test('ENF-10: going back to a page that is now restricted shows the intervention', async ({ h }) => {
    await h.configure((c) => {
      c.settings.protection.level = 'soft';
      c.groups = [group('Back', ['back.test'], [policy(TRACK)])];
    });
    const p = await expectAllowed(h, 'http://back.test/a');
    await p.goto('http://elsewhere.test/');
    await p.expectReal('elsewhere.test/');
    await h.configure((c) => {
      c.groups[0].policies = [policy(BLOCK)];
    });
    await p.back();
    await p.expectIntervention();
    await p.expectUrl('#http://back.test/a');
  });

  test('MAT-13: embedded frames of a rule are blocked only when the rule says so', async ({ h }) => {
    h.server.route('host.test', {
      body: '<!doctype html><title>host</title><h1 id="real">REAL host</h1><iframe src="http://embed.test/video"></iframe><iframe src="http://other-embed.test/video"></iframe>',
    });
    await h.configure((c) => {
      c.groups = [
        group('Embeds', ['embed.test'], [policy(BLOCK)], {
          options: { privacy: 'all', embeds: true, tabs: 'all', timer: true, quickSession: true },
        }),
        group('Not embeds', ['other-embed.test'], [policy(BLOCK)]),
      ];
    });
    const p = await h.open('http://host.test/');
    await p.expectReal('host');
    await sleep(800);
    expect(h.server.hits('embed.test')).toEqual([]);
    expect(h.server.hits('other-embed.test')).toHaveLength(1);
  });

  test('INT-06 / ENF-09: a redirect goes to the chosen page, even inside the blocked site, without loops', async ({
    h,
  }) => {
    await h.configure((c) => {
      c.groups = [
        group('Redirect', ['fun.test'], [policy(redirect('http://work.test/todo?from={url}'))]),
        group('Loop', ['loop.test'], [policy(redirect('http://loop.test/allowed-page'))]),
      ];
    });
    const p = await h.open('http://fun.test/game');
    await p.expectUrl(/^http:\/\/work\.test\/todo\?from=http%3A%2F%2Ffun\.test%2Fgame/);
    await p.expectReal('work.test/todo');
    expect(h.server.hits('fun.test')).toEqual([]);
    // The destination itself is never redirected (ENF-09), the rest of its site is.
    const q = await h.open('http://loop.test/other');
    await q.expectReal('loop.test/allowed-page');
    expect(h.server.hits('loop.test', '/other')).toEqual([]);
  });

  test('INT-06: "close" closes the tab', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Close', ['close.test'], [policy(CLOSE)])];
    });
    const before = (await h.tabs()).length;
    await h.open('http://close.test/');
    await expect.poll(async () => (await h.tabs()).some((t) => t.url.includes('close.test'))).toBe(false);
    expect((await h.tabs()).length).toBe(before);
    expect(h.server.hits('close.test')).toEqual([]);
  });

  test('MAT-19: rules for normal windows apply when navigation starts; rules for private windows do not', async ({
    h,
  }) => {
    const opts = (privacy: string) => ({
      options: { privacy, embeds: false, tabs: 'all', timer: true, quickSession: true },
    });
    await h.configure((c) => {
      c.groups = [
        group('Normal only', ['normal.test'], [policy(BLOCK)], opts('normal')),
        group('Private only', ['private.test'], [policy(BLOCK)], opts('private')),
      ];
    });
    // Not in the browser filters (they cannot tell windows apart): handled by the navigation layer.
    const d = await h.rpc('diag.get');
    expect(d.rules.dynamic).toBe(0);
    const p = await h.open('http://normal.test/x');
    await p.expectIntervention();
    await expectAllowed(h, 'http://private.test/x');
  });

  test('ENF-02: a rule for inactive tabs only restricts the tabs in the background at once', async ({
    h,
  }) => {
    await h.configure((c) => {
      c.settings.protection.level = 'soft';
      c.groups = [
        group('Background', ['bg.test'], [policy(TRACK)], {
          options: { privacy: 'all', embeds: false, tabs: 'inactive', timer: true, quickSession: true },
        }),
      ];
    });
    const background = await expectAllowed(h, 'http://bg.test/one');
    const front = await expectAllowed(h, 'http://bg.test/two');
    await front.front();
    await h.configure((c) => {
      c.groups[0].policies = [policy(BLOCK)];
    });
    await background.expectIntervention(true, 5000);
    await sleep(500);
    expect(await front.isIntervention()).toBe(false);
    // A new navigation is always checked.
    await front.goto('http://bg.test/three');
    await front.expectIntervention();
  });
});

test.describe('restoring blocked pages', () => {
  test('ENF-04: when a rule ends the page offers "Reopen", and the original URL comes back', async ({
    h,
  }) => {
    await h.configure((c) => {
      c.settings.protection.level = 'soft';
      c.groups = [group('Paper', ['paper.test'], [policy(BLOCK)])];
    });
    const p = await expectBlocked(h, 'http://paper.test/story?id=7');
    await h.configure((c) => {
      c.groups[0].enabled = false;
    });
    await p.button('Reopen the page').click();
    await p.expectReal('paper.test/story?id=7');
  });

  test('ENF-04: with automatic reopening the page comes back by itself', async ({ h }) => {
    await h.configure((c) => {
      c.settings.protection.level = 'soft';
      c.settings.interventions.autoReopen = true;
      c.groups = [group('Paper', ['paper.test'], [policy(BLOCK)])];
    });
    const p = await expectBlocked(h, 'http://paper.test/a');
    await h.configure((c) => {
      c.groups[0].enabled = false;
    });
    await p.expectReal('paper.test/a');
  });

  test('ENF-04: blocked tabs are restored in bulk', async ({ h }) => {
    await h.configure((c) => {
      c.settings.protection.level = 'soft';
      c.groups = [group('Paper', ['paper.test'], [policy(BLOCK)])];
    });
    const a = await expectBlocked(h, 'http://paper.test/1');
    const b = await expectBlocked(h, 'http://paper.test/2');
    await h.configure((c) => {
      c.groups[0].enabled = false;
    });
    expect((await h.rpc('overview.get')).restorable).toBe(2);
    expect(await h.rpc('tabs.reopenBlocked')).toEqual({ reopened: 2 });
    await a.expectReal('paper.test/1');
    await b.expectReal('paper.test/2');
  });
});
