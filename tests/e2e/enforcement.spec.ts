/**
 * Enforcement and matching in a real browser: what the declarativeNetRequest
 * rules, the navigation listeners and the intervention page do together.
 */

import { TEMPLATES } from '../../src/data/templates';
import { expect, test } from './harness';
import { BLOCK, CLOSE, delay, group, PERMANENT, policy, REMINDER, redirect, TRACK } from './harness/config';
import { expectAllowed, expectBlocked, sleep } from './helpers';

test.describe('what is blocked', () => {
  test('a blocked site never receives a request; other sites load', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Block', ['blocked.test'], [policy(BLOCK)])];
    });
    const p = await expectBlocked(h, 'http://www.blocked.test/page?x=1');
    await p.expectUrl('/intervention.html#http://www.blocked.test/page?x=1');
    await p.role('heading', /blocked/).expectVisible();
    await expectBlocked(h, 'http://deep.sub.blocked.test/');
    await expectAllowed(h, 'http://notblocked.test/');
    await expectAllowed(h, 'http://blocked.test.other.test/');
    expect(h.server.hits('www.blocked.test')).toEqual([]);
  });

  test('"this host only" leaves the other subdomains alone', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Host', ['=host.test'], [policy(BLOCK)])];
    });
    await expectBlocked(h, 'http://host.test/a');
    await expectBlocked(h, 'http://www.host.test/a');
    await expectAllowed(h, 'http://m.host.test/a');
  });

  test('paths (segment aware), exact pages and home pages', async ({ h }) => {
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

  test('wildcards in labels and segments, sites in every country', async ({ h }) => {
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

  test('a wildcard without a site name matches the whole address (#23)', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Shorts', ['*shorts*', '+*shorts*/help'], [policy(BLOCK)])];
    });
    await expectBlocked(h, 'http://video.test/shorts/1');
    await expectBlocked(h, 'http://www.shorts.test/');
    await expectBlocked(h, 'http://search.test/?q=shorts');
    await expectAllowed(h, 'http://video.test/watch?v=1');
    await expectAllowed(h, 'http://video.test/shorts/help');
  });

  test('a rule over every website, with exceptions (#20)', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Everything', ['*', '+work.test'], [policy(BLOCK)])];
      for (const g of c.groups) g.protection = REMINDER;
    });
    await expectBlocked(h, 'http://any.test/');
    await expectBlocked(h, 'http://other.example.test/a?b=1');
    await expectAllowed(h, 'http://work.test/today');
    // The extension's own pages stay reachable.
    const dashboard = await h.page('dashboard.html#/today');
    await dashboard.role('heading', 'Today', { exact: true }).expectVisible();
  });

  test('query parameters that must be present', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Lists', ['tube.test/watch?list=*'], [policy(BLOCK)])];
    });
    await expectBlocked(h, 'http://tube.test/watch?v=1&list=PL');
    await expectAllowed(h, 'http://tube.test/watch?v=1');
  });

  test('regular expressions (advanced) are compiled to browser filters', async ({ h }) => {
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

  test('every ready-made list fits the browser filters (none left to the fallback)', async ({ h }) => {
    await h.configure((c) => {
      c.groups = TEMPLATES.map((tpl) => group(tpl.id, tpl.entries, [policy(BLOCK)]));
    });
    const d = await h.rpc('diag.get');
    expect(d.rules.lastError).toBeNull();
    expect(d.rules.overflow).toEqual([]);
    expect(d.rules.regex).toBeGreaterThan(0);
    expect(d.rules.dynamic).toBeLessThanOrEqual(d.rules.limits.total);
    // A site of every list is stopped before the request.
    for (const tpl of TEMPLATES) {
      const site = tpl.entries.find((s) => /^[a-z0-9.-]+\.[a-z]+$/.test(s));
      if (site) await expectBlocked(h, `http://${site}/`);
    }
  });
});

test.describe('evaluation semantics', () => {
  test('exceptions and exceptions of exceptions', async ({ h }) => {
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

  test('an exception only affects its own group', async ({ h }) => {
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

  test('the most severe group wins whatever the order of the groups', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Soft', ['both.test'], [policy(delay(30))]),
        group('Hard', ['both.test'], [policy(BLOCK)]),
      ];
    });
    const p = await expectBlocked(h, 'http://both.test/');
    await p.get('.meta').expectText('Hard');
    await p.button('Continue').expectCount(0);
    // Reordering the groups changes nothing.
    await h.configure((c) => {
      c.groups.reverse();
    });
    const q = await expectBlocked(h, 'http://both.test/x');
    await q.get('.meta').expectText('Hard');
  });

  test('disabled and archived rules do not restrict; enabling one restricts the open tabs', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Off', ['off.test'], [policy(BLOCK)], { enabled: false }),
        group('Archived', ['archived.test'], [policy(BLOCK)], { archived: true }),
      ];
      for (const g of c.groups) g.protection = REMINDER;
    });
    const off = await expectAllowed(h, 'http://off.test/');
    await expectAllowed(h, 'http://archived.test/');
    await h.configure((c) => {
      c.groups[0].enabled = true;
    });
    await off.expectIntervention(true, 5000);
  });
});

test.describe('navigation layers', () => {
  test('single page navigations (pushState, replaceState) are caught', async ({ h }) => {
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

  test('fragment routes are checked only when an entry names a fragment', async ({ h }) => {
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

  test('going back to a page that is now restricted shows the intervention', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Back', ['back.test'], [policy(TRACK)])];
      for (const g of c.groups) g.protection = REMINDER;
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

  test('embedded frames of a rule are blocked only when the rule says so', async ({ h }) => {
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

  test('a redirect goes to the chosen page, even inside the blocked site, without loops', async ({ h }) => {
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
    // The destination itself is never redirected, the rest of its site is.
    const q = await h.open('http://loop.test/other');
    await q.expectReal('loop.test/allowed-page');
    expect(h.server.hits('loop.test', '/other')).toEqual([]);
  });

  test('a redirect destination stays restricted by the other rules (regression)', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Video', ['video.test'], [policy(BLOCK)], { protection: PERMANENT }),
        group('Off', ['off.test'], [policy(redirect('http://video.test/watch'))], { enabled: false }),
        group('Escape', ['escape.test'], [policy(redirect('http://video.test/watch'))]),
      ];
    });
    // Neither a rule that is off nor an active one opens the page that another rule blocks.
    await expectBlocked(h, 'http://video.test/watch?v=1');
    await expectBlocked(h, 'http://escape.test/');
    expect(h.server.hits('video.test')).toEqual([]);
  });

  test('"close" closes the tab', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Close', ['close.test'], [policy(CLOSE)])];
    });
    const before = (await h.tabs()).length;
    await h.open('http://close.test/');
    await expect.poll(async () => (await h.tabs()).some((t) => t.url.includes('close.test'))).toBe(false);
    expect((await h.tabs()).length).toBe(before);
    expect(h.server.hits('close.test')).toEqual([]);
  });

  test('rules for normal windows apply when navigation starts; rules for private windows do not', async ({
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

  test('a rule for inactive tabs only restricts the tabs in the background at once', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Background', ['bg.test'], [policy(TRACK)], {
          options: { privacy: 'all', embeds: false, tabs: 'inactive', timer: true, quickSession: true },
        }),
      ];
      for (const g of c.groups) g.protection = REMINDER;
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
  test('when a rule ends the page offers "Reopen", and the original URL comes back', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Paper', ['paper.test'], [policy(BLOCK)])];
      for (const g of c.groups) g.protection = REMINDER;
    });
    const p = await expectBlocked(h, 'http://paper.test/story?id=7');
    await h.configure((c) => {
      c.groups[0].enabled = false;
    });
    await p.button('Reopen the page').click();
    await p.expectReal('paper.test/story?id=7');
  });

  test('with automatic reopening the page comes back by itself', async ({ h }) => {
    await h.configure((c) => {
      c.settings.interventions.autoReopen = true;
      c.groups = [group('Paper', ['paper.test'], [policy(BLOCK)])];
      for (const g of c.groups) g.protection = REMINDER;
    });
    const p = await expectBlocked(h, 'http://paper.test/a');
    await h.configure((c) => {
      c.groups[0].enabled = false;
    });
    await p.expectReal('paper.test/a');
  });

  test('blocked tabs are restored in bulk', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Paper', ['paper.test'], [policy(BLOCK)])];
      for (const g of c.groups) g.protection = REMINDER;
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
