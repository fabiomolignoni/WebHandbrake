/**
 * docs-index: docs/README.md links every document under docs/ (the ADRs through
 * docs/adr/README.md, which is generated and lists them all), and every document it links exists.
 */

import { dirname, join, normalize } from 'node:path';

const INDEX = 'docs/README.md';

export default {
  slug: 'docs-index',
  scope: 'global',
  description: 'docs/README.md lists every document under docs/',
  async run({ repo }) {
    const doc = repo.doc(INDEX);
    if (!doc) return [{ path: INDEX, message: 'does not exist; it is the index of docs/.' }];
    const problems = [];
    const linked = new Set();
    for (const link of doc.links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link.dest) || link.dest.startsWith('#')) continue;
      const target = normalize(join(dirname(INDEX), decodeURIComponent(link.dest.split('#')[0])));
      linked.add(target);
      if (!repo.exists(target))
        problems.push({ path: INDEX, line: link.line, message: `${link.dest} does not exist.` });
    }
    for (const path of repo.match(/^docs\/.*\.md$/)) {
      if (path === INDEX || linked.has(path)) continue;
      if (/^docs\/adr\/\d{4}-/.test(path)) continue;
      problems.push({ path, message: `is not listed in ${INDEX}.` });
    }
    return problems;
  },
};
