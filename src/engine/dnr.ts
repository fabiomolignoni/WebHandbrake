/**
 * Compiles the current decisions into declarativeNetRequest rules (ENF-01, ENF-08, ENF-12, PERF-05).
 *
 * Every distinct target is a "region" of URLs. For each region the engine itself is asked what
 * must happen to a representative URL of the region, and a rule with a priority derived from the
 * target's specificity is emitted (redirect to the intervention page, or allow). Because DNR picks
 * the highest priority matching rule, URLs end up with the decision of their most specific
 * region, which mirrors SEM-06. Rare cross-group overlaps can be approximated: the intervention
 * page re-checks every decision with the engine and the background re-checks committed
 * navigations, so the engine always has the last word.
 */

import { type CompiledConfig, isGroupActive } from './compile';
import { decide, type EngineContext, evaluateGroup, isNav, NAV_SEVERITY, SEVERITY } from './decide';
import {
  type CompiledPattern,
  compilePattern,
  dnrRegex,
  isPlainDomain,
  MAX_SPEC,
  representativeUrl,
} from './patterns';
import type { Target } from './types';
import { type ParsedUrl, parseUrl, stripWww } from './url';

export type DnrResource = 'main_frame' | 'sub_frame';

export interface DnrRuleData {
  priority: number;
  action:
    | { type: 'allow' }
    | { type: 'block' }
    | { type: 'redirect'; redirect: { regexSubstitution: string } };
  condition: {
    regexFilter?: string;
    urlFilter?: string;
    requestDomains?: string[];
    resourceTypes: DnrResource[];
    isUrlFilterCaseSensitive?: boolean;
  };
}

export interface DnrOptions {
  /** Full URL of the intervention page, e.g. chrome-extension://<id>/intervention.html */
  interventionUrl: string;
  /** ENF-12: without host access only network blocks are possible. */
  hostAccess: boolean;
  limits: { regex: number; unsafe: number; total: number };
}

export interface DnrResult {
  rules: DnrRuleData[];
  stats: { regions: number; regex: number; redirects: number; total: number };
  /** Targets left to the fallback enforcement because of rule limits or unsupported syntax. */
  overflow: string[];
}

export const ALL_URLS_KEY = '*all*';
const TOP_PRIORITY = 2 * MAX_SPEC + 10;

interface Region {
  cp: CompiledPattern;
  /** Group owning a regular expression entry (regex regions are evaluated per group). */
  owner?: string;
}

function patternFromUrl(url: string): CompiledPattern | null {
  const p = parseUrl(url);
  if (!p?.web) return null;
  const q = p.query.map(([k, v]) => `${k}=${v}`).join('&');
  const value = `${stripWww(p.host)}${p.path.length > 1 ? p.path.replace(/\/+$/, '') : '/'}${q ? `?${q}` : ''}`;
  return compilePattern({ id: 'grant', type: 'page', value });
}

function syntheticUrl(): ParsedUrl {
  return {
    href: 'https://whb-regex.invalid/',
    scheme: 'https',
    web: true,
    host: 'whb-regex.invalid',
    path: '/',
    query: [],
    fragment: '',
  };
}

export function collectRegions(ctx: EngineContext): Region[] {
  const { cc, state, now } = ctx;
  const regions = new Map<string, Region>();
  const add = (cp: CompiledPattern | null, owner?: string) => {
    if (!cp || (cp.scheme !== 'web' && !cp.regex)) return;
    const key = cp.regex ? `${cp.key}|${owner}|${cp.allow}` : cp.key;
    if (!regions.has(key)) regions.set(key, { cp, owner });
  };
  for (const cg of cc.groups) {
    if (cg.group.options.privacy !== 'all') continue;
    for (const cp of cg.index.all) add(cp, cp.regex ? cg.group.id : undefined);
  }
  for (const cp of cc.allowlist.all) if (!cp.regex) add(cp);
  for (const s of state.sessions) {
    if (s.endAt <= now) continue;
    for (const t of s.allow) add(compilePattern({ ...t, allow: true }));
  }
  for (const g of state.grants) {
    if (g.scope === 'page' && g.url) add(patternFromUrl(g.url));
    if (g.scope === 'site' && g.site) add(compilePattern({ id: 'grant', type: 'domain', value: g.site }));
  }
  return [...regions.values()];
}

function hasActiveAllowlistSession(ctx: EngineContext): boolean {
  return ctx.state.sessions.some((s) => s.kind === 'allowlist' && s.startAt <= ctx.now && ctx.now < s.endAt);
}

export function compileDnr(ctx: EngineContext, opts: DnrOptions): DnrResult {
  const regions = collectRegions(ctx);
  const overflow: string[] = [];
  type Out = { cp: CompiledPattern | null; nav: boolean; embed: boolean; spec: number };
  const out: Out[] = [];
  const navGroups = new Set<string>();
  const embedsWanted = ctx.cc.groups.some((g) => g.group.options.embeds);

  for (const r of regions) {
    if (r.cp.regex) continue;
    const rep = representativeUrl(r.cp);
    if (!rep) continue;
    const d = decide(ctx, rep, { incognito: null });
    if (d.exempt) continue;
    const nav = isNav(d);
    if (nav)
      for (const g of d.groups) if (SEVERITY[g.intervention.type] >= NAV_SEVERITY) navGroups.add(g.group.id);
    const embed =
      nav && d.groups.some((g) => g.group.options.embeds && SEVERITY[g.intervention.type] >= NAV_SEVERITY);
    out.push({ cp: r.cp, nav, embed, spec: r.cp.spec });
  }

  // Regular expression entries: evaluated for their own group only.
  for (const r of regions) {
    if (!r.cp.regex || !r.owner) continue;
    const cg = ctx.cc.byId.get(r.owner);
    if (!cg || !isGroupActive(cg.group)) continue;
    if (r.cp.allow) continue; // handled below once all groups are known
    const res = evaluateGroup(ctx, cg, r.cp, syntheticUrl());
    const nav = SEVERITY[res.intervention.type] >= NAV_SEVERITY;
    if (!nav) continue;
    navGroups.add(cg.group.id);
    out.push({ cp: r.cp, nav, embed: cg.group.options.embeds, spec: r.cp.spec });
  }
  for (const r of regions) {
    if (!r.cp.regex || !r.cp.allow || !r.owner) continue;
    // A regular expression exception would also override other groups: emit it only when no other
    // group intervenes (otherwise the intervention page re-checks and lets the URL through).
    if ([...navGroups].every((g) => g === r.owner))
      out.push({ cp: r.cp, nav: false, embed: false, spec: r.cp.spec });
    else overflow.push(r.cp.target.value);
  }

  if (hasActiveAllowlistSession(ctx)) {
    const d = decide(ctx, 'https://whb-any.invalid/whb-r', { incognito: null });
    if (isNav(d)) out.push({ cp: null, nav: true, embed: false, spec: 0 });
  }

  const rules: DnrRuleData[] = [];
  if (!out.some((o) => o.nav)) {
    return { rules, stats: { regions: regions.length, regex: 0, redirects: 0, total: 0 }, overflow };
  }

  const navAction = (): DnrRuleData['action'] =>
    opts.hostAccess
      ? { type: 'redirect', redirect: { regexSubstitution: `${opts.interventionUrl}#\\1` } }
      : { type: 'block' };

  // Buckets: plain domains merged into requestDomains; others into (merged) regular expressions.
  const domainBuckets = new Map<
    string,
    { priority: number; action: 'nav' | 'allow' | 'block'; res: DnrResource; domains: string[] }
  >();
  const regexBuckets = new Map<
    string,
    { priority: number; action: 'nav' | 'allow' | 'block'; res: DnrResource; res2: string[] }
  >();
  const addDomain = (
    priority: number,
    action: 'nav' | 'allow' | 'block',
    res: DnrResource,
    domain: string,
  ) => {
    const k = `${priority}|${action}|${res}`;
    const b = domainBuckets.get(k);
    if (b) b.domains.push(domain);
    else domainBuckets.set(k, { priority, action, res, domains: [domain] });
  };
  const addRegex = (priority: number, action: 'nav' | 'allow' | 'block', res: DnrResource, re: string) => {
    const k = `${priority}|${action}|${res}`;
    const b = regexBuckets.get(k);
    if (b) b.res2.push(re);
    else regexBuckets.set(k, { priority, action, res, res2: [re] });
  };

  const navSpecs = out.filter((o) => o.nav).map((o) => o.spec);
  const minNavSpec = Math.min(...navSpecs);
  const anyEmbed = embedsWanted && out.some((o) => o.embed);
  const minEmbedSpec = anyEmbed ? Math.min(...out.filter((o) => o.embed).map((o) => o.spec)) : Infinity;

  for (const o of out) {
    const priority = 1 + 2 * o.spec + (o.nav ? 1 : 0);
    if (!o.cp) {
      // Catch-all for allowlist sessions.
      rules.push({
        priority,
        action: navAction(),
        condition: {
          regexFilter: opts.hostAccess ? '^(https?://.*)$' : '^https?://',
          resourceTypes: ['main_frame'],
          isUrlFilterCaseSensitive: false,
        },
      });
      continue;
    }
    // Allow rules are only useful above some navigation rule.
    const mainNeeded = o.nav || o.spec >= minNavSpec;
    const plain = isPlainDomain(o.cp);
    const rx = plain ? null : dnrRegex(o.cp);
    if (!plain && !rx) {
      overflow.push(o.cp.target.value);
      continue;
    }
    if (rx && !rx.exact && !o.nav) {
      // An over-approximated exception could let blocked pages through: leave it to the re-check.
      overflow.push(o.cp.target.value);
      continue;
    }
    if (mainNeeded) {
      if (plain) addDomain(priority, o.nav ? 'nav' : 'allow', 'main_frame', o.cp.host);
      else if (rx) addRegex(priority, o.nav ? 'nav' : 'allow', 'main_frame', rx.re);
    }
    if (anyEmbed && (o.embed || o.spec >= minEmbedSpec)) {
      const p = 1 + 2 * o.spec + (o.embed ? 1 : 0);
      if (plain) addDomain(p, o.embed ? 'block' : 'allow', 'sub_frame', o.cp.host);
      else if (rx) addRegex(p, o.embed ? 'block' : 'allow', 'sub_frame', rx.re);
    }
  }

  const actionFor = (a: 'nav' | 'allow' | 'block'): DnrRuleData['action'] =>
    a === 'nav' ? navAction() : a === 'allow' ? { type: 'allow' } : { type: 'block' };

  for (const b of domainBuckets.values()) {
    const domains = [...new Set(b.domains)].sort();
    for (let i = 0; i < domains.length; i += 2000) {
      const chunk = domains.slice(i, i + 2000);
      const condition: DnrRuleData['condition'] = { requestDomains: chunk, resourceTypes: [b.res] };
      if (b.action === 'nav' && opts.hostAccess) {
        condition.regexFilter = '^(.*)$';
      }
      rules.push({ priority: b.priority, action: actionFor(b.action), condition });
    }
  }
  for (const b of regexBuckets.values()) {
    // One expression per rule. Browsers cap the memory of each regular expression (Chrome: 2 KB
    // for RE2) and even two merged addresses exceed it, which would leave all of them to the
    // slower fallback; the number of regex rules is limited below.
    const capture = b.action === 'nav' && opts.hostAccess;
    for (const e of [...new Set(b.res2)].sort()) {
      rules.push({
        priority: b.priority,
        action: actionFor(b.action),
        condition: {
          regexFilter: capture ? `^(${e})$` : `^${e}$`,
          resourceTypes: [b.res],
          isUrlFilterCaseSensitive: false,
        },
      });
    }
  }

  // ENF-09: never intervene on redirect destinations.
  for (const target of ctx.cc.redirectTargets) {
    const m = /^https?:\/\/([^/?#]+)(\/[^?#]*)?$/.exec(target);
    if (!m) continue;
    // "^" ends the path: the destination page with any query, not the pages below it.
    rules.push({
      priority: TOP_PRIORITY,
      action: { type: 'allow' },
      condition: { urlFilter: `||${m[1]}${m[2] || '/'}^`, resourceTypes: ['main_frame'] },
    });
  }

  // Limits: keep the most important rules (navigation first), report the rest.
  let regexCount = rules.filter((r) => r.condition.regexFilter).length;
  if (regexCount > opts.limits.regex || rules.length > opts.limits.total) {
    rules.sort(
      (a, b) =>
        Number(b.action.type !== 'allow') - Number(a.action.type !== 'allow') || b.priority - a.priority,
    );
    const kept: DnrRuleData[] = [];
    let rc = 0;
    for (const r of rules) {
      const isRegex = Boolean(r.condition.regexFilter);
      if ((isRegex && rc >= opts.limits.regex) || kept.length >= opts.limits.total) {
        overflow.push(r.condition.regexFilter ?? r.condition.urlFilter ?? '');
        continue;
      }
      if (isRegex) rc++;
      kept.push(r);
    }
    rules.length = 0;
    rules.push(...kept);
    regexCount = rc;
  }

  rules.sort(
    (a, b) =>
      b.priority - a.priority || JSON.stringify(a.condition).localeCompare(JSON.stringify(b.condition)),
  );
  return {
    rules,
    stats: {
      regions: regions.length,
      regex: regexCount,
      redirects: rules.filter((r) => r.action.type === 'redirect').length,
      total: rules.length,
    },
    overflow,
  };
}

/** Patterns that need content scripts / fallback enforcement (used by diagnostics). */
export function targetCount(cc: CompiledConfig): number {
  return cc.groups.reduce((n, g) => n + g.index.size, 0) + cc.allowlist.size;
}

export function targetsOf(cc: CompiledConfig): Target[] {
  return cc.groups.flatMap((g) => g.index.all.map((p) => p.target));
}
