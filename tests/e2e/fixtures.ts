/** Configuration builders for end-to-end tests. */

let n = 0;
const id = (p: string) => `${p}-${++n}`;

export function target(value: string, extra: Record<string, unknown> = {}) {
  let type = 'domain';
  let v = value;
  let allow = false;
  if (v.startsWith('+')) {
    allow = true;
    v = v.slice(1);
  }
  if (v.includes('/')) type = 'path';
  return { id: id('t'), type, value: v, ...(allow ? { allow: true } : {}), ...extra };
}

export function policy(intervention: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: id('p'), schedule: { mode: 'always', windows: [] }, intervention, ...extra };
}

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
) {
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

export const BLOCK = { type: 'block' };
export const delay = (seconds: number) => ({
  type: 'delay',
  seconds,
  autoContinue: false,
  onBlur: 'ignore',
  hideCountdown: false,
  grant: { scope: 'site', mode: 'visit' },
});
