/**
 * toolchain: .nvmrc holds an exact Node version that satisfies package.json engines.node; every
 * actions/setup-node step reads it (`node-version-file: .nvmrc`); the licence is
 * GPL-3.0-or-later (ADR 0003); the runtime dependencies are exactly preact (ADR 0002).
 */

import { LICENSE_ID, RUNTIME_DEPENDENCIES } from '../config.mjs';

/** Whether a version satisfies a range made of ||-separated sets of ^, ~, >=, >, <=, <, = or x. */
export function satisfies(version, range) {
  const v = version.split('.').map(Number);
  const cmp = (a, b) => {
    for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    return 0;
  };
  const one = (c) => {
    const m = c.match(/^(\^|~|>=|<=|>|<|=)?v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/);
    if (!m) return false;
    const [, op = '', ...parts] = m;
    const nums = parts.filter((p) => p !== undefined && p !== 'x' && p !== '*').map(Number);
    if (op === '^') {
      const lo = [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
      const k = lo.findIndex((n) => n !== 0);
      const hi = k === -1 ? [lo[0] + 1, 0, 0] : lo.map((n, i) => (i < k ? n : i === k ? n + 1 : 0));
      return cmp(v, lo) >= 0 && cmp(v, hi) < 0;
    }
    if (op === '~') {
      const lo = [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
      const hi = nums.length > 1 ? [lo[0], lo[1] + 1, 0] : [lo[0] + 1, 0, 0];
      return cmp(v, lo) >= 0 && cmp(v, hi) < 0;
    }
    if (op === '' || op === '=') return nums.every((n, i) => v[i] === n);
    const c2 = cmp(v, nums);
    return { '>=': c2 >= 0, '<=': c2 <= 0, '>': c2 > 0, '<': c2 < 0 }[op];
  };
  return range
    .split('||')
    .map((set) => set.trim().split(/\s+/).filter(Boolean))
    .some((set) => set.length > 0 && set.every(one));
}

export default {
  slug: 'toolchain',
  scope: 'global',
  description: '.nvmrc satisfies engines and is used by CI; licence and runtime dependencies',
  async run({ repo }) {
    const problems = [];
    const pkg = JSON.parse(repo.read('package.json'));
    const nvmrc = repo.read('.nvmrc')?.trim();
    if (!nvmrc)
      problems.push({ path: '.nvmrc', message: 'is missing: it pins the Node version of the build.' });
    else if (!/^\d+\.\d+\.\d+$/.test(nvmrc))
      problems.push({ path: '.nvmrc', line: 1, message: `'${nvmrc}' must be an exact version (X.Y.Z).` });
    else if (!pkg.engines?.node)
      problems.push({ path: 'package.json', message: 'has no engines.node range.' });
    else if (!satisfies(nvmrc, pkg.engines.node))
      problems.push({
        path: '.nvmrc',
        line: 1,
        message: `${nvmrc} does not satisfy engines.node '${pkg.engines.node}'.`,
      });

    for (const path of repo.match(/^\.github\/workflows\/[^/]+\.ya?ml$/)) {
      const lines = repo.read(path).split('\n');
      lines.forEach((line, i) => {
        if (!/uses:\s*actions\/setup-node@/.test(line)) return;
        const indent = line.search(/\S/);
        const stepIndent = line.trimStart().startsWith('-') ? indent : indent - 2;
        const step = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && lines[j].search(/\S/) <= stepIndent) break;
          step.push(lines[j]);
        }
        const body = step.join('\n');
        if (/node-version:/.test(body))
          problems.push({ path, line: i + 1, message: 'pins node-version; use node-version-file: .nvmrc.' });
        else if (!/node-version-file:\s*['"]?\.nvmrc['"]?/.test(body))
          problems.push({ path, line: i + 1, message: 'set node-version-file: .nvmrc.' });
      });
    }

    if (pkg.license !== LICENSE_ID)
      problems.push({
        path: 'package.json',
        message: `license is '${pkg.license}'; ADR 0003 chose ${LICENSE_ID}.`,
      });
    const deps = Object.keys(pkg.dependencies ?? {}).sort();
    if (deps.join(',') !== [...RUNTIME_DEPENDENCIES].sort().join(','))
      problems.push({
        path: 'package.json',
        message: `runtime dependencies are ${deps.join(', ') || 'none'}; ADR 0002 allows only ${RUNTIME_DEPENDENCIES.join(', ')}.`,
      });
    return problems;
  },
};
