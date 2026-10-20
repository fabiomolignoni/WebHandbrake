import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../../src/data/templates';
import { targetKey, targetsFromLines } from '../../src/engine/defaults';
import { compileDnr, type DnrRuleData } from '../../src/engine/dnr';
import {
  compilePattern,
  contentMatchPatterns,
  matchPattern,
  parseTargetLine,
  representativeUrl,
} from '../../src/engine/patterns';
import { parseUrl } from '../../src/engine/url';
import { at, BLOCK, config, ctx, group } from './helpers';

function compiled(line: string) {
  const parsed = parseTargetLine(line);
  if (!parsed?.target) throw new Error(`${line}: ${parsed?.error ?? 'a comment'}`);
  const cp = compilePattern({ id: line, ...parsed.target });
  if (!cp) throw new Error(`${line}: does not compile`);
  return cp;
}

function urlOf(line: string) {
  const rep = representativeUrl(compiled(line));
  const url = rep ? parseUrl(rep) : null;
  if (!url) throw new Error(`${line}: no representative address`);
  return url;
}

/** What the browser does with a page request: the action of the matching rule of highest priority. */
function browser(rules: DnrRuleData[], url: string): string {
  const host = new URL(url).hostname;
  const matching = rules.filter((r) => {
    const c = r.condition;
    if (!c.resourceTypes.includes('main_frame')) return false;
    if (c.requestDomains && !c.requestDomains.some((d) => host === d || host.endsWith(`.${d}`))) return false;
    return !c.regexFilter || new RegExp(c.regexFilter, 'i').test(url);
  });
  if (!matching.length) return 'none';
  return matching.reduce((a, b) => (b.priority > a.priority ? b : a)).action.type;
}

describe('the ready-made lists', () => {
  it('have distinct ids, and entries written as the editor writes them', () => {
    expect(new Set(TEMPLATES.map((x) => x.id)).size).toBe(TEMPLATES.length);
    for (const tpl of TEMPLATES) {
      for (const line of tpl.entries) {
        const parsed = parseTargetLine(line);
        expect(parsed?.target, `${tpl.id}: ${line}`).toBeDefined();
        // Lower case, without www. or a trailing slash: the line the editor shows.
        expect(targetKey(parsed!.target!), `${tpl.id}: ${line}`).toBe(line);
      }
      expect(targetsFromLines(tpl.entries)).toHaveLength(tpl.entries.length);
    }
  });

  it('list each site once: no duplicate, no entry that another one of the list covers', () => {
    for (const tpl of TEMPLATES) {
      expect(new Set(tpl.entries).size, tpl.id).toBe(tpl.entries.length);
      const blocks = tpl.entries.filter((l) => !l.startsWith('+'));
      for (const line of blocks) {
        const covering = blocks.filter(
          (other) => other !== line && matchPattern(compiled(other), urlOf(line)),
        );
        expect(covering, `${tpl.id}: ${line}`).toEqual([]);
      }
    }
  });

  it('have exceptions only inside their own sites', () => {
    for (const tpl of TEMPLATES) {
      const blocks = tpl.entries.filter((l) => !l.startsWith('+'));
      for (const line of tpl.entries.filter((l) => l.startsWith('+'))) {
        const url = urlOf(line);
        expect(
          blocks.some((b) => matchPattern(compiled(b), url)),
          `${tpl.id}: ${line}`,
        ).toBe(true);
      }
    }
  });

  it('put no site in two lists', () => {
    const seen = new Map<string, string>();
    for (const tpl of TEMPLATES)
      for (const line of tpl.entries.filter((l) => !l.startsWith('+'))) {
        expect(seen.get(line), line).toBeUndefined();
        seen.set(line, tpl.id);
      }
  });

  it('need neither the page script on every site nor a site name with *', () => {
    for (const tpl of TEMPLATES)
      for (const line of tpl.entries) {
        expect(line, tpl.id).not.toContain('*');
        expect(contentMatchPatterns(compiled(line)), `${tpl.id}: ${line}`).not.toContain('<all_urls>');
      }
  });

  it('become few browser filters, and leave the work sites around them open', () => {
    const groups = TEMPLATES.map((tpl) => group(tpl.id, tpl.entries, [{ intervention: BLOCK }]));
    const { rules, overflow } = compileDnr(ctx(config(groups), at(0, 10)), {
      interventionUrl: 'chrome-extension://id/intervention.html',
      hostAccess: true,
      limits: { regex: 1000, unsafe: 5000, total: 30000 },
    });
    expect(overflow).toEqual([]);
    // Plain sites share a few rules; only Amazon's stores (host only) and the sections are
    // regular expressions.
    expect(rules.filter((r) => r.condition.regexFilter).length).toBeLessThanOrEqual(40);
    for (const url of [
      'https://www.youtube.com/watch?v=1',
      'https://m.youtube.com/',
      'https://www.amazon.it/dp/B0',
      'https://amazon.co.uk/',
      'https://www.linkedin.com/feed/',
      'https://old.reddit.com/r/all',
      'https://it.pinterest.com/pin/1',
      'https://www.mercadolivre.com.br/',
      'https://www.nytimes.com/games/wordle/index.html',
    ])
      expect(browser(rules, url), url).toBe('redirect');
    for (const url of [
      'https://aws.amazon.com/console/',
      'https://console.aws.amazon.com/ec2',
      'https://sellercentral.amazon.it/home',
      'https://read.amazon.com/',
      'https://music.youtube.com/',
      'https://studio.youtube.com/',
      'https://business.facebook.com/latest',
      'https://www.linkedin.com/in/someone',
      'https://www.linkedin.com/jobs/',
      'https://discord.com/channels/1',
      'https://crazygames.it/',
      'https://amazon.example.com/',
    ])
      expect(browser(rules, url), url).not.toBe('redirect');
  });
});
