import { describe, expect, it } from 'vitest';
import { compileTargets } from '../../src/engine/compile';
import {
  checkRegex,
  compilePattern,
  contentMatchPatterns,
  dnrRegex,
  isPlainDomain,
  matchPattern,
  mayOverlap,
  parseTargetLine,
  parseTargetList,
  representativeUrl,
  siteKeyFor,
  targetToLine,
  Wildcard,
} from '../../src/engine/patterns';
import type { Target } from '../../src/engine/types';
import { parseUrl } from '../../src/engine/url';
import { t } from './helpers';

const target = (line: string) => parseTargetLine(line)?.target;
const matches = (line: string, url: string) => {
  const cp = compilePattern(t(line));
  const p = parseUrl(url);
  if (!cp || !p) throw new Error('compile');
  return matchPattern(cp, p);
};

describe('target syntax and normalisation', () => {
  it('normalises pasted URLs', () => {
    expect(target('https://www.YouTube.com/')).toEqual({ type: 'domain', value: 'youtube.com' });
    expect(target('http://user:pw@example.com:8080/Path/')).toEqual({
      type: 'path',
      value: 'example.com/path',
    });
    expect(target('Bücher.example')).toEqual({ type: 'domain', value: 'xn--bcher-kva.example' });
  });

  it('parses kinds', () => {
    expect(target('=m.youtube.com')).toEqual({ type: 'host', value: 'm.youtube.com' });
    expect(target('example.com/page$')).toEqual({ type: 'page', value: 'example.com/page' });
    expect(target('example.com/$')).toEqual({ type: 'homepage', value: 'example.com' });
    expect(target('youtube.com/watch?list=*')).toEqual({ type: 'path', value: 'youtube.com/watch?list=*' });
    expect(target('+reddit.com/r/rust  # useful')).toEqual({
      type: 'path',
      value: 'reddit.com/r/rust',
      allow: true,
    });
    expect(target('/^https?:\\/\\/foo/')).toEqual({ type: 'regex', value: '^https?:\\/\\/foo' });
    expect(target('about:config')).toEqual({ type: 'path', value: 'about:config' });
    expect(target('file:///home/me/notes')).toEqual({ type: 'path', value: 'file:///home/me/notes' });
  });

  it('imports uBlock Origin, AdGuard, uBlacklist and hosts syntax', () => {
    expect(target('||example.com^')).toEqual({ type: 'domain', value: 'example.com' });
    expect(target('||example.com/ads^$third-party')).toEqual({ type: 'path', value: 'example.com/ads' });
    expect(target('*://*.example.com/*')).toEqual({ type: 'domain', value: 'example.com' });
    expect(target('*://example.com/*')).toEqual({ type: 'host', value: 'example.com' });
    expect(target('0.0.0.0 tracker.example')).toEqual({ type: 'domain', value: 'tracker.example' });
    expect(parseTargetLine('127.0.0.1 localhost')).toEqual({ comment: true });
    expect(target('@@||ok.example^')).toEqual({ type: 'domain', value: 'ok.example', allow: true });
  });

  it('reports errors line by line', () => {
    const r = parseTargetList('youtube.com\n# comment\nhttp://\nnot-a-site\n/(a+)+/');
    expect(r.targets).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(r.errors[2].error).toBe('targets.error.regexNested');
  });

  it('skips filter list headers whole (regression)', () => {
    const r = parseTargetList('[Adblock Plus 2.0]\n||example.com^');
    expect(r.errors).toEqual([]);
    expect(r.targets).toEqual([{ type: 'domain', value: 'example.com' }]);
  });

  it('keeps "+ entry" (with a space) an exception, never a blocking entry (regression)', () => {
    const r = parseTargetList('+ reddit.com/r/rust\n@@ example.com');
    expect(r.errors).toEqual([]);
    expect(r.targets).toEqual([
      { type: 'path', value: 'reddit.com/r/rust', allow: true },
      { type: 'domain', value: 'example.com', allow: true },
    ]);
  });

  it('a word without a dot is not a site (except localhost)', () => {
    const r = parseTargetList('not a site\nlocalhost\nyoutube.com');
    expect(r.targets.map((x) => x.value)).toEqual(['localhost', 'youtube.com']);
    // A sentence is one error for the whole line, not one per word.
    expect(r.errors).toEqual([{ line: 1, text: 'not a site', error: 'targets.error.noDot' }]);
    // Among real sites, each wrong entry is reported on its own.
    const mixed = parseTargetList('facebook.com twitter instagram.com tiktok');
    expect(mixed.targets.map((x) => x.value)).toEqual(['facebook.com', 'instagram.com']);
    expect(mixed.errors.map((e) => e.text)).toEqual(['twitter', 'tiktok']);
  });

  it('accepts several sites on one line, separated by spaces', () => {
    const r = parseTargetList('facebook.com +facebook.com/groups twitter.com');
    expect(r.targets.map((x) => x.value)).toEqual(['facebook.com', 'facebook.com/groups', 'twitter.com']);
  });

  it('accepts sites separated by commas or semicolons, never keeping the separator (regression)', () => {
    const r = parseTargetList('pornhub.com, xvideos.com, *porn*, *xxx*, reddit.com/r/nsfw, onlyfans.com');
    expect(r.errors).toEqual([]);
    expect(r.targets.map((x) => x.value)).toEqual([
      'pornhub.com',
      'xvideos.com',
      '*porn*',
      '*xxx*',
      'reddit.com/r/nsfw',
      'onlyfans.com',
    ]);
    expect(parseTargetList('a.com,b.com;+b.com/feed').targets).toEqual([
      { type: 'domain', value: 'a.com' },
      { type: 'domain', value: 'b.com' },
      { type: 'path', value: 'b.com/feed', allow: true },
    ]);
    // A comma that belongs to the address keeps it whole; a regular expression is never split.
    expect(parseTargetList('a.com/search?q=a,b').targets.map((x) => x.value)).toEqual(['a.com/search?q=a,b']);
    expect(parseTargetList('/a{1,3}b/').targets).toEqual([{ type: 'regex', value: 'a{1,3}b' }]);
    expect(parseTargetList(',\n;').targets).toEqual([]);
  });

  it('round-trips through the text syntax', () => {
    for (const line of [
      'youtube.com',
      '=m.youtube.com',
      'a.com/b$',
      'a.com/$',
      '+a.com/x/*/y',
      '/foo\\d+/',
    ]) {
      expect(targetToLine(target(line)!)).toBe(line);
    }
  });
});

describe('matching', () => {
  it('domains include subdomains', () => {
    expect(matches('youtube.com', 'https://m.youtube.com/watch?v=1')).toBe(true);
    expect(matches('youtube.com', 'https://notyoutube.com/')).toBe(false);
    expect(matches('=youtube.com', 'https://www.youtube.com/')).toBe(true);
    expect(matches('=youtube.com', 'https://m.youtube.com/')).toBe(false);
  });

  it('paths are segment aware and case insensitive', () => {
    expect(matches('reddit.com/r/funny', 'https://old.reddit.com/r/Funny/comments/1')).toBe(true);
    expect(matches('reddit.com/r/funny', 'https://reddit.com/r/funnyvideos')).toBe(false);
    expect(matches('example.com/page$', 'https://example.com/page/?x=1')).toBe(true);
    expect(matches('example.com/page$', 'https://example.com/page/sub')).toBe(false);
    expect(matches('example.com/$', 'https://example.com/?ref=1')).toBe(true);
    expect(matches('example.com/$', 'https://example.com/a')).toBe(false);
  });

  it('supports wildcards', () => {
    expect(matches('reddit.com/r/*/comments/*', 'https://reddit.com/r/rust/comments/123/title')).toBe(true);
    expect(matches('reddit.com/r/*/comments/*', 'https://reddit.com/r/rust/hot')).toBe(false);
    expect(matches('example.*', 'https://example.co.uk/')).toBe(true);
    expect(matches('*.example.com', 'https://a.b.example.com/')).toBe(true);
    expect(matches('a.com/**/end', 'https://a.com/x/y/z/end')).toBe(true);
  });

  it('matches IP addresses, IPv6 included (regression)', () => {
    expect(matches('192.168.1.10', 'http://192.168.1.10:8080/admin')).toBe(true);
    expect(matches('[::1]', 'http://[::1]:3000/')).toBe(true);
    expect(matches('[::1]', 'http://[::2]/')).toBe(false);
    const index = compileTargets([t('[::1]')]);
    expect(index.match(parseUrl('http://[::1]/x')!)).toHaveLength(1);
  });

  it('matches query parameters', () => {
    expect(matches('youtube.com/watch?list=*', 'https://youtube.com/watch?v=1&list=PL')).toBe(true);
    expect(matches('youtube.com/watch?list=*', 'https://youtube.com/watch?v=1')).toBe(false);
    expect(matches('youtube.com/watch?v=AbC$', 'https://youtube.com/watch?v=AbC&t=1')).toBe(true);
    expect(matches('youtube.com/watch?v=AbC$', 'https://youtube.com/watch?v=abc')).toBe(false);
  });

  it('matches query parameters written as the address bar shows them', () => {
    const url = 'https://example.com/search?q=hello+world&lang=caf%C3%A9';
    for (const line of [
      'example.com/search?q=hello%20world',
      'example.com/search?q=hello+world',
      'example.com/search?lang=café',
      'example.com/search?lang=caf%C3%A9',
      'example.com/search?q=hello%20*',
    ])
      expect([line, matches(line, url)]).toEqual([line, true]);
    expect(matches('example.com/search?q=a%26b', 'https://example.com/search?q=a%26b')).toBe(true);
    expect(matches('example.com/search?q=a%26b', 'https://example.com/search?q=a&b')).toBe(false);
  });

  it('matches internal pages, local files and reader mode', () => {
    expect(matches('about:addons', 'about:addons')).toBe(true);
    expect(matches('chrome://extensions', 'chrome://extensions/?id=x')).toBe(true);
    expect(matches('file:///home/me', 'file:///home/me/a.html')).toBe(true);
    expect(matches('example.com', 'about:reader?url=https%3A%2F%2Fexample.com%2Fa')).toBe(true);
    expect(matches('example.com', 'view-source:https://example.com/')).toBe(true);
  });

  it('exceptions of exceptions with ties won by blocks', () => {
    const index = compileTargets([
      t('reddit.com'),
      t('+reddit.com/r/*/comments/*'),
      t('reddit.com/r/funny/*'),
    ]);
    const w = (url: string) => index.winner(parseUrl(url)!).winner!;
    expect(w('https://reddit.com/r/rust/comments/1').allow).toBe(true);
    expect(w('https://reddit.com/r/funny/comments/1').allow).toBe(false);
    expect(w('https://reddit.com/').allow).toBe(false);
  });
});

describe('regular expression safety', () => {
  it('rejects catastrophic patterns', () => {
    expect(checkRegex('(a+)+$')).toBe('targets.error.regexNested');
    expect(checkRegex('(.*a){1,}')).toBe('targets.error.regexNested');
    expect(checkRegex('(\\w+\\s?)*$')).toBe('targets.error.regexNested');
    expect(checkRegex('(a)\\1')).toBe('targets.error.regexBackref');
    expect(checkRegex('foo(?=bar)')).toBe('targets.error.regexLookaround');
    expect(checkRegex('[')).toBe('targets.error.regexInvalid');
    expect(checkRegex('^https?://([a-z]+\\.)?example\\.com/(foo|bar)')).toBeNull();
  });
});

describe('DNR expressions and representative URLs', () => {
  const re = (line: string) => new RegExp(`^${dnrRegex(compilePattern(t(line))!)!.re}$`, 'i');
  it('match what the engine matches', () => {
    const cases: [string, string, boolean][] = [
      ['reddit.com/r/funny', 'https://old.reddit.com/r/funny/comments/1?x=2', true],
      ['reddit.com/r/funny', 'https://reddit.com/r/funnyx', false],
      ['=example.com', 'https://www.example.com/a', true],
      ['=example.com', 'https://a.example.com/a', false],
      ['example.com/$', 'https://example.com/?q=1', true],
      ['example.com/$', 'https://example.com/a', false],
      ['example.com/page$', 'https://example.com/page/', true],
      ['youtube.com/watch?list=*', 'https://www.youtube.com/watch?v=1&list=PL1', true],
      ['youtube.com/watch?list=*', 'https://www.youtube.com/watch?v=1', false],
      ['a.com/x?b=1&c=2', 'https://a.com/x?c=2&z=0&b=1', true],
      ['reddit.com/r/*/comments/*', 'https://reddit.com/r/a/comments/b', true],
      ['a.com/s?q=hello%20world', 'https://a.com/s?q=hello+world', true],
      ['a.com/s?q=hello+world', 'https://a.com/s?q=hello%20world', true],
      ['a.com/s?q=café', 'https://a.com/s?q=caf%C3%A9', true],
      ['a.com/s?q=a%26b', 'https://a.com/s?q=a%26b', true],
      ['a.com/s?q=a%26b', 'https://a.com/s?q=a&b', false],
      ['a.com/s?q=c%2B%2B', 'https://a.com/s?q=c%2B%2B', true],
      ['a.com/s?q=c%2B%2B', 'https://a.com/s?q=c++', false],
    ];
    for (const [line, url, expected] of cases)
      expect([line, url, re(line).test(url)]).toEqual([line, url, expected]);
  });

  it('representative URLs fall in their own region', () => {
    for (const line of [
      'youtube.com',
      'reddit.com/r/*/comments',
      'a.com/x?b=*',
      'example.*',
      '=m.a.com',
      'a.com/$',
      'a.com/s?q=hello%20world&r=a%26b*',
    ]) {
      const cp = compilePattern(t(line))!;
      expect(matchPattern(cp, parseUrl(representativeUrl(cp)!)!)).toBe(true);
    }
  });
});

describe('address wildcards and every website', () => {
  it('an entry without a site name is a wildcard on the whole address', () => {
    expect(target('*example*')).toEqual({ type: 'wildcard', value: '*example*' });
    expect(target('https://www.*News*/')).toEqual({ type: 'wildcard', value: '*news*' });
    expect(target('example*')).toEqual({ type: 'wildcard', value: 'example*' });
    expect(target('*watch*/shorts/**')).toEqual({ type: 'wildcard', value: '*watch*/shorts/*' });
    expect(target('+*work*')).toEqual({ type: 'wildcard', value: '*work*', allow: true });
    expect(target('*://*/news/*')).toEqual({ type: 'wildcard', value: '*/news/*' });
    // With a site name, * stays a wildcard of the host or the path.
    expect(target('*.example.com')).toEqual({ type: 'domain', value: '*.example.com' });
    expect(target('amazon.*')).toEqual({ type: 'domain', value: 'amazon.*' });
    for (const line of ['*example*', 'example*', '+*work*', '*'])
      expect(targetToLine(target(line)!)).toBe(line);
  });

  it('*word* matches every address that contains the word, in the host, the path or the query', () => {
    for (const url of [
      'https://example.com/',
      'https://www.news.test/an-Example/today',
      'https://search.test/?q=example',
      'http://sub.example.org:8080/x',
    ])
      expect([url, matches('*example*', url)]).toEqual([url, true]);
    for (const url of ['https://exampl.com/', 'about:example', 'file:///home/example.txt'])
      expect([url, matches('*example*', url)]).toEqual([url, false]);
    // Without a leading or trailing *, the address starts or ends with the text.
    expect(matches('example*', 'https://www.example.com/a')).toBe(true);
    expect(matches('example*', 'https://my-example.com/')).toBe(false);
    expect(matches('*/shorts', 'https://video.test/shorts/')).toBe(true);
    expect(matches('*/shorts', 'https://video.test/shorts/1')).toBe(false);
  });

  it('*, *.*, *://*/* and <all_urls> cover every website and nothing else', () => {
    for (const line of ['*', '*.*', '*.*.*', '**', '*://*/*', '<all_urls>', '*/*'])
      expect([line, target(line)]).toEqual([line, { type: 'wildcard', value: '*' }]);
    for (const url of ['https://example.com/', 'http://localhost:3000/x?y=1', 'https://[::1]/'])
      expect([url, matches('*', url)]).toEqual([url, true]);
    for (const url of ['about:config', 'chrome://extensions', 'file:///etc/hosts'])
      expect([url, matches('*', url)]).toEqual([url, false]);
  });

  it('come after every entry with a site name, and every website last', () => {
    const spec = (line: string) => compilePattern(t(line))!.spec;
    expect(spec('*')).toBeLessThan(spec('*example*'));
    expect(spec('*example*')).toBeLessThan(spec('*example*/help'));
    expect(spec('*example*/help')).toBeLessThan(spec('amazon.*'));
    expect(spec('*example*')).toBeLessThan(spec('*.example.com'));
  });

  it('are compiled for the browser filters and need the content script everywhere', () => {
    const re = (line: string) => new RegExp(`^${dnrRegex(compilePattern(t(line))!)!.re}$`, 'i');
    expect(re('*example*').test('https://www.news.test/an-example/today')).toBe(true);
    expect(re('*example*').test('https://news.test/')).toBe(false);
    expect(re('*').test('http://user@any.test:8080/a?b#c')).toBe(true);
    expect(re('*/shorts').test('https://video.test/shorts/')).toBe(true);
    expect(isPlainDomain(compilePattern(t('*'))!)).toBe(false);
    for (const line of ['*', '*example*', 'example*', '*/shorts', '*?q=cats*']) {
      const cp = compilePattern(t(line))!;
      expect([line, matchPattern(cp, parseUrl(representativeUrl(cp)!)!)]).toEqual([line, true]);
      expect(contentMatchPatterns(cp)).toEqual(['<all_urls>']);
    }
  });

  it('count each site on its own', () => {
    const cp = compilePattern(t('*'))!;
    expect(siteKeyFor(cp, parseUrl('https://www.video.test/x')!)).toBe('video.test');
  });

  it('a wildcard label that is not plain ASCII is refused instead of looping (regression)', () => {
    expect(parseTargetLine('caf*é.com')?.error).toBe('targets.error.invalid');
  });
});

describe('hosts files (regression)', () => {
  it('imports the host of each line, never the IP address or localhost', () => {
    const r = parseTargetList(
      '127.0.0.1 localhost\n0.0.0.0 ads.example\n::1 localhost\n0.0.0.0 tracker.example # note',
    );
    expect(r.targets.map((x) => x.value)).toEqual(['ads.example', 'tracker.example']);
    expect(r.errors).toEqual([]);
  });

  it('keeps regular expressions with spaces whole', () => {
    expect(parseTargetList('/a b/').targets).toEqual([{ type: 'regex', value: 'a b' }]);
  });
});

describe('patterns that cannot freeze the background', () => {
  const N = 4096;

  it('regular expressions: few open-ended repetitions, none of them nested or over alternatives', () => {
    for (const unsafe of [
      '.*.*.*.*!',
      '.+.+x',
      '\\w+\\w+\\w+x',
      '(\\w|\\d)*!',
      '^.*a.*b.*c',
      'a{0,}b{1,}',
      '^x.{0,500}y.{0,500}z.{0,500}',
    ])
      expect(checkRegex(unsafe), unsafe).not.toBeNull();
    for (const safe of [
      '^https?://(www\\.)?reddit\\.com/r/[^/]+/comments/.*',
      '.*foo',
      'youtube\\.com/(shorts|watch)',
      '^https?://.*a.*b',
      '^x.{0,40}y',
    ])
      expect(checkRegex(safe), safe).toBeNull();
  });

  it('an accepted expression stays fast on a long hostile address', () => {
    for (const re of ['^https?://.*a.*b', '.*x']) {
      expect(checkRegex(re)).toBeNull();
      const started = performance.now();
      new RegExp(re, 'i').test(`https://${'a'.repeat(N)}`);
      expect(performance.now() - started, re).toBeLessThan(1000);
    }
  });

  it('wildcards are matched in linear time: * stays within a segment of a path, ** does not', () => {
    const started = performance.now();
    expect(new Wildcard('*a*a*a*a*x', false).test('a'.repeat(N))).toBe(false);
    expect(new Wildcard('/*a*a*a*x', true, 'prefix').test(`/${'a'.repeat(N)}`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(new Wildcard('*news*', false).test('example.com/news/today')).toBe(true);
    const section = new Wildcard('/r/*/comments', true, 'prefix');
    expect(section.test('/r/rust/comments')).toBe(true);
    expect(section.test('/r/rust/comments/123')).toBe(true);
    expect(section.test('/r/a/b/comments')).toBe(false);
    expect(new Wildcard('/r/**/comments', true, 'prefix').test('/r/a/b/comments')).toBe(true);
    const page = new Wildcard('/watch*', true, 'exact');
    expect(page.test('/watch-later')).toBe(true);
    expect(page.test('/watch/')).toBe(true);
    expect(page.test('/watch/more')).toBe(false);
  });
});

describe('patterns that may match a common address', () => {
  const cp = (type: Target['type'], value: string) => {
    const c = compilePattern({ id: value, type, value });
    if (!c) throw new Error(value);
    return c;
  };
  const overlap = (a: Parameters<typeof cp>, b: Parameters<typeof cp>) => [
    mayOverlap(cp(...a), cp(...b)),
    mayOverlap(cp(...b), cp(...a)),
  ];

  it('compares hosts and their subdomains', () => {
    expect(overlap(['domain', 'example.com'], ['domain', 'example.com'])).toEqual([true, true]);
    expect(overlap(['domain', 'example.com'], ['host', 'm.example.com'])).toEqual([true, true]);
    expect(overlap(['domain', 'example.com'], ['path', 'www.example.com/news'])).toEqual([true, true]);
    expect(overlap(['host', 'm.example.com'], ['host', 'www.example.com'])).toEqual([false, false]);
    expect(overlap(['domain', 'example.com'], ['domain', 'example.org'])).toEqual([false, false]);
    expect(overlap(['domain', 'example.com'], ['domain', 'notexample.com'])).toEqual([false, false]);
  });

  it('widens wildcards and errs towards an overlap when it cannot tell', () => {
    expect(overlap(['domain', 'a*.example.com'], ['domain', 'abc.example.com'])).toEqual([true, true]);
    expect(overlap(['domain', 'a*.example.com'], ['domain', 'example.org'])).toEqual([false, false]);
    expect(overlap(['domain', 'amazon.*'], ['domain', 'example.org'])).toEqual([true, true]);
    expect(overlap(['wildcard', 'example.com/a*'], ['domain', 'example.com'])).toEqual([true, true]);
    expect(overlap(['wildcard', 'example.com/a*'], ['domain', 'example.org'])).toEqual([false, false]);
    expect(overlap(['wildcard', '*example*'], ['domain', 'example.org'])).toEqual([true, true]);
    expect(overlap(['regex', '^https://example\\.org/'], ['domain', 'example.com'])).toEqual([true, true]);
  });
});
