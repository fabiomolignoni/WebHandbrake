/**
 * The examples of the address syntax table in Help (SYNTAX in src/dashboard/help-content.ts) do
 * what their meaning says: each one is parsed and matched by the engine against the addresses
 * below. A new example needs an entry here.
 */

import { describe, expect, it } from 'vitest';
import { SYNTAX } from '../../src/dashboard/help-content';
import { decide } from '../../src/engine/decide';
import { compilePattern, matchPattern, parseTargetLine, parseTargetList } from '../../src/engine/patterns';
import type { Target } from '../../src/engine/types';
import { parseUrl } from '../../src/engine/url';
import { BLOCK, config, ctx, group } from './helpers';

type Expectation =
  /** Addresses the entry must and must not match (the engine's parser and matcher). */
  | { match: string[]; noMatch: string[] }
  /** A comment line, and an entry followed by a note. */
  | { comment: true }
  /** An exception in a rule that blocks the site, checked with the engine's decision. */
  | { exception: { blocked: string; allowed: string[]; stillBlocked: string[] } }
  /** Formats of other tools, separated by "·": each converts to the same entry. */
  | { imports: Omit<Target, 'id'> };

const EXPECTATIONS: Record<string, Expectation> = {
  'youtube.com': {
    match: ['https://youtube.com/', 'https://www.youtube.com/watch?v=1', 'https://m.youtube.com/'],
    noMatch: ['https://notyoutube.com/', 'https://youtube.com.example/'],
  },
  'amazon.*': {
    match: ['https://amazon.com/', 'https://www.amazon.it/dp/1', 'https://amazon.co.uk/'],
    noMatch: ['https://amazonia.com/', 'https://shop.example/amazon.com'],
  },
  '=m.youtube.com': {
    match: ['https://m.youtube.com/watch?v=1', 'https://www.m.youtube.com/'],
    noMatch: ['https://youtube.com/', 'https://www.youtube.com/', 'https://music.youtube.com/'],
  },
  'reddit.com/r/funny': {
    match: ['https://reddit.com/r/funny', 'https://www.reddit.com/r/funny/comments/1/x'],
    noMatch: ['https://reddit.com/r/funnyvideos', 'https://reddit.com/r/rust', 'https://reddit.com/'],
  },
  'example.com/page$': {
    match: ['https://example.com/page'],
    noMatch: ['https://example.com/page/more', 'https://example.com/', 'https://example.com/pages'],
  },
  'example.com/$': {
    match: ['https://example.com/', 'https://www.example.com/'],
    noMatch: ['https://example.com/about'],
  },
  'reddit.com/r/*/comments/*': {
    match: ['https://reddit.com/r/rust/comments/abc', 'https://reddit.com/r/funny/comments/1/title'],
    noMatch: ['https://reddit.com/r/rust', 'https://reddit.com/r/rust/hot/comments/abc'],
  },
  'news.*/sport/**': {
    match: ['https://news.com/sport/football/today', 'https://news.co.uk/sport/x'],
    noMatch: ['https://news.com/politics', 'https://news.com/'],
  },
  'youtube.com/watch?list=*': {
    match: ['https://youtube.com/watch?v=1&list=PL1', 'https://youtube.com/watch?list=x'],
    noMatch: ['https://youtube.com/watch?v=1', 'https://youtube.com/'],
  },
  '+reddit.com/r/rust': {
    exception: {
      blocked: 'reddit.com',
      allowed: ['https://reddit.com/r/rust', 'https://www.reddit.com/r/rust/comments/1'],
      stillBlocked: ['https://reddit.com/r/funny', 'https://reddit.com/'],
    },
  },
  // A regular expression: the parser accepts it in every mode; the editor offers it in advanced mode.
  '/^https?:\\/\\/(www\\.)?example\\.com\\/a+$/': {
    match: ['https://example.com/aaa', 'http://www.example.com/a'],
    noMatch: ['https://example.com/ab', 'https://sub.example.com/a'],
  },
  '# comment': { comment: true },
  '||example.com^  ·  *://*.example.com/*': { imports: { type: 'domain', value: 'example.com' } },
};

function compiled(entry: string) {
  const line = parseTargetLine(entry);
  if (!line?.target) throw new Error(`help example '${entry}' does not parse: ${line?.error}`);
  const cp = compilePattern({ id: 'x', ...line.target });
  if (!cp) throw new Error(`help example '${entry}' does not compile`);
  return cp;
}

function matches(entry: string, url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) throw new Error(`not a URL: ${url}`);
  return matchPattern(compiled(entry), parsed);
}

describe('the address syntax examples of Help do what their meaning says', () => {
  it('every example has expectations, and every expectation is an example', () => {
    const entries = SYNTAX.map(([entry]) => entry);
    for (const entry of entries)
      expect(
        EXPECTATIONS[entry],
        `help example '${entry}' has no expectations: add it to this test.`,
      ).toBeDefined();
    for (const entry of Object.keys(EXPECTATIONS))
      expect(entries, `'${entry}' is not an example of SYNTAX any more: remove it from this test.`).toContain(
        entry,
      );
  });

  for (const [entry] of SYNTAX) {
    const e = EXPECTATIONS[entry];
    if (!e) continue;
    it(`'${entry}'`, () => {
      if ('match' in e) {
        for (const url of e.match)
          expect(matches(entry, url), `help example '${entry}' did not match ${url}`).toBe(true);
        for (const url of e.noMatch)
          expect(matches(entry, url), `help example '${entry}' matched ${url}`).toBe(false);
      } else if ('comment' in e) {
        expect(parseTargetLine(entry)).toEqual({ comment: true });
        expect(parseTargetLine('example.com  # note')?.target).toEqual({
          type: 'domain',
          value: 'example.com',
          note: 'note',
        });
      } else if ('exception' in e) {
        const { blocked, allowed, stillBlocked } = e.exception;
        const c = ctx(config([group('Rule', [blocked, entry], [{ intervention: BLOCK }])]), Date.now());
        for (const url of allowed)
          expect(decide(c, url).intervention.type, `help example '${entry}' did not allow ${url}`).not.toBe(
            'block',
          );
        for (const url of stillBlocked)
          expect(decide(c, url).intervention.type, `help example '${entry}' allowed ${url}`).toBe('block');
      } else {
        const formats = entry.split('·').map((s) => s.trim());
        expect(formats.length).toBeGreaterThan(1);
        for (const f of formats) {
          const { targets, errors } = parseTargetList(f);
          expect(errors, `help example '${f}' does not convert`).toEqual([]);
          expect(targets.map(({ type, value }) => ({ type, value }))).toEqual([e.imports]);
        }
      }
    });
  }
});
