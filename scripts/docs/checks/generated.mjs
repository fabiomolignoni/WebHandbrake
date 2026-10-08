/**
 * generated: every generated file equals what its generator produces now, and every fact marker
 * in a Markdown file holds the value of its fact in the code.
 */

import { render } from '../facts.mjs';
import { factMarkers } from '../md.mjs';

export default {
  slug: 'generated',
  scope: 'file',
  description: 'generated files are up to date and every fact marker equals the code',
  async run({ repo, generators, factsSelected, inScope, facts: loadFacts }) {
    const problems = [];
    for (const g of generators) {
      if (!inScope(g.output)) continue;
      let result;
      try {
        result = await g.generate(repo);
      } catch (e) {
        problems.push({ path: g.output, message: e.message });
        continue;
      }
      if (typeof result !== 'string') {
        problems.push({ path: g.output, message: `cannot be generated: ${result.skip}.` });
        continue;
      }
      if (repo.read(g.output) !== result)
        problems.push({ path: g.output, message: `is out of date: run npm run docs and commit the result.` });
    }
    if (!factsSelected) return problems;
    const outputs = new Set(generators.map((g) => g.output));
    const { facts, errors } = await loadFacts();
    for (const e of errors) problems.push({ path: 'scripts/docs/facts.mjs', message: e });
    for (const path of repo.markdown()) {
      if (outputs.has(path) || !inScope(path)) continue;
      for (const mk of factMarkers(repo.doc(path))) {
        const r = render(facts, mk.name, mk.transforms);
        if (r.error) problems.push({ path, line: mk.line, message: r.error });
        else if (r.value !== mk.value)
          problems.push({
            path,
            line: mk.line,
            message: `fact ${mk.name} is ${r.value} in code but ${mk.value || '(empty)'} here: run npm run docs.`,
          });
      }
    }
    return problems;
  },
};
