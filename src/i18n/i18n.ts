/**
 * Translation layer (I18N-01…04, SET-02). Messages live in src/locales/<lang>.json using the
 * WebExtension JSON layout ({ key: { message, description } }) so that translation platforms
 * (Weblate, Crowdin) can show the description as context. English is the source language and is
 * bundled; other languages are loaded on demand and fall back to English key by key.
 */

import en from '../locales/en.json';
import { formatMessage, type Params } from './icu';

export type Messages = Record<string, { message: string; description?: string }>;

/** Languages shipped with the extension. Add a locale file and its code here to translate. */
export const AVAILABLE_LOCALES: { code: string; name: string; dir: 'ltr' | 'rtl' }[] = [
  { code: 'en', name: 'English', dir: 'ltr' },
];

const RTL = new Set(['ar', 'fa', 'he', 'ur']);

let current = 'en';
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

/** Loads the language chosen in the settings (or the browser's). */
export async function initI18n(setting = 'auto'): Promise<string> {
  const langs = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  const code = resolveLocale(setting, langs);
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
  }
  applyDocumentLocale();
  return current;
}

function applyDocumentLocale() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.documentElement.dir = textDirection();
}

export function locale(): string {
  return current;
}

export function textDirection(): 'ltr' | 'rtl' {
  return RTL.has(current.split('-')[0]) ? 'rtl' : 'ltr';
}

export function hasMessage(key: string): boolean {
  return key in messages || key in fallback;
}

/** Translates a key with ICU parameters. Unknown keys are returned as is (and caught by the i18n check). */
export function t(key: string, params?: Params): string {
  const m = messages[key]?.message ?? fallback[key]?.message;
  if (m === undefined) return key;
  return params || m.includes('{') ? formatMessage(m, params, current) : m;
}
