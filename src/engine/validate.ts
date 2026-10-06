/** ONB-04: validation that prevents configurations that block nothing, with clear messages. */

import { unusedExceptions } from './changes';
import { checkRegex } from './patterns';
import type { Config, Group, Policy, Target } from './types';

export interface Issue {
  level: 'error' | 'warning' | 'info';
  /** i18n key */
  key: string;
  params?: Record<string, string | number>;
  policy?: number;
}

function policyIssues(p: Policy, i: number): Issue[] {
  const out: Issue[] = [];
  const n = i + 1;
  if (p.schedule.mode !== 'always') {
    if (!p.schedule.windows.length) {
      out.push({
        level: p.schedule.mode === 'during' ? 'error' : 'warning',
        key: p.schedule.mode === 'during' ? 'validate.noWindows' : 'validate.outsideNoWindows',
        params: { n },
        policy: i,
      });
    }
    p.schedule.windows.forEach((w) => {
      if (!w.days.length) out.push({ level: 'error', key: 'validate.noDays', params: { n }, policy: i });
      if (w.start === w.end && !(w.start === 0))
        out.push({ level: 'warning', key: 'validate.emptyWindow', params: { n }, policy: i });
    });
  }
  const b = p.budget;
  if (b) {
    if (b.type === 'time' && b.minutes <= 0)
      out.push({ level: 'warning', key: 'validate.zeroBudget', params: { n }, policy: i });
    if (b.type === 'visits' && b.count <= 0)
      out.push({ level: 'warning', key: 'validate.zeroVisits', params: { n }, policy: i });
  }
  const iv = p.intervention;
  if (iv.type === 'redirect' && !isRedirectUrl(iv.url)) {
    out.push({ level: 'error', key: 'validate.redirectUrl', params: { n }, policy: i });
  }
  if (iv.type === 'challenge' && iv.kind === 'phrase' && !iv.phrase?.trim()) {
    out.push({ level: 'error', key: 'validate.phrase', params: { n }, policy: i });
  }
  if (iv.type === 'ask' && !iv.choices.some((c) => c <= iv.maxMinutes)) {
    out.push({ level: 'error', key: 'validate.askChoices', params: { n }, policy: i });
  }
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

export function validateGroup(g: Group, config: Config): Issue[] {
  const out: Issue[] = [];
  if (!g.name.trim()) out.push({ level: 'error', key: 'validate.noName' });
  const listTargets = config.lists.filter((l) => g.lists.includes(l.id)).flatMap((l) => l.targets);
  const blocks = [...g.targets, ...listTargets].filter((t) => !t.allow);
  if (!blocks.length) out.push({ level: 'error', key: 'validate.noTargets' });
  out.push(...validateTargets(g.targets));
  if (!g.policies.length) out.push({ level: 'warning', key: 'validate.noPolicies' });
  let unconditional = -1;
  g.policies.forEach((p, i) => {
    out.push(...policyIssues(p, i));
    if (unconditional !== -1) {
      out.push({
        level: 'warning',
        key: 'validate.unreachable',
        params: { n: i + 1, m: unconditional + 1 },
        policy: i,
      });
    } else if (p.schedule.mode === 'always' && !p.budget) unconditional = i;
  });
  if (
    g.policies.length &&
    g.policies.every((p) => p.intervention.type === 'track' || p.intervention.type === 'allow')
  ) {
    out.push({ level: 'info', key: 'validate.onlyTracking' });
  }
  for (const e of unusedExceptions([...g.targets, ...listTargets])) {
    out.push({ level: 'info', key: 'validate.unusedException', params: { value: e.value } });
  }
  if (g.pause.allowed && g.pause.duration.minutes <= 0)
    out.push({ level: 'error', key: 'validate.pauseDuration' });
  return out;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
