/**
 * Translation layer. Messages live in src/locales/<lang>.json using the
 * WebExtension JSON layout ({ key: { message, description } }) so that translation platforms
 * (Weblate, Crowdin) can show the description as context. English is the source language and is
 * bundled; other languages are loaded on demand and fall back to English key by key.
 */

import en from '../locales/en.json';
import { formatMessage, type Params, type ParamValue } from './icu';

export type Messages = Record<string, { message: string; description?: string }>;

/** Languages shipped with the extension. Add a locale file and its code here to translate. */
export const AVAILABLE_LOCALES: { code: string; name: string; dir: 'ltr' | 'rtl' }[] = [
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'it', name: 'Italiano', dir: 'ltr' },
];

const RTL = new Set(['ar', 'fa', 'he', 'ur']);

let current = 'en';
let regional = 'en';
let messages: Messages = en as Messages;
const fallback: Messages = en as Messages;

export function resolveLocale(setting: string, browserLanguages: readonly string[]): string {
  const codes = AVAILABLE_LOCALES.map((l) => l.code);
  if (setting && setting !== 'auto' && codes.includes(setting)) return setting;
  for (const lang of browserLanguages) {
    if (codes.includes(lang)) return lang;
    const base = lang.split('-')[0];
    if (codes.includes(base)) return base;
  }
  return 'en';
}

/**
 * The locale that formats dates, times and numbers: the first browser language in the interface
 * language, with its region ("en-GB" writes 17:00 and 12 Oct where "en" writes 5:00 PM and Oct 12),
 * else the interface language.
 */
export function resolveRegional(code: string, browserLanguages: readonly string[]): string {
  const base = code.split('-')[0];
  for (const lang of browserLanguages) {
    if (lang.split('-')[0] !== base) continue;
    try {
      return Intl.getCanonicalLocales(lang)[0];
    } catch {
      // Not a valid language tag: the next one.
    }
  }
  return code;
}

/** Loads the language chosen in the settings (or the browser's). */
export async function initI18n(setting = 'auto'): Promise<string> {
  const langs = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  const code = resolveLocale(setting, langs);
  regional = resolveRegional(code, langs);
  if (code === current) return code;
  if (code === 'en') {
    current = 'en';
    messages = fallback;
    applyDocumentLocale();
    return code;
  }
  try {
    const g = globalThis as unknown as { browser?: typeof chrome; chrome?: typeof chrome };
    const api = g.browser ?? g.chrome;
    const url = api?.runtime?.getURL(`locales/${code}.json`) ?? `locales/${code}.json`;
    const res = await fetch(url);
    messages = (await res.json()) as Messages;
    current = code;
  } catch {
    messages = fallback;
    current = 'en';
    regional = resolveRegional('en', langs);
  }
  applyDocumentLocale();
  return current;
}

function applyDocumentLocale() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.documentElement.dir = textDirection();
}

/** The interface language, such as "en" or "pt-BR". */
export function locale(): string {
  return current;
}

/** The locale of formatted dates, times and numbers, such as "en-GB" (see resolveRegional). */
export function formatLocale(): string {
  return regional;
}

export function textDirection(): 'ltr' | 'rtl' {
  return RTL.has(current.split('-')[0]) ? 'rtl' : 'ltr';
}

/** The message of a key with its placeholders, for a context that formats it later (the overlay). */
export function template(key: string): string {
  return messages[key]?.message ?? fallback[key]?.message ?? key;
}

/** Translates a key with ICU parameters. Unknown keys are returned as is (and caught by the i18n check). */
export function t(key: string, params?: Params): string {
  const m = messages[key]?.message ?? fallback[key]?.message;
  if (m === undefined) return key;
  return params || m.includes('{') ? formatMessage(m, params, regional) : m;
}

/**
 * Translates a key whose placeholders may hold elements, such as the fields of a sentence
 * ("Between {shortest} and {longest}"): the text and those elements in the order of the language,
 * so that a translation can put the fields where its sentence needs them.
 */
export function parts<T extends object>(key: string, params: Record<string, ParamValue | T>): (string | T)[] {
  const elements: T[] = [];
  const text: Params = {};
  for (const [name, v] of Object.entries(params)) {
    if (v !== null && typeof v === 'object') {
      text[name] = `${elements.length}`;
      elements.push(v);
    } else text[name] = v;
  }
  return t(key, text)
    .split(/(\d+)/)
    .map((s, i) => (i % 2 ? elements[Number(s)] : s))
    .filter((s) => s !== '');
}
