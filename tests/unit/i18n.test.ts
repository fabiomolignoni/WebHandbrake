import { describe, expect, it } from 'vitest';
import {
  AVAILABLE_LOCALES,
  formatLocale,
  initI18n,
  locale,
  parts,
  resolveLocale,
  resolveRegional,
  t,
  template,
  textDirection,
} from '../../src/i18n/i18n';
import { formatMessage, formatNumber, parse } from '../../src/i18n/icu';
import en from '../../src/locales/en.json';

describe('ICU messages', () => {
  it('arguments and numbers', () => {
    expect(formatMessage('Hello {name}!', { name: 'Ada' })).toBe('Hello Ada!');
    expect(formatMessage('{n} items', { n: 1234.56 })).toBe('1,234.6 items');
    expect(formatMessage('{n, number} items', { n: 2 }, 'it')).toBe('2 items');
    expect(formatMessage('{missing}|{empty}', { empty: null })).toBe('|');
    expect(formatNumber(1234.5, 'it')).toBe('1234,5');
  });

  it('plurals with exact values, categories, # and an offset', () => {
    const m = '{count, plural, =0 {no sites} one {# site} other {# sites}}';
    expect(formatMessage(m, { count: 0 })).toBe('no sites');
    expect(formatMessage(m, { count: 1 })).toBe('1 site');
    expect(formatMessage(m, { count: 1200 })).toBe('1,200 sites');
    const offset =
      '{n, plural, offset:1 =0 {nobody} =1 {you} one {you and # other} other {you and # others}}';
    expect(formatMessage(offset, { n: 1 })).toBe('you');
    expect(formatMessage(offset, { n: 2 })).toBe('you and 1 other');
    expect(formatMessage(offset, { n: 4 })).toBe('you and 3 others');
    // Missing values count as zero.
    expect(formatMessage(m, {})).toBe('no sites');
  });

  it('select, nested in a plural', () => {
    const m = '{kind, select, site {{n, plural, one {# site} other {# sites}}} other {{n} things}}';
    expect(formatMessage(m, { kind: 'site', n: 2 })).toBe('2 sites');
    expect(formatMessage(m, { kind: 'x', n: 2 })).toBe('2 things');
  });

  it('apostrophes quote syntax characters', () => {
    expect(formatMessage("It''s '{literal}' {x}", { x: 1 })).toBe("It's {literal} 1");
    expect(formatMessage("{n, plural, other {'#' is # ok}}", { n: 3 })).toBe('# is 3 ok');
    expect(formatMessage("Don't")).toBe("Don't");
  });

  it('a broken message is shown as it is rather than failing', () => {
    expect(formatMessage('{n, plural one {x}}', { n: 1 })).toBe('{n, plural one {x}}');
    // Parsed messages are cached.
    expect(parse('a {b} c')).toBe(parse('a {b} c'));
  });

  it('every English message parses', () => {
    for (const [key, { message }] of Object.entries(en as Record<string, { message: string }>))
      expect(() => parse(message), key).not.toThrow();
  });
});

describe('translation', () => {
  it('the language of the settings, else of the browser, else English', () => {
    expect(AVAILABLE_LOCALES.map((l) => l.code)).toContain('en');
    expect(resolveLocale('en', ['it'])).toBe('en');
    expect(resolveLocale('auto', ['xx-YY', 'en-GB'])).toBe('en');
    expect(resolveLocale('xx', ['yy'])).toBe('en');
  });

  it('dates, times and numbers follow the region of a browser language in the interface language', () => {
    expect(resolveRegional('en', ['it-IT', 'en-GB', 'en-US'])).toBe('en-GB');
    expect(resolveRegional('pt-BR', ['pt-br'])).toBe('pt-BR');
    // No browser language in the interface language, or not a valid tag: the language alone.
    expect(resolveRegional('en', ['it-IT'])).toBe('en');
    expect(resolveRegional('en', ['en-!!', 'en-AU'])).toBe('en-AU');
  });

  it('parts: the elements of a sentence come back where the message puts them', () => {
    const shortest = { field: 'shortest' };
    const longest = { field: 'longest' };
    expect(parts('delay.rangeFields', { shortest, longest })).toEqual([
      'Between ',
      shortest,
      ' and ',
      longest,
    ]);
    expect(parts('targets.guide.more', { help: longest })).toEqual([
      'More ways to write an address are in ',
      longest,
      '.',
    ]);
  });

  it('translates keys with parameters; unknown keys come back as they are', async () => {
    expect(await initI18n('auto')).toBe('en');
    expect(locale()).toBe('en');
    expect(formatLocale()).toMatch(/^en/);
    expect(textDirection()).toBe('ltr');
    expect(t('groups.title')).toBe('Rules');
    expect(t('groups.sites', { count: 3 })).toMatch(/3/);
    expect(t('no.such.key')).toBe('no.such.key');
    // Templates keep their placeholders, for the overlay to fill in.
    expect(template('overlay.timerLeft')).toContain('{');
    expect(template('no.such.key')).toBe('no.such.key');
  });
});
