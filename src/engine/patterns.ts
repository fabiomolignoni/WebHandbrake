/**
 * Targets: text syntax, normalisation, matching, specificity,
 * DNR regular expressions and content script match patterns.
 *
 * Text syntax (one entry per line, used for bulk paste, sharing and import):
 *
 *   youtube.com                 domain and all subdomains
 *   =m.youtube.com              this host only
 *   reddit.com/r/funny          this path and everything below it
 *   example.com/page$           this exact page
 *   example.com/$               home page only
 *   reddit.com/r/*\/comments/**  wildcards: * inside a segment or label, ** across segments
 *   youtube.com/watch?list=*    query parameters that must be present
 *   *news*                      every address that contains "news" (no site name: the whole address)
 *   *                           every website (also *.*, *://*\/* and <all_urls>)
 *   /^https?:\/\/.*\.example\// regular expression (advanced)
 *   +reddit.com/r/rust          exception ("allow")
 *   # comment                   comment line;  "entry  # note" adds a note
 *
 * Imported forms are also accepted: ||example.com^ (uBlock Origin / AdGuard),
 * *://*.example.com/* (uBlacklist / match patterns), hosts file lines, full URLs.
 */

import { MAX_REGEX_LENGTH } from './limits';
import type { Target, TargetType } from './types';
import { type ParsedUrl, stripWww, toAsciiHost } from './url';

export interface ParsedLine {
  target?: Omit<Target, 'id'>;
  /** i18n key of the error (errors reported line by line). */
  error?: string;
  comment?: boolean;
}

const INTERNAL_SCHEMES = ['about', 'chrome', 'edge', 'opera', 'brave', 'vivaldi', 'moz-extension'];
/** The entry that covers every website (#20). */
export const ALL_SITES = '*';
const HOST_RE = /^(\*|[a-z0-9_*-]+)(\.(\*|[a-z0-9_*-]+))*$/;
const IPV6_RE = /^\[[0-9a-f:.]+\]$/;

/** Parses one line of the text syntax. Returns null for blank lines. */
export function parseTargetLine(line: string): ParsedLine | null {
  let raw = line.trim();
  if (!raw) return null;
  // "[Adblock Plus 2.0]" headers are comments; "[::1]" is an IPv6 address.
  if (raw.startsWith('#') || raw.startsWith('!') || (raw.startsWith('[') && !/^\[[0-9a-f:.]+\]/i.test(raw)))
    return { comment: true };

  let note: string | undefined;
  const noteAt = raw.search(/\s#/);
  if (noteAt !== -1) {
    note = raw
      .slice(noteAt)
      .replace(/^\s*#\s*/, '')
      .trim();
    raw = raw.slice(0, noteAt).trim();
    if (!note) note = undefined;
  }

  let allow = false;
  if (raw.startsWith('@@')) {
    allow = true;
    raw = raw.slice(2);
  } else if (raw.startsWith('+')) {
    allow = true;
    raw = raw.slice(1).trim();
  }
  if (!raw) return { error: 'targets.error.empty' };

  const done = (t: Omit<Target, 'id' | 'allow' | 'note'> | { error: string }): ParsedLine => {
    if ('error' in t) return { error: t.error };
    const target: Omit<Target, 'id'> = { ...t };
    if (allow) target.allow = true;
    if (note) target.note = note;
    return { target };
  };

  // Every website, as match patterns write it (#20).
  if (raw.toLowerCase() === '<all_urls>') return done({ type: 'wildcard', value: ALL_SITES });

  // Regular expression: /.../
  const re = /^\/(.+)\/(i?)$/.exec(raw);
  if (re) {
    const err = checkRegex(re[1]);
    return done(err ? { error: err } : { type: 'regex', value: re[1] });
  }

  // hosts file: "0.0.0.0 example.com"
  const hosts = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?|::)\s+(\S+)/.exec(raw);
  if (hosts) {
    if (/^(localhost|localhost\.localdomain|local|broadcasthost|ip6-\w+|0\.0\.0\.0)$/i.test(hosts[1])) {
      return { comment: true };
    }
    raw = hosts[1];
  }

  // uBlock Origin / AdGuard network filter: ||example.com^ , ||example.com/path
  if (raw.startsWith('||')) {
    raw = raw.slice(2).replace(/\$.*$/, '');
    raw = raw.replace(/\^\|?$/, '').replace(/\^/g, '/');
  } else if (raw.startsWith('|') && !raw.startsWith('||')) {
    raw = raw.slice(1).replace(/\|$/, '');
  }

  // Match patterns / uBlacklist: *://*.example.com/*
  const mp = /^(\*|https?):\/\/(\*\.)?([^/]+)(\/.*)?$/i.exec(raw);
  if (mp && (mp[1] === '*' || mp[2] || (mp[4] ?? '').endsWith('*'))) {
    const sub = Boolean(mp[2]);
    const host = mp[3];
    let path = mp[4] ?? '/*';
    if (path === '/*' || path === '/' || path === '') path = '';
    else path = path.replace(/\*$/, '');
    if (host === '*') return done(addressWildcard(path ? `*${path}*` : ALL_SITES));
    if (!path) return done(parseHostPath(sub ? host : `=${host}`, false));
    return done(parseHostPath(`${host}${path}`, false));
  }

  // Exact page marker
  let exact = false;
  if (raw.endsWith('$')) {
    exact = true;
    raw = raw.slice(0, -1);
  }

  // Schemes
  const scheme = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(raw);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s === 'http' || s === 'https') {
      raw = raw.slice(scheme[0].length);
    } else if (s === 'file') {
      const path = normalisePath(raw.slice(scheme[0].length).replace(/^\/*/, '/'));
      if (path === null) return { error: 'targets.error.invalid' };
      return done({ type: exact ? 'page' : 'path', value: `file://${path || '/'}` });
    } else if (INTERNAL_SCHEMES.includes(s)) {
      const value = raw
        .toLowerCase()
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '');
      return done({ type: exact ? 'page' : 'path', value });
    } else if (!/^[a-z0-9.-]+$/i.test(s) || raw.slice(scheme[0].length).startsWith('/')) {
      return { error: 'targets.error.scheme' };
    }
  }
  return done(parseHostPath(raw, exact));
}

function parseHostPath(
  input: string,
  exact: boolean,
): Omit<Target, 'id' | 'allow' | 'note'> | { error: string } {
  let raw = input.replace(/^\/\//, '');
  let hostOnly = false;
  if (raw.startsWith('=')) {
    hostOnly = true;
    raw = raw.slice(1);
  }
  const cut = raw.search(/[/?#]/);
  let hostPart = cut === -1 ? raw : raw.slice(0, cut);
  let rest = cut === -1 ? '' : raw.slice(cut);
  // userinfo and port
  hostPart = hostPart.replace(/^[^@]*@/, '');
  if (!IPV6_RE.test(hostPart)) hostPart = hostPart.replace(/:\d*$/, '');
  // #20, #23: without a site name ("*news*", "*", "*.*"), the entry is matched against the whole
  // address.
  const bare = hostPart.replace(/^www\./i, '');
  if (bare.includes('*') && (!bare.includes('.') || /^\*(\.\*)*$/.test(bare)))
    return addressWildcard(`${/^\*(\.\*)*$/.test(bare) ? '*' : bare}${rest}`);
  let host = IPV6_RE.test(hostPart) ? hostPart.toLowerCase() : toAsciiHost(hostPart);
  if (!host) return { error: 'targets.error.invalid' };
  if (!IPV6_RE.test(host)) {
    if (!HOST_RE.test(host)) return { error: 'targets.error.invalid' };
    if (host.startsWith('www.') && host.length > 4) host = host.slice(4);
    // A word without a dot is not a site ("not a site" pasted from a text), except localhost and IPs.
    if (!host.includes('.') && host !== 'localhost') return { error: 'targets.error.noDot' };
  }

  let fragment = '';
  const hashAt = rest.indexOf('#');
  if (hashAt !== -1) {
    fragment = rest.slice(hashAt + 1);
    rest = rest.slice(0, hashAt);
  }
  let query = '';
  const qAt = rest.indexOf('?');
  if (qAt !== -1) {
    query = normaliseQuery(rest.slice(qAt + 1));
    rest = rest.slice(0, qAt);
  }
  const path = normalisePath(rest);
  if (path === null) return { error: 'targets.error.invalid' };

  const tail = `${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`;
  if (exact) {
    if (!path && !query && !fragment) return { type: 'homepage', value: host };
    return { type: 'page', value: `${host}${path || '/'}${tail}` };
  }
  if (path || tail) return { type: 'path', value: `${host}${path}${tail}` };
  return { type: hostOnly ? 'host' : 'domain', value: host };
}

/**
 * An address wildcard (#23): lower case, without a fragment, a leading www. or trailing slashes,
 * and with runs of * merged. "*", "*\/*" and the like cover every website (#20).
 */
function addressWildcard(input: string): Omit<Target, 'id' | 'allow' | 'note'> | { error: string } {
  const value = input
    .toLowerCase()
    .replace(/#.*$/, '')
    .replace(/^www\./, '')
    .replace(/\*{2,}/g, '*')
    .replace(/(.)\/+$/, '$1');
  if (/\s/.test(value)) return { error: 'targets.error.invalid' };
  return { type: 'wildcard', value: /^\*(\/\*)?$/.test(value) ? ALL_SITES : value };
}

/** Normalises a path: lower case, percent encoded, no duplicate or trailing slashes. '' for the root. */
export function normalisePath(path: string): string | null {
  if (!path || path === '/') return '';
  let p = path.startsWith('/') ? path : `/${path}`;
  p = p.replace(/\/{2,}/g, '/');
  try {
    // Encode like browsers do (spaces, unicode) while keeping * wildcards.
    p = new URL(`http://x${p}`).pathname;
  } catch {
    return null;
  }
  p = p.toLowerCase().replace(/%2a/g, '*');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p === '/' ? '' : p;
}

function normaliseQuery(q: string): string {
  return q
    .split(/[&;]/)
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      const k = (i === -1 ? pair : pair.slice(0, i)).toLowerCase();
      const v = i === -1 ? '*' : pair.slice(i + 1);
      return `${k}=${v}`;
    })
    .join('&');
}

/** Serialises a target back to the text syntax. */
export function targetToLine(t: Pick<Target, 'type' | 'value' | 'allow' | 'note'>): string {
  let s: string;
  switch (t.type) {
    case 'host':
      s = `=${t.value}`;
      break;
    case 'page':
      s = `${t.value}$`;
      break;
    case 'homepage':
      s = `${t.value}/$`;
      break;
    case 'regex':
      s = `/${t.value}/`;
      break;
    default:
      s = t.value;
  }
  if (t.allow) s = `+${s}`;
  if (t.note) s += `  # ${t.note}`;
  return s;
}

/** Parses a multi-line list. Errors are reported with their 1-based line number. */
export function parseTargetList(text: string): {
  targets: Omit<Target, 'id'>[];
  errors: { line: number; text: string; error: string }[];
} {
  const targets: Omit<Target, 'id'>[] = [];
  const errors: { line: number; text: string; error: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    // "+ example.com" is one exception, not a lone "+" followed by a blocking entry.
    const line = raw.replace(/^(\s*)(\+|@@)\s+/, '$1$2');
    // Several sites can be pasted on one line separated by spaces; hosts-file lines
    // ("0.0.0.0 example.com"), regular expressions and commented lines are kept whole.
    const whole =
      /\s#/.test(line) ||
      /^\s*[#![]/.test(line) ||
      /^\s*(?:0\.0\.0\.0|127\.0\.0\.1|::1?|::)\s/.test(line) ||
      /^\s*\+?\//.test(line);
    const parts = whole ? [line] : line.trim().split(/\s+/);
    const failed: { line: number; text: string; error: string }[] = [];
    let added = 0;
    for (const part of parts) {
      const r = parseTargetLine(part);
      if (!r || r.comment) continue;
      if (r.error) failed.push({ line: i + 1, text: part.trim(), error: r.error });
      else if (r.target) {
        targets.push(r.target);
        added++;
      }
    }
    // A line of words that are not sites (a sentence) is one error, not one per word.
    if (failed.length > 1 && !added) errors.push({ ...failed[0], text: line.trim() });
    else errors.push(...failed);
  });
  return { targets, errors };
}

// ---------------------------------------------------------------------------
// Regular expression safety
// ---------------------------------------------------------------------------

/** Returns an i18n error key when the expression is unsafe or invalid, null otherwise. */
export function checkRegex(src: string): string | null {
  if (src.length > MAX_REGEX_LENGTH) return 'targets.error.regexTooLong';
  if (/\\[1-9]|\\k</.test(src)) return 'targets.error.regexBackref';
  if (/\(\?<?[=!]/.test(src)) return 'targets.error.regexLookaround';
  if (hasNestedQuantifier(src) || hasRepeatedAlternation(src)) return 'targets.error.regexNested';
  // Each open-ended repetition multiplies the work on a long address: two are enough when the
  // expression is anchored at the start, one when the engine has to try every position.
  if (unboundedRepetitions(src) > (src.startsWith('^') ? 2 : 1)) return 'targets.error.regexComplex';
  try {
    new RegExp(src, 'i');
  } catch {
    return 'targets.error.regexInvalid';
  }
  return null;
}

/** Whether the text at `at` is a repetition without an upper bound: *, +, {n,} or a wide {n,m}. */
function unboundedAt(src: string, at: number): boolean {
  const c = src[at];
  if (c === '*' || c === '+') return true;
  const m = c === '{' ? /^\{(\d*),(\d*)\}/.exec(src.slice(at)) : null;
  return Boolean(m && (m[2] === '' || Number(m[2]) - Number(m[1] || 0) > 64));
}

/** Calls `visit` for every character outside escapes and character classes. */
function eachSyntax(src: string, visit: (c: string, i: number) => boolean | undefined): boolean {
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (visit(c, i)) return true;
  }
  return false;
}

/** The open-ended repetitions of an expression. */
function unboundedRepetitions(src: string): number {
  let n = 0;
  eachSyntax(src, (_, i) => {
    if (unboundedAt(src, i)) n++;
    return false;
  });
  return n;
}

/** Detects groups with alternatives repeated without limit, e.g. (a|ab)*, which can be exponential. */
function hasRepeatedAlternation(src: string): boolean {
  const stack: boolean[] = [];
  return eachSyntax(src, (c, i) => {
    if (c === '(') stack.push(false);
    else if (c === '|' && stack.length) stack[stack.length - 1] = true;
    else if (c === ')') {
      const alt = stack.pop();
      if (alt && unboundedAt(src, i + 1)) return true;
    }
    return false;
  });
}

/** Detects quantified groups that contain unbounded quantifiers, e.g. (a+)+ or (.*)*. */
function hasNestedQuantifier(src: string): boolean {
  // *, + or {n,} at a position.
  const openEnded = (at: number) =>
    src[at] === '*' || src[at] === '+' || (src[at] === '{' && /^\{\d*,\}/.test(src.slice(at)));
  // For each open group: whether it contains an unbounded quantifier.
  const stack: boolean[] = [];
  return eachSyntax(src, (c, i) => {
    if (c === '(') stack.push(false);
    else if (c === ')') {
      if (!stack.length) return false;
      const inner = stack.pop();
      const repeated = openEnded(i + 1);
      if (inner && repeated) return true;
      if ((inner || repeated) && stack.length) stack[stack.length - 1] = true;
    } else if (openEnded(i) && stack.length) stack[stack.length - 1] = true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Compiled patterns and matching
// ---------------------------------------------------------------------------

export interface QueryConstraint {
  k: string;
  v: string;
  re: Wildcard | null;
}

export interface CompiledPattern {
  target: Target;
  /** Canonical identity, independent of id, allow and note. */
  key: string;
  allow: boolean;
  type: TargetType;
  /** 'web' (http/https), 'file', or an internal scheme. */
  scheme: string;
  /** Literal host without www. ('' when wildcard or not web). */
  host: string;
  hostRe: RegExp | null;
  subdomains: boolean;
  pathMode: 'any' | 'prefix' | 'exact' | 'home';
  path: string;
  pathRe: Wildcard | null;
  query: QueryConstraint[];
  fragment: string | null;
  regex: RegExp | null;
  /** Address wildcards (#23): matched against addressOf() of a web URL. */
  address: Wildcard | null;
  /** Internal pages: prefix of the URL. */
  internal: string | null;
  spec: number;
  /** Specificity components, for explanations. */
  specParts: [number, number, number, number];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function wildToRe(s: string, star: string, doubleStar: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '*') {
      if (s[i + 1] === '*') {
        out += doubleStar;
        i++;
      } else out += star;
    } else out += escapeRe(s[i]);
  }
  return out;
}

/**
 * A wildcard pattern matched in linear time: `*` stands for any characters but
 * "/" when `segment` is set, `**` (or any `*` otherwise) for any characters. The engine never runs
 * a backtracking regular expression for wildcards, so a pattern such as *a*a*a* cannot freeze it.
 */
export class Wildcard {
  private readonly tokens: (string | 'seg' | 'any')[] = [];
  private readonly mode: 'full' | 'exact' | 'prefix';
  constructor(pattern: string, segment: boolean, mode: 'full' | 'exact' | 'prefix' = 'full') {
    this.mode = mode;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] !== '*') {
        this.tokens.push(pattern[i]);
        continue;
      }
      const double = pattern[i + 1] === '*';
      if (double) i++;
      const t = double || !segment ? 'any' : 'seg';
      const last = this.tokens[this.tokens.length - 1];
      // Consecutive stars are one star (the widest of them).
      if (last === 'any' || last === 'seg') this.tokens[this.tokens.length - 1] = last === 'any' ? 'any' : t;
      else this.tokens.push(t);
    }
  }

  /** Which prefixes of the text the whole pattern matches: one pass per token over the text. */
  private prefixes(text: string): boolean[] {
    const n = text.length;
    let cur = new Array<boolean>(n + 1).fill(false);
    cur[0] = true;
    for (const tok of this.tokens) {
      const next = new Array<boolean>(n + 1).fill(false);
      if (tok === 'any' || tok === 'seg') {
        let open = false;
        for (let j = 0; j <= n; j++) {
          if (tok === 'seg' && j > 0 && text[j - 1] === '/') open = false;
          open ||= cur[j];
          next[j] = open;
        }
      } else {
        for (let j = 0; j < n; j++) if (cur[j] && text[j] === tok) next[j + 1] = true;
      }
      cur = next;
      if (!cur.includes(true)) break;
    }
    return cur;
  }

  test(text: string): boolean {
    const ok = this.prefixes(text);
    const n = text.length;
    if (ok[n]) return true;
    // A path matches with a trailing slash, or (as a section) followed by more segments.
    if (this.mode === 'exact') return n > 0 && text[n - 1] === '/' && ok[n - 1];
    if (this.mode === 'prefix') for (let j = 0; j < n; j++) if (text[j] === '/' && ok[j]) return true;
    return false;
  }
}

const LABEL = '[a-z0-9_-]';

function hostToRe(host: string): string {
  return host
    .split('.')
    .map((label) =>
      label === '*'
        ? `${LABEL}+(?:\\.${LABEL}+)*`
        : label.includes('*')
          ? wildToRe(label, `${LABEL}*`, `${LABEL}*`)
          : escapeRe(label),
    )
    .join('\\.');
}

export function specificity(parts: [number, number, number, number]): number {
  const [h, p, q, k] = parts;
  return Math.min(h, 99) * 1_000_000 + Math.min(p, 99) * 10_000 + Math.min(q, 99) * 100 + k;
}

export function compilePattern(target: Target): CompiledPattern | null {
  const base = {
    target,
    key: `${target.type}|${target.value}`,
    allow: Boolean(target.allow),
    type: target.type,
    scheme: 'web',
    host: '',
    hostRe: null,
    subdomains: true,
    pathMode: 'any' as CompiledPattern['pathMode'],
    path: '',
    pathRe: null,
    query: [] as QueryConstraint[],
    fragment: null as string | null,
    regex: null as RegExp | null,
    address: null as Wildcard | null,
    internal: null as string | null,
  };

  if (target.type === 'wildcard') {
    // An entry without a site name comes after every entry with one; among them, more
    // literal characters are more specific, and every website comes last.
    const literal = target.value.replace(/\*/g, '').length;
    const parts: [number, number, number, number] = [0, literal, 0, literal ? 1 : 0];
    return {
      ...base,
      address: new Wildcard(target.value, false),
      spec: specificity(parts),
      specParts: parts,
    };
  }

  if (target.type === 'regex') {
    if (checkRegex(target.value)) return null;
    // Regular expressions have minimal specificity; exceptions written as regular
    // expressions win within their group, so a broad pattern can carve out a narrow exception.
    const parts: [number, number, number, number] = target.allow ? [99, 99, 99, 9] : [0, 0, 0, 0];
    return {
      ...base,
      scheme: '*',
      regex: new RegExp(target.value, 'i'),
      spec: specificity(parts),
      specParts: parts,
    };
  }

  const value = target.value;
  const internal = /^([a-z][a-z0-9+.-]*):/.exec(value);
  if (internal) {
    if (INTERNAL_SCHEMES.includes(internal[1])) {
      const parts: [number, number, number, number] = [
        1,
        value.split('/').filter(Boolean).length,
        0,
        target.type === 'page' ? 3 : 2,
      ];
      return {
        ...base,
        scheme: internal[1],
        internal: value,
        pathMode: target.type === 'page' ? 'exact' : 'prefix',
        spec: specificity(parts),
        specParts: parts,
      };
    }
  }

  let scheme = 'web';
  let host = '';
  let rest = '';
  if (value.startsWith('file://')) {
    scheme = 'file';
    rest = value.slice('file://'.length);
    if (rest === '/') rest = '';
  } else {
    const cut = value.search(/[/?#]/);
    host = cut === -1 ? value : value.slice(0, cut);
    rest = cut === -1 ? '' : value.slice(cut);
  }
  let fragment: string | null = null;
  const h = rest.indexOf('#');
  if (h !== -1) {
    fragment = rest.slice(h + 1);
    rest = rest.slice(0, h);
  }
  const query: QueryConstraint[] = [];
  const q = rest.indexOf('?');
  if (q !== -1) {
    for (const pair of rest.slice(q + 1).split('&')) {
      if (!pair) continue;
      const i = pair.indexOf('=');
      const k = i === -1 ? pair : pair.slice(0, i);
      const v = i === -1 ? '*' : pair.slice(i + 1);
      query.push({
        k,
        v,
        re: v.includes('*') ? new Wildcard(v, false) : null,
      });
    }
    rest = rest.slice(0, q);
  }
  const path = rest.length > 1 ? rest.replace(/\/+$/, '') : rest === '/' ? '' : rest;

  const pathMode: CompiledPattern['pathMode'] =
    target.type === 'domain' || target.type === 'host'
      ? 'any'
      : target.type === 'homepage'
        ? 'home'
        : target.type === 'page'
          ? 'exact'
          : 'prefix';
  const hostWild = host.includes('*');
  const pathWild = path.includes('*');
  const pathRe = pathWild ? new Wildcard(path, true, pathMode === 'exact' ? 'exact' : 'prefix') : null;

  const hostLabels = host ? host.split('.').filter((l) => !l.includes('*')).length : 0;
  const pathSegs = path.split('/').filter((s) => s && !s.includes('*')).length;
  const kind = pathMode === 'exact' || pathMode === 'home' ? 3 : hostWild || pathWild ? 1 : 2;
  const parts: [number, number, number, number] = [hostLabels, pathSegs, query.length, kind];

  const subdomains = target.type !== 'host';
  return {
    ...base,
    scheme,
    host: hostWild ? '' : stripWww(host),
    hostRe: hostWild
      ? new RegExp(`^${subdomains ? '(?:[^.]+\\.)*?' : '(?:www\\.)?'}${hostToRe(host)}$`)
      : null,
    subdomains,
    pathMode,
    path,
    pathRe,
    query,
    fragment,
    spec: specificity(parts),
    specParts: parts,
  };
}

/** Full URL used for regex targets: without fragment, capped to defuse pathological inputs. */
function regexSubject(url: ParsedUrl): string {
  const i = url.href.indexOf('#');
  const s = i === -1 ? url.href : url.href.slice(0, i);
  return s.length > 4096 ? s.slice(0, 4096) : s;
}

/**
 * What an address wildcard is matched against: the host without www., the path without trailing
 * slashes and the query, in lower case ("example.com/news?id=1"). No scheme, port or fragment.
 */
export function addressOf(url: ParsedUrl): string {
  const path = url.path.length > 1 ? url.path.replace(/\/+$/, '') : '';
  const query = url.query.map(([k, v]) => (v ? `${k}=${v}` : k)).join('&');
  return `${stripWww(url.host)}${path}${query ? `?${query}` : ''}`.toLowerCase().slice(0, 4096);
}

export function matchPattern(cp: CompiledPattern, url: ParsedUrl): boolean {
  if (cp.regex) return cp.regex.test(regexSubject(url));
  if (cp.address) return url.web && cp.address.test(addressOf(url));
  if (cp.internal !== null) {
    if (url.web || url.scheme !== cp.scheme) return false;
    const full = `${url.scheme}:${url.host ? `//${url.host}` : ''}${url.path}`.replace(/\/+$/, '');
    if (cp.pathMode === 'exact') return full === cp.internal;
    return full === cp.internal || full.startsWith(`${cp.internal}/`);
  }
  if (cp.scheme === 'web') {
    if (!url.web) return false;
    const host = url.host;
    if (cp.hostRe) {
      if (!cp.hostRe.test(host)) return false;
    } else if (cp.subdomains) {
      if (host !== cp.host && !host.endsWith(`.${cp.host}`)) return false;
    } else if (stripWww(host) !== cp.host) return false;
  } else if (url.scheme !== cp.scheme) return false;

  const p = url.path.length > 1 ? url.path.replace(/\/+$/, '') : '';
  switch (cp.pathMode) {
    case 'home':
      if (p !== '') return false;
      break;
    case 'exact':
      if (cp.pathRe ? !cp.pathRe.test(p || '/') : p !== cp.path) return false;
      break;
    case 'prefix':
      if (cp.pathRe) {
        if (!cp.pathRe.test(p)) return false;
      } else if (p !== cp.path && !p.startsWith(`${cp.path}/`)) return false;
      break;
  }
  for (const c of cp.query) {
    const found = url.query.filter(([k]) => k === c.k);
    if (!found.length) return false;
    if (c.v === '*') continue;
    if (!found.some(([, v]) => (c.re ? c.re.test(v) : v === c.v))) return false;
  }
  if (cp.fragment !== null && url.fragment !== cp.fragment) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Index for fast matching of large lists
// ---------------------------------------------------------------------------

export class PatternIndex {
  private byHost = new Map<string, CompiledPattern[]>();
  private generic: CompiledPattern[] = [];
  readonly all: CompiledPattern[] = [];

  add(cp: CompiledPattern) {
    this.all.push(cp);
    if (cp.scheme === 'web' && cp.host && !cp.hostRe) {
      const list = this.byHost.get(cp.host);
      if (list) list.push(cp);
      else this.byHost.set(cp.host, [cp]);
    } else this.generic.push(cp);
  }

  /** All patterns matching the URL. */
  match(url: ParsedUrl): CompiledPattern[] {
    const out: CompiledPattern[] = [];
    if (url.web && this.byHost.size) {
      const labels = url.host.split('.');
      for (let i = 0; i < labels.length; i++) {
        const list = this.byHost.get(labels.slice(i).join('.'));
        if (list) for (const cp of list) if (matchPattern(cp, url)) out.push(cp);
      }
    }
    for (const cp of this.generic) if (matchPattern(cp, url)) out.push(cp);
    return out;
  }

  /** The most specific matching entry; on equal specificity a block wins. */
  winner(url: ParsedUrl): { winner: CompiledPattern | null; matches: CompiledPattern[] } {
    const matches = this.match(url);
    let winner: CompiledPattern | null = null;
    for (const cp of matches) {
      if (!winner || cp.spec > winner.spec || (cp.spec === winner.spec && winner.allow && !cp.allow)) {
        winner = cp;
      }
    }
    return { winner, matches };
  }

  get size() {
    return this.all.length;
  }
}

// ---------------------------------------------------------------------------
// Site keys (per-site budgets, statistics)
// ---------------------------------------------------------------------------

/** The "site" a URL belongs to within a group: the host of the matching entry, or the URL host. */
export function siteKeyFor(cp: CompiledPattern | null, url: ParsedUrl): string {
  if (cp && cp.scheme === 'web' && cp.host && cp.type !== 'regex') return cp.host;
  if (url.web) return stripWww(url.host);
  return url.scheme;
}

// ---------------------------------------------------------------------------
// DNR regular expressions and representative URLs
// ---------------------------------------------------------------------------

const DNR_LABEL = '[^/?#:@.]';

function dnrHost(cp: CompiledPattern, rawHost: string): string {
  const literal = cp.hostRe === null;
  const body = literal
    ? escapeRe(cp.host)
    : rawHost
        .split('.')
        .map((label) =>
          label === '*'
            ? `${DNR_LABEL}+(?:\\.${DNR_LABEL}+)*`
            : label.includes('*')
              ? wildToRe(label, `${DNR_LABEL}*`, `${DNR_LABEL}*`)
              : escapeRe(label),
        )
        .join('\\.');
  if (!cp.subdomains) return `(?:www\\.)?${body}`;
  return `(?:[^/?#:@]*\\.)?${body}`;
}

function rawHostOf(cp: CompiledPattern): string {
  const v = cp.target.value;
  const cut = v.search(/[/?#]/);
  return cut === -1 ? v : v.slice(0, cut);
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) out.push([item, ...rest]);
  });
  return out;
}

/**
 * A regular expression (RE2 compatible, without anchors) matching the URLs of the pattern as seen
 * by declarativeNetRequest (no fragment). `exact` is false when the expression over-approximates.
 */
export function dnrRegex(cp: CompiledPattern): { re: string; exact: boolean } | null {
  if (cp.regex) {
    const v = cp.target.value;
    const start = v.startsWith('^');
    const end = v.endsWith('$') && !v.endsWith('\\$');
    const core = v.slice(start ? 1 : 0, end ? -1 : undefined);
    return { re: `${start ? '' : '.*'}(?:${core})${end ? '' : '.*'}`, exact: true };
  }
  if (cp.scheme !== 'web') return null;
  if (cp.address) {
    // The browser sees the scheme, a user name, the port and trailing slashes, which the address
    // of a wildcard leaves out: the expression allows them where they cannot change the match.
    const body = wildToRe(cp.target.value, '.*', '.*');
    return {
      re: `https?://(?:[^/?#@]*@)?(?:www\\.)?${body}${cp.target.value.endsWith('*') ? '' : '/?'}`,
      exact: !/[/?:]/.test(cp.target.value),
    };
  }
  const host = dnrHost(cp, rawHostOf(cp));
  let path: string;
  const pathBody = cp.pathRe ? wildToRe(cp.path, '[^/?]*', '[^?]*') : escapeRe(cp.path);
  switch (cp.pathMode) {
    case 'any':
      path = '(?:[/?].*)?';
      break;
    case 'home':
      path = '/?(?:\\?.*)?';
      break;
    case 'exact':
      path = `${pathBody}/?`;
      break;
    default:
      path = `${pathBody}(?:/[^?]*)?`;
  }
  let exact = true;
  let query = cp.pathMode === 'any' || cp.pathMode === 'home' ? '' : '(?:\\?.*)?';
  if (cp.query.length) {
    const param = (c: QueryConstraint) =>
      `${escapeRe(c.k)}=${c.v === '*' ? '[^&]*' : wildToRe(c.v, '[^&]*', '[^&]*')}(?:&|$)`;
    if (cp.query.length <= 3) {
      const perms = permutations(cp.query).map((perm) => perm.map(param).join('(?:[^&]*&)*?'));
      query = `\\?(?:[^&]*&)*?(?:${perms.join('|')}).*`;
    } else {
      exact = false;
    }
  }
  if (cp.fragment !== null) exact = false;
  return { re: `https?://(?:[^/?#@]*@)?${host}(?::[0-9]+)?${path}${query}`, exact };
}

/** A URL inside the pattern's own region, used to evaluate what the DNR rule must do. */
export function representativeUrl(cp: CompiledPattern): string | null {
  if (cp.scheme !== 'web' || cp.regex) return null;
  if (cp.address) {
    const v = cp.target.value.replace(/\*/g, 'whb-x');
    return `https://${/^[/?]/.test(v) ? `whb-x${v}` : v}`;
  }
  const rawHost = rawHostOf(cp);
  const host = cp.hostRe ? rawHost.replace(/\*/g, 'whb-x') : cp.host;
  const path = cp.path.replace(/\*+/g, 'whb-x');
  let p: string;
  switch (cp.pathMode) {
    case 'any':
      p = '/whb-r';
      break;
    case 'home':
      p = '/';
      break;
    case 'exact':
      p = path || '/';
      break;
    default:
      p = `${path}/whb-r`;
  }
  const q = cp.query.length
    ? `?${cp.query.map((c) => `${c.k}=${c.v === '*' ? 'whb-x' : c.v.replace(/\*/g, 'whb-x')}`).join('&')}`
    : '';
  const f = cp.fragment !== null ? `#${cp.fragment}` : '';
  return `https://${host}${p}${q}${f}`;
}

/**
 * The hosts a pattern can match, widened to something simple to compare: a host with or without
 * its subdomains, every host of a scheme (empty host), or anything (null). A host with wildcards
 * becomes the part after its last wildcard, with its subdomains.
 */
function hostScope(cp: CompiledPattern): { scheme: string; host: string; subdomains: boolean } | null {
  if (cp.regex || cp.scheme === '*') return null;
  if (cp.address) {
    // An address wildcard keeps to one host only when no star comes before the first / or ?.
    const v = cp.target.value;
    const cut = v.search(/[/?]/);
    if (cut <= 0 || v.slice(0, cut).includes('*')) return null;
    return { scheme: 'web', host: stripWww(v.slice(0, cut).toLowerCase()), subdomains: false };
  }
  if (cp.scheme !== 'web') return { scheme: cp.scheme, host: '', subdomains: true };
  if (cp.hostRe) {
    const labels = rawHostOf(cp).split('.');
    let last = labels.length - 1;
    while (last >= 0 && !labels[last].includes('*')) last--;
    const suffix = labels.slice(last + 1).join('.');
    return suffix ? { scheme: 'web', host: stripWww(suffix), subdomains: true } : null;
  }
  return cp.host ? { scheme: 'web', host: cp.host, subdomains: cp.subdomains } : null;
}

/**
 * Whether two patterns may match a common address, compared by host only: it errs towards
 * yes, so that an Always allowed entry of schema 1 reaches every rule whose sites it opens.
 */
export function mayOverlap(a: CompiledPattern, b: CompiledPattern): boolean {
  const x = hostScope(a);
  const y = hostScope(b);
  if (!x || !y) return true;
  if (x.scheme !== y.scheme) return false;
  if (!x.host || !y.host) return true;
  return (
    x.host === y.host ||
    (x.subdomains && y.host.endsWith(`.${x.host}`)) ||
    (y.subdomains && x.host.endsWith(`.${y.host}`))
  );
}

/** Content script match patterns covering the pattern. '<all_urls>' when not expressible. */
export function contentMatchPatterns(cp: CompiledPattern): string[] {
  if (cp.regex || cp.address) return ['<all_urls>'];
  if (cp.internal !== null) return [];
  if (cp.scheme === 'file') return ['file:///*'];
  if (cp.hostRe) {
    const raw = rawHostOf(cp);
    // Only a leading "*." can be expressed in a match pattern.
    if (/^\*\./.test(raw) && !raw.slice(2).includes('*')) return [`*://*.${raw.slice(2)}/*`];
    return ['<all_urls>'];
  }
  if (/^\[/.test(cp.host) || /^\d+\.\d+\.\d+\.\d+$/.test(cp.host)) return [`*://${cp.host}/*`];
  if (!cp.subdomains) return [`*://${cp.host}/*`, `*://www.${cp.host}/*`];
  return [`*://${cp.host}/*`, `*://*.${cp.host}/*`];
}

/** Whether a domain-only pattern can be expressed with DNR requestDomains. */
export function isPlainDomain(cp: CompiledPattern): boolean {
  return (
    cp.scheme === 'web' &&
    !cp.regex &&
    !cp.address &&
    !cp.hostRe &&
    cp.subdomains &&
    cp.pathMode === 'any' &&
    cp.query.length === 0 &&
    cp.fragment === null &&
    !/^\[/.test(cp.host)
  );
}
