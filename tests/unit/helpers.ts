import { compileConfig } from '../../src/engine/compile';
import type { EngineContext } from '../../src/engine/decide';
import { defaultConfig, defaultState, newGroup, newPolicy } from '../../src/engine/defaults';
import { parseTargetLine } from '../../src/engine/patterns';
import type { Config, Group, Intervention, Policy, RuntimeState, Target } from '../../src/engine/types';
import { Usage } from '../../src/engine/usage';

let n = 0;
export function t(line: string): Target {
  const r = parseTargetLine(line);
  if (!r?.target) throw new Error(`bad target ${line}: ${r?.error}`);
  return { id: `t${++n}`, ...r.target };
}

export function group(
  name: string,
  lines: string[],
  policies: Partial<Policy>[] = [],
  extra: Partial<Group> = {},
): Group {
  return newGroup({
    id: name,
    name,
    targets: lines.map(t),
    policies: policies.map((p, i) => newPolicy({ id: `${name}-p${i}`, ...p })),
    ...extra,
  });
}

export function config(groups: Group[], patch: (c: Config) => void = () => {}): Config {
  const c = defaultConfig();
  c.groups = groups;
  patch(c);
  return c;
}

export function ctx(
  c: Config,
  now: number,
  state: RuntimeState = defaultState(),
  usage = new Usage(),
): EngineContext {
  return { cc: compileConfig(c), state, usage, now };
}

export const BLOCK: Intervention = { type: 'block' };

/** Local time helper: 2026-10-05 is a Monday. */
export function at(day: number, hh: number, mm = 0): number {
  return new Date(2026, 9, 5 + day, hh, mm).getTime();
}
