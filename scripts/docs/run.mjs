#!/usr/bin/env node
/**
 * The documentation tools: generators write the files that are generated from the code, and
 * checks keep the documents consistent with the code and with each other.
 *
 *   npm run docs                 write the generated files and the fact values
 *   npm run docs:check           verify everything; exit code 1 on any problem
 *
 * Options (after `--`, for example `npm run docs:check -- --only links,markdown`):
 *   --only <name,…>   run only these generators or checks; `facts` names the fact markers
 *   --files <path,…>  limit per-file checks, the generated files and the fact markers to these
 *                     files or directories (global checks still run whole)
 *   --list            list the generators and the checks
 *
 * Every problem is printed as `path:line: [check] message`.
 */

import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadFacts, render } from './facts.mjs';
import { factMarkers } from './md.mjs';
import { Repo } from './repo.mjs';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

async function load(dir) {
  const names = (await readdir(join(here, dir))).filter((f) => f.endsWith('.mjs')).sort();
  return Promise.all(names.map(async (f) => (await import(pathToFileURL(join(here, dir, f)).href)).default));
}

function parseArgs(argv) {
  const opts = { check: false, only: null, files: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const [, inline] = a.split('=');
      if (inline !== undefined) return inline;
      i++;
      return argv[i] ?? '';
    };
    const list = (v) =>
      v
        .split(',')
        .map((x) => x.trim().replace(/^\.\//, '').replace(/\/$/, ''))
        .filter(Boolean);
    if (a === '--check') opts.check = true;
    else if (a === '--list') opts.list = true;
    else if (a.startsWith('--only')) opts.only = list(value());
    else if (a.startsWith('--files')) opts.files = list(value());
    else {
      console.error(
        `docs: unknown option '${a}'. Options: --check, --only <names>, --files <paths>, --list.`,
      );
      process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const generators = await load('generators');
const checks = await load('checks');

if (opts.list) {
  console.log('Generators (npm run docs writes them; the generated check compares them):');
  for (const g of generators) console.log(`  ${g.name.padEnd(16)} ${g.description}`);
  console.log('Checks (npm run docs:check):');
  for (const c of checks) console.log(`  ${c.slug.padEnd(16)} ${c.description}`);
  process.exit(0);
}

const known = new Set([...generators.map((g) => g.name), ...checks.map((c) => c.slug), 'facts']);
const unknown = (opts.only ?? []).filter((n) => !known.has(n));
if (unknown.length) {
  console.error(`docs: unknown name '${unknown.join(', ')}'. Valid names: ${[...known].join(', ')}.`);
  process.exit(2);
}

const repo = new Repo(root);
const inScope = (path) =>
  !opts.files || !path || opts.files.some((f) => path === f || path.startsWith(`${f}/`) || f === '.');
const only = opts.only ? new Set(opts.only) : null;
const selectedGenerators = generators.filter((g) => !only || only.has(g.name) || only.has('generated'));
const factsSelected = !only || only.has('facts') || only.has('generated');

let factsCache = null;
const ctx = {
  repo,
  opts,
  generators: selectedGenerators,
  factsSelected,
  inScope,
  facts: async () => {
    factsCache ??= await loadFacts(repo);
    return factsCache;
  },
};

const problems = [];

if (!opts.check) {
  const written = [];
  for (const g of selectedGenerators) {
    if (!inScope(g.output)) continue;
    let result;
    try {
      result = await g.generate(repo);
    } catch (e) {
      problems.push({ path: g.output, slug: g.name, message: e.message });
      continue;
    }
    if (typeof result !== 'string') {
      console.log(`docs: skipped ${g.output}: ${result.skip}.`);
      continue;
    }
    if (repo.read(g.output) !== result) {
      repo.write(g.output, result);
      written.push(g.output);
    }
  }
  let updated = 0;
  if (factsSelected) {
    const { facts, errors } = await ctx.facts();
    for (const e of errors) problems.push({ path: 'scripts/docs/facts.mjs', slug: 'facts', message: e });
    const outputs = new Set(generators.map((g) => g.output));
    for (const path of repo.markdown()) {
      if (!inScope(path) || outputs.has(path)) continue;
      const doc = repo.doc(path);
      const markers = factMarkers(doc);
      if (!markers.length) continue;
      const lines = [...doc.lines];
      for (const mk of markers.reverse()) {
        const r = render(facts, mk.name, mk.transforms);
        if (r.error) {
          problems.push({ path, line: mk.line, slug: 'facts', message: r.error });
          continue;
        }
        if (r.value === mk.value) continue;
        const line = lines[mk.line - 1];
        const text = `<!-- fact: ${mk.name}${mk.transforms.map((t) => `|${t}`).join('')} -->${r.value}<!-- /fact -->`;
        lines[mk.line - 1] = line.slice(0, mk.index) + text + line.slice(mk.index + mk.length);
        updated++;
      }
      const text = lines.join('\n');
      if (text !== doc.src) {
        repo.write(path, text);
        written.push(path);
      }
    }
  }
  for (const p of written) console.log(`docs: wrote ${p}`);
  if (!problems.length) {
    console.log(
      `docs ok: ${plural(written.length, 'file')} written, ${plural(updated, 'fact value')} updated`,
    );
    process.exit(0);
  }
} else {
  const selected = checks.filter(
    (c) =>
      !only ||
      only.has(c.slug) ||
      (c.slug === 'generated' && (generators.some((g) => only.has(g.name)) || only.has('facts'))),
  );
  for (const c of selected) {
    let found;
    try {
      found = await c.run(ctx);
    } catch (e) {
      found = [{ path: 'scripts/docs', message: `the ${c.slug} check failed: ${e.stack ?? e.message}` }];
    }
    for (const p of found) {
      if (c.scope === 'file' && !inScope(p.path)) continue;
      problems.push({ ...p, slug: c.slug });
    }
  }
  if (!problems.length) {
    const n = selected.some((c) => c.slug === 'generated')
      ? ctx.generators.filter((g) => inScope(g.output)).length
      : 0;
    console.log(
      `docs ok: ${plural(n, 'generated file')} up to date, ${plural(selected.length, 'check')} passed`,
    );
    process.exit(0);
  }
}

problems.sort((a, b) => (a.path ?? '').localeCompare(b.path ?? '') || (a.line ?? 0) - (b.line ?? 0));
const lines = [
  ...new Set(problems.map((p) => `${p.path}${p.line ? `:${p.line}` : ''}: [${p.slug}] ${p.message}`)),
];
for (const line of lines) console.log(line);
console.log(`docs: ${plural(lines.length, 'problem')}`);
process.exit(1);
