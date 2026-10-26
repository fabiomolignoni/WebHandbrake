import { describe, expect, it } from 'vitest';
import { pageRule, targetFor } from '../../src/engine/page-target';
import {
  displayHost,
  isExtensionUrl,
  pageKey,
  parseUrl,
  stripFragment,
  stripWww,
  toAsciiHost,
  unwrapUrl,
} from '../../src/engine/url';
import { newRuleRoute, routePage } from '../../src/shared/block-site';

describe('addresses', () => {
  it('view-source: and reader mode are unwrapped, so the page itself is evaluated', () => {
    expect(unwrapUrl(' view-source:https://a.test/x ')).toBe('https://a.test/x');
    expect(unwrapUrl('about:reader?url=https%3A%2F%2Fa.test%2Fstory')).toBe('https://a.test/story');
    expect(unwrapUrl('view-source:about:reader?url=https%3A%2F%2Fa.test%2F')).toBe('https://a.test/');
    // A broken escape is kept as it is.
    expect(unwrapUrl('about:reader?url=%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('parses the parts that matching needs, in lower case', () => {
    expect(parseUrl('HTTPS://WWW.Example.COM./Path/Page?Q=Value&x#Frag')).toEqual({
      href: 'HTTPS://WWW.Example.COM./Path/Page?Q=Value&x#Frag',
      scheme: 'https',
      web: true,
      host: 'www.example.com',
      path: '/path/page',
      query: [
        ['q', 'Value'],
        ['x', ''],
      ],
      fragment: 'Frag',
    });
    expect(parseUrl('about:config')).toMatchObject({ scheme: 'about', web: false, host: '', path: 'config' });
    expect(parseUrl('file:///home/me/Notes.txt')).toMatchObject({
      scheme: 'file',
      path: '/home/me/notes.txt',
    });
    expect(parseUrl('http://[::1]:8080/')).toMatchObject({ host: '[::1]', path: '/' });
    expect(parseUrl('not a url')).toBeNull();
  });

  it('one page key for http and https, www or not, with or without a trailing slash', () => {
    const key = 'https://example.com/a?b=1';
    for (const url of [
      'http://www.example.com/a/?b=1#top',
      'https://example.com/a?b=1',
      'HTTPS://Example.com/a/?b=1',
    ])
      expect(pageKey(url)).toBe(key);
    expect(pageKey('https://example.com/')).toBe('https://example.com/');
    expect(pageKey('about:addons')).toBe('about://addons');
    expect(pageKey('garbage#x')).toBe('garbage');
    expect(stripFragment('https://a.test/#x')).toBe('https://a.test/');
  });

  it('hosts: www., punycode, wildcards', () => {
    expect(stripWww('www.a.test')).toBe('a.test');
    expect(stripWww('wwwa.test')).toBe('wwwa.test');
    expect(toAsciiHost('Bücher.example.')).toBe('xn--bcher-kva.example');
    expect(toAsciiHost('*.bücher.example')).toBe('*.xn--bcher-kva.example');
    expect(toAsciiHost('  ')).toBeNull();
    expect(toAsciiHost('a b.test')).toBeNull();
  });

  it('extension pages and display hosts', () => {
    expect(isExtensionUrl('moz-extension://id/popup.html')).toBe(true);
    expect(isExtensionUrl('chrome-extension://id/x')).toBe(true);
    expect(isExtensionUrl('https://chrome-extension.test/')).toBe(false);
    expect(displayHost('https://www.a.test/x')).toBe('a.test');
    expect(displayHost('about:config')).toBe('about:config');
    expect(displayHost('nonsense')).toBe('nonsense');
  });
});

describe('"Block this site / page"', () => {
  const value = (url: string, g: Parameters<typeof targetFor>[1]) => {
    const x = targetFor(url, g);
    return x && [x.type, x.value];
  };

  it('the whole site, this host, this section or this page', () => {
    const url = 'https://www.news.test/world/europe/?id=4#comments';
    expect(value(url, 'domain')).toEqual(['domain', 'news.test']);
    expect(value(url, 'host')).toEqual(['host', 'news.test']);
    expect(value(url, 'path')).toEqual(['path', 'news.test/world/europe']);
    expect(value(url, 'page')).toEqual(['page', 'news.test/world/europe?id=4']);
  });

  it('a home page is the home page; a section of the root is the whole site', () => {
    expect(value('https://news.test/', 'page')).toEqual(['homepage', 'news.test']);
    expect(value('https://news.test/?id=1', 'page')).toEqual(['page', 'news.test/?id=1']);
    expect(value('https://news.test/', 'path')).toEqual(['domain', 'news.test']);
  });

  it('only web pages, each entry with its own id', () => {
    expect(targetFor('about:config', 'domain')).toBeNull();
    expect(targetFor('file:///x', 'page')).toBeNull();
    expect(targetFor('https://a.test/', 'domain')?.id).not.toBe(targetFor('https://a.test/', 'domain')?.id);
  });

  it('New rule… starts the rule editor with the entry, blocked at all times', () => {
    const r = pageRule('https://www.news.test/world/?id=4', 'path');
    expect(r?.targets.map((x) => [x.type, x.value, Boolean(x.allow)])).toEqual([
      ['path', 'news.test/world', false],
    ]);
    expect(r?.policies).toEqual([
      { id: expect.any(String), schedule: { mode: 'always', windows: [] }, intervention: { type: 'block' } },
    ]);
    expect(pageRule('about:config', 'domain')).toBeNull();
  });

  it('the route of the rule editor keeps the address whole', () => {
    const url = 'https://a.test/p?q=1&r=a b#top';
    const route = newRuleRoute(url, 'page');
    expect(route).toMatch(/^\/groups\/new\?/);
    // The router splits the hash at its first "?".
    expect(route.split('?')).toHaveLength(2);
    expect(route).not.toContain('#');
    const query = new URLSearchParams(route.split('?')[1]);
    expect(routePage(query)).toEqual({ url, granularity: 'page' });
    expect(routePage(new URLSearchParams({ url, granularity: 'everything' }))).toEqual({
      url,
      granularity: 'domain',
    });
    expect(routePage(new URLSearchParams({ template: 'social' }))).toBeNull();
  });
});
