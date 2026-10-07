/** Configuration builders for end-to-end scenarios (plain data, as the dashboard saves it). */

import { parseTargetLine } from '../../../src/engine/patterns';

let n = 0;
const id = (p: string) => `${p}-${++n}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * A target in the text syntax a user types (src/engine/patterns.ts): "site.test" (domain and
 * subdomains), "=www.site.test" (host), "site.test/path", "site.test/page$" (exact page),
 * "site.test/$" (home page), "site.test/watch?list=*", "/^https?:…/" (regex), "+…" (exception).
 */
export function target(line: string, extra: Record<string, unknown> = {}) {
  const parsed = parseTargetLine(line);
  if (!parsed?.target) throw new Error(`not a target: ${line} (${parsed?.error})`);
  return { id: id('t'), ...parsed.target, ...extra };
}

export const ALWAYS = { mode: 'always', windows: [] };

/** A weekly window: days (0 = Sunday), start and end in minutes from midnight. */
export function window(days: number[], start: number, end: number) {
  return { days, start, end };
}
export const during = (...windows: ReturnType<typeof window>[]) => ({ mode: 'during', windows });
export const outside = (...windows: ReturnType<typeof window>[]) => ({ mode: 'outside', windows });
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

export function policy(intervention: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: id('p'), schedule: ALWAYS, intervention, ...extra };
}

export const timeBudget = (
  minutes: number,
  period: Record<string, unknown> = { kind: 'day' },
  more = {},
) => ({
  type: 'time',
  minutes,
  period,
  ...more,
});
export const visitBudget = (count: number, period: Record<string, unknown> = { kind: 'day' }, more = {}) => ({
  type: 'visits',
  count,
  period,
  ...more,
});
export const sessionBudget = (maxMinutes: number, cooldownMinutes: number, more = {}) => ({
  type: 'session',
  maxMinutes,
  cooldownMinutes,
  ...more,
});

// Interventions (INT-01…INT-07).
export const TRACK = { type: 'track' };
export const BLOCK = { type: 'block' };
export const CLOSE = { type: 'close' };
export const remind = (message = '') => ({ type: 'remind', message });
export const filter = (kind = 'grayscale', more: Record<string, unknown> = {}) => ({
  type: 'filter',
  filter: kind,
  intensity: 100,
  ...more,
});
export const redirect = (url: string) => ({ type: 'redirect', url });
export const delay = (seconds: number, more: Record<string, unknown> = {}) => ({
  type: 'delay',
  seconds,
  autoContinue: false,
  onBlur: 'ignore',
  hideCountdown: false,
  grant: { scope: 'site', mode: 'visit' },
  ...more,
});
export const ask = (more: Record<string, unknown> = {}) => ({
  type: 'ask',
  seconds: 0,
  choices: [5, 10],
  maxMinutes: 10,
  ...more,
});
export const challenge = (more: Record<string, unknown> = {}) => ({
  type: 'challenge',
  kind: 'random',
  length: 8,
  grant: { scope: 'site', mode: 'visit' },
  ...more,
});

export const pauseFree = {
  allowed: true,
  duringSessions: true,
  scopes: ['page', 'site', 'group', 'all'],
  duration: { mode: 'upTo', minutes: 30 },
  limit: { period: { kind: 'day' } },
  cost: { type: 'none' },
  reason: 'none',
  metered: false,
};

export function group(
  name: string,
  sites: string[],
  policies: unknown[],
  extra: Record<string, unknown> = {},
): any {
  return {
    id: id('g'),
    rev: 1,
    updatedAt: Date.now(),
    name,
    color: '#3a7d7c',
    icon: 'circle',
    note: `Note for ${name}`,
    message: '',
    enabled: true,
    archived: false,
    targets: sites.map((s) => target(s)),
    lists: [],
    policies,
    pause: pauseFree,
    protection: null,
    options: { privacy: 'all', embeds: false, tabs: 'all', timer: true, quickSession: true },
    ...extra,
  };
}

/** Today's weekday (0 = Sunday) in the browser's time zone (the same as the test runner's). */
export const today = () => new Date().getDay();
