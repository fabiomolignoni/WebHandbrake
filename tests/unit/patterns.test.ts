import { describe, expect, it } from 'vitest';
import { compileTargets } from '../../src/engine/compile';
import {
  checkRegex,
  compilePattern,
  dnrRegex,
  matchPattern,
  parseTargetLine,
  parseTargetList,
  representativeUrl,
  targetToLine,
} from '../../src/engine/patterns';
import { parseUrl } from '../../src/engine/url';
import { t } from './helpers';

const target = (line: string) => parseTargetLine(line)?.target;
const matches = (line: string, url: string) => {
  const cp = compilePattern(t(line));
  const p = parseUrl(url);
  if (!cp || !p) throw new Error('compile');
  return matchPattern(cp, p);
};

describe('target syntax and normalisation (MAT-02)', () => {
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
      note: 'useful',
    });
    expect(target('/^https?:\\/\\/foo/')).toEqual({ type: 'regex', value: '^https?:\\/\\/foo' });
    expect(target('about:config')).toEqual({ type: 'path', value: 'about:config' });
    expect(target('file:///home/me/notes')).toEqual({ type: 'path', value: 'file:///home/me/notes' });
  });

  it('imports uBlock Origin, AdGuard, uBlacklist and hosts syntax (MAT-05)', () => {
    expect(target('||example.com^')).toEqual({ type: 'domain', value: 'example.com' });
    expect(target('||example.com/ads^$third-party')).toEqual({ type: 'path', value: 'example.com/ads' });
    expect(target('*://*.example.com/*')).toEqual({ type: 'domain', value: 'example.com' });
    expect(target('*://example.com/*')).toEqual({ type: 'host', value: 'example.com' });
    expect(target('0.0.0.0 tracker.example')).toEqual({ type: 'domain', value: 'tracker.example' });
    expect(parseTargetLine('127.0.0.1 localhost')).toEqual({ comment: true });
    expect(target('@@||ok.example^')).toEqual({ type: 'domain', value: 'ok.example', allow: true });
  });

  it('reports errors line by line', () => {
    const r = parseTargetList('youtube.com\n# comment\nhttp://\n*\n/(a+)+/');
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

  it('accepts LeechBlock space separated lists', () => {
    const r = parseTargetList('facebook.com +facebook.com/groups twitter.com');
    expect(r.targets.map((x) => x.value)).toEqual(['facebook.com', 'facebook.com/groups', 'twitter.com']);
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

describe('matching (MAT-01, MAT-03, MAT-07)', () => {
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

  it('matches internal pages, local files and reader mode', () => {
    expect(matches('about:addons', 'about:addons')).toBe(true);
    expect(matches('chrome://extensions', 'chrome://extensions/?id=x')).toBe(true);
    expect(matches('file:///home/me', 'file:///home/me/a.html')).toBe(true);
    expect(matches('example.com', 'about:reader?url=https%3A%2F%2Fexample.com%2Fa')).toBe(true);
    expect(matches('example.com', 'view-source:https://example.com/')).toBe(true);
  });

  it('SEM-06: exceptions of exceptions with ties won by blocks', () => {
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

describe('regular expression safety (SEC-03)', () => {
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
    ]) {
      const cp = compilePattern(t(line))!;
      expect(matchPattern(cp, parseUrl(representativeUrl(cp)!)!)).toBe(true);
    }
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
