/** Validation that prevents configurations that block nothing, with clear messages. */

import { unusedExceptions } from './changes';
import { canHaveBreaks, periodMinutes } from './defaults';
import { ALL_SITES, checkRegex } from './patterns';
import type { Group, Policy, Target } from './types';

export interface Issue {
  level: 'error' | 'warning' | 'info';
  /** i18n key */
  key: string;
  params?: Record<string, string | number>;
  policy?: number;
}

/** Problems with the condition of a rule and what happens then (`policy`: the condition's index). */
function policyIssues(p: Policy, i: number): Issue[] {
  const out: Issue[] = [];
  const issue = (level: Issue['level'], key: string): Issue => ({ level, key, policy: i });
  if (p.schedule.mode === 'during') {
    if (!p.schedule.windows.length) out.push(issue('error', 'validate.noWindows'));
    p.schedule.windows.forEach((w) => {
      if (!w.days.length) out.push(issue('error', 'validate.noDays'));
      if (w.start === w.end && w.start !== 0) out.push(issue('warning', 'validate.emptyWindow'));
    });
  }
  const b = p.budget;
  if (b) {
    if (b.type === 'time' && b.minutes <= 0) out.push(issue('warning', 'validate.zeroBudget'));
    // A limit as long as its period is never reached.
    if (b.type === 'time' && b.minutes >= periodMinutes(b.period))
      out.push(issue('error', 'validate.neverReached'));
    if (b.type === 'visits' && b.count <= 0) out.push(issue('warning', 'validate.zeroVisits'));
  }
  const iv = p.intervention;
  if (iv.type === 'redirect' && !isRedirectUrl(iv.url)) out.push(issue('error', 'validate.redirectUrl'));
  if (iv.type === 'challenge' && iv.kind === 'phrase' && !iv.phrase?.trim())
    out.push(issue('error', 'validate.phrase'));
  if (iv.type === 'delay' && iv.randomTo !== undefined && iv.randomTo <= iv.seconds)
    out.push(issue('error', 'validate.randomWait'));
  return out;
}

/** A redirect goes to a web page; {url}, {group} and {until} are replaced when it happens. */
export function isRedirectUrl(url: string): boolean {
  try {
    const u = new URL(url.trim().replace(/\{[a-z]+\}/g, 'x'));
    return /^https?:$/.test(u.protocol) && u.hostname !== '';
  } catch {
    return false;
  }
}

export function validateTargets(targets: Target[]): Issue[] {
  const out: Issue[] = [];
  for (const t of targets) {
    if (t.type === 'regex') {
      const err = checkRegex(t.value);
      if (err) out.push({ level: 'error', key: err, params: { value: t.value } });
    }
  }
  return out;
}

export function validateGroup(g: Group): Issue[] {
  const out: Issue[] = [];
  if (!g.name.trim()) out.push({ level: 'error', key: 'validate.noName' });
  const blocks = g.targets.filter((t) => !t.allow);
  if (!blocks.length) out.push({ level: 'error', key: 'validate.noTargets' });
  // #20: a rule over every website is allowed, but it should be a conscious choice.
  if (blocks.some((t) => t.type === 'wildcard' && t.value === ALL_SITES))
    out.push({ level: 'warning', key: 'validate.allSites' });
  out.push(...validateTargets(g.targets));
  out.push(...g.policies.flatMap(policyIssues));
  for (const e of unusedExceptions(g.targets)) {
    out.push({ level: 'info', key: 'validate.unusedException', params: { value: e.value } });
  }
  // Without a condition that blocks, the rule has no breaks (they are turned off when it is saved).
  if (g.pause.allowed && canHaveBreaks(g) && g.pause.maxMinutes <= 0)
    out.push({ level: 'error', key: 'validate.pauseDuration' });
  return out;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
