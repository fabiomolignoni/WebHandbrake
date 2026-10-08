/**
 * markdown: every Markdown file has exactly one H1, which comes first; heading levels never skip
 * (H2 to H4); the file ends with a newline; no TODO, TBD or FIXME is left outside code.
 */

import { NO_H1 } from '../config.mjs';
import { blankCodeSpans } from '../md.mjs';

export default {
  slug: 'markdown',
  scope: 'file',
  description: 'one H1 first, no skipped heading level, final newline, no TODO/TBD/FIXME',
  async run({ repo }) {
    const problems = [];
    for (const path of repo.markdown()) {
      const doc = repo.doc(path);
      const fail = (message, line) => problems.push({ path, line, message });
      const h1 = doc.headings.filter((h) => h.level === 1);
      if (!NO_H1.includes(path)) {
        if (h1.length === 0) fail('has no H1.');
        for (const h of h1.slice(1)) fail(`has a second H1 '${h.text}'; use H2.`, h.line);
        if (doc.headings.length && doc.headings[0].level !== 1)
          fail(`the first heading must be the H1.`, doc.headings[0].line);
      }
      let level = NO_H1.includes(path) ? 1 : 0;
      for (const h of doc.headings) {
        if (level && h.level > level + 1) fail(`heading jumps from H${level} to H${h.level}.`, h.line);
        level = h.level;
      }
      if (doc.src.length && !doc.src.endsWith('\n')) fail('does not end with a newline.', doc.lines.length);
      doc.lines.forEach((line, i) => {
        if (doc.code[i]) return;
        const m = blankCodeSpans(line).match(/\b(TODO|TBD|FIXME)\b/);
        if (m) fail(`'${m[1]}' left in the text: finish it or remove it.`, i + 1);
      });
    }
    return problems;
  },
};
