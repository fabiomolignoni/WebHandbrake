/**
 * Targets: text syntax, normalisation (MAT-02), matching, specificity (SEM-06),
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
  /** i18n key of the error (MAT-02: errors reported line by line). */
  error?: string;
  comment?: boolean;
}

const INTERNAL_SCHEMES = ['about', 'chrome', 'edge', 'opera', 'brave', 'vivaldi', 'moz-extension'];
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
    if (host === '*') return done({ error: 'targets.error.tooBroad' });
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
  let host = IPV6_RE.test(hostPart) ? hostPart.toLowerCase() : toAsciiHost(hostPart);
  if (!host) return { error: 'targets.error.invalid' };
  if (!IPV6_RE.test(host)) {
    if (!HOST_RE.test(host)) return { error: 'targets.error.invalid' };
    if (host.startsWith('www.') && host.length > 4) host = host.slice(4);
    if (host === '*' || /^\*(\.\*)*$/.test(host)) return { error: 'targets.error.tooBroad' };
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
// Regular expression safety (SEC-03, MAT-06)
// ---------------------------------------------------------------------------

/** Returns an i18n error key when the expression is unsafe or invalid, null otherwise. */
export function checkRegex(src: string): string | null {
  if (src.length > MAX_REGEX_LENGTH) return 'targets.error.regexTooLong';
  if (/\\[1-9]|\\k</.test(src)) return 'targets.error.regexBackref';
  if (/\(\?<?[=!]/.test(src)) return 'targets.error.regexLookaround';
  if (hasNestedQuantifier(src)) return 'targets.error.regexNested';
  try {
    new RegExp(src, 'i');
  } catch {
    return 'targets.error.regexInvalid';
  }
  return null;
}

/** Detects quantified groups that contain unbounded quantifiers, e.g. (a+)+ or (.*)*. */
function hasNestedQuantifier(src: string): boolean {
  const stack: { unbounded: boolean }[] = [];
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
    if (c === '(') {
      stack.push({ unbounded: false });
      continue;
    }
    const next = src[i + 1];
    const quantifiedUnbounded = (q: string | undefined, at: number) =>
      q === '*' || q === '+' || (q === '{' && /^\{\d*,\}/.test(src.slice(at)));
    if (c === ')') {
      const g = stack.pop();
      if (!g) continue;
      const q = next;
      const quantified = q === '*' || q === '+' || q === '?' || q === '{';
      if (quantified && g.unbounded && quantifiedUnbounded(q, i + 1)) return true;
      if (quantified && g.unbounded && stack.length) stack[stack.length - 1].unbounded = true;
      if (g.unbounded && stack.length) stack[stack.length - 1].unbounded = true;
      if (quantifiedUnbounded(q, i + 1) && stack.length) stack[stack.length - 1].unbounded = true;
      continue;
    }
    if ((c === '*' || c === '+' || (c === '{' && /^\{\d*,\}/.test(src.slice(i)))) && stack.length) {
      stack[stack.length - 1].unbounded = true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Compiled patterns and matching
// ---------------------------------------------------------------------------

export interface QueryConstraint {
  k: string;
  v: string;
  re: RegExp | null;
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
  pathRe: RegExp | null;
  query: QueryConstraint[];
  fragment: string | null;
  regex: RegExp | null;
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

export const MAX_SPEC = specificity([99, 99, 99, 9]);

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
    internal: null as string | null,
  };

  if (target.type === 'regex') {
    if (checkRegex(target.value)) return null;
    // SEM-06: regular expressions have minimal specificity; exceptions written as regular
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
        re: v.includes('*') ? new RegExp(`^${wildToRe(v, '.*', '.*')}$`) : null,
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
  let pathRe: RegExp | null = null;
  if (pathWild) {
    const body = wildToRe(path, '[^/]*', '.*');
    pathRe = new RegExp(pathMode === 'exact' ? `^${body}/?$` : `^${body}(?:/.*)?$`);
  }

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

export function matchPattern(cp: CompiledPattern, url: ParsedUrl): boolean {
  if (cp.regex) return cp.regex.test(regexSubject(url));
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
// Index for fast matching of large lists (PERF-05)
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

  /** SEM-02/SEM-06: the most specific matching entry; on equal specificity a block wins. */
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
// Site keys (LIM-03 per-site budgets, statistics)
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

/** Content script match patterns covering the pattern (PERF-03). '<all_urls>' when not expressible. */
export function contentMatchPatterns(cp: CompiledPattern): string[] {
  if (cp.regex) return ['<all_urls>'];
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
    !cp.hostRe &&
    cp.subdomains &&
    cp.pathMode === 'any' &&
    cp.query.length === 0 &&
    cp.fragment === null &&
    !/^\[/.test(cp.host)
  );
}
