/**
 * references: each entry of docs/principles.md#references has an anchor `ref-<key>`, says what it
 * was checked against ("Checked against: full text" or "Checked against: abstract"), and is cited
 * by at least one link to it (`#ref-<key>` in principles.md, `principles.md#ref-<key>` elsewhere).
 */

import { listItems, section } from '../md.mjs';

const PATH = 'docs/principles.md';

export default {
  slug: 'references',
  scope: 'global',
  description: 'every reference in principles.md is cited and says what it was checked against',
  async run({ repo }) {
    const doc = repo.doc(PATH);
    if (!doc) return [{ path: PATH, message: 'does not exist; it holds the reference list.' }];
    const sec = section(doc, 'references');
    if (!sec) return [{ path: PATH, message: `has no '## References' section.` }];
    const problems = [];
    const entries = [];
    for (const item of listItems(doc, sec.start, sec.end)) {
      const id = item.text.match(/<a id="(ref-[^"]+)"><\/a>/)?.[1];
      if (!id) {
        problems.push({
          path: PATH,
          line: item.line,
          message: `start the entry with <a id="ref-<key>"></a>.`,
        });
        continue;
      }
      if (!/Checked against: (full text|abstract)/i.test(item.text.replace(/[*_]/g, '')))
        problems.push({
          path: PATH,
          line: item.line,
          message: `${id}: add 'Checked against: full text' or 'Checked against: abstract'.`,
        });
      entries.push({ id, line: item.line });
    }
    const cited = new Set();
    for (const path of repo.markdown()) {
      for (const link of repo.doc(path).links) {
        const m = link.dest.match(/^(?:(?:\.\.?\/)*(?:docs\/)?principles\.md)?#(ref-[\w-]+)$/);
        if (!m) continue;
        if (!link.dest.startsWith('#') || path === PATH) cited.add(m[1]);
      }
    }
    for (const e of entries)
      if (!cited.has(e.id))
        problems.push({
          path: PATH,
          line: e.line,
          message: `${e.id} is not cited anywhere; cite it or remove it.`,
        });
    return problems;
  },
};
