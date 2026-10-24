/**
 * Compiles the current decisions into declarativeNetRequest rules.
 *
 * Every distinct target is a "region" of URLs. For each region the engine itself is asked what
 * must happen to a representative URL of the region, and a rule with a priority derived from the
 * target's specificity is emitted (redirect to the intervention page, or allow). Because DNR picks
 * the highest priority matching rule, URLs end up with the decision of their most specific
 * region, which mirrors `specificity()`. Rare cross-group overlaps can be approximated: the intervention
 * page re-checks every decision with the engine and the background re-checks committed
 * navigations, so the engine always has the last word.
 */

import { redirectDestination } from './compile';
import { activeSessions, decide, type EngineContext, evaluateGroup } from './decide';
import { type CompiledPattern, compilePattern, dnrRegex, isPlainDomain, representativeUrl } from './patterns';
import { isNav, NAV_SEVERITY, SEVERITY } from './severity';
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
  /** Without host access only network blocks are possible. */
  hostAccess: boolean;
  limits: { regex: number; unsafe: number; total: number };
}

export interface DnrResult {
  rules: DnrRuleData[];
  stats: { regions: number; regex: number; redirects: number; total: number };
  /** Targets left to the fallback enforcement because of rule limits or unsupported syntax. */
  overflow: string[];
}

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
    // The page a rule redirects to is a region of its own, so that the engine decides it
    // (the redirecting rule never restricts it; other rules may).
    for (const p of cg.group.policies)
      if (p.intervention.type === 'redirect')
        add(patternFromUrl(redirectDestination(p.intervention.url).replace(/[?#].*$/, '')));
  }
  for (const s of state.sessions) {
    if (s.endAt <= now) continue;
    for (const t of s.allow) add(compilePattern({ ...t, allow: true }));
    for (const t of s.block ?? []) add(compilePattern(t));
  }
  for (const g of state.grants) {
    if (g.scope === 'page' && g.url) add(patternFromUrl(g.url));
    if (g.scope === 'site' && g.site) add(compilePattern({ id: 'grant', type: 'domain', value: g.site }));
  }
  return [...regions.values()];
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
    if (!cg) continue;
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

  // The regular expressions of a blocklist session block for the session; its exceptions that are
  // regular expressions are left to the intervention page, which re-checks.
  for (const s of activeSessions(ctx.state, ctx.now)) {
    if (s.kind !== 'blocklist') continue;
    for (const t of s.block ?? []) {
      const cp = compilePattern(t);
      if (!cp?.regex) continue;
      if (cp.allow) overflow.push(cp.target.value);
      else out.push({ cp, nav: true, embed: false, spec: cp.spec });
    }
  }

  if (activeSessions(ctx.state, ctx.now).some((s) => s.kind === 'allowlist')) {
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

  // Buckets of rules with the same priority, action and resource type: plain domains are merged
  // into requestDomains, the others are one regular expression each.
  type Action = 'nav' | 'allow' | 'block';
  type Bucket = { priority: number; action: Action; res: DnrResource; items: string[] };
  const domainBuckets = new Map<string, Bucket>();
  const regexBuckets = new Map<string, Bucket>();
  const add =
    (buckets: Map<string, Bucket>) => (priority: number, action: Action, res: DnrResource, item: string) => {
      const k = `${priority}|${action}|${res}`;
      const b = buckets.get(k);
      if (b) b.items.push(item);
      else buckets.set(k, { priority, action, res, items: [item] });
    };
  const addDomain = add(domainBuckets);
  const addRegex = add(regexBuckets);

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

  const actionFor = (a: Action): DnrRuleData['action'] =>
    a === 'nav' ? navAction() : a === 'allow' ? { type: 'allow' } : { type: 'block' };

  for (const b of domainBuckets.values()) {
    const domains = [...new Set(b.items)].sort();
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
    for (const e of [...new Set(b.items)].sort()) {
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
