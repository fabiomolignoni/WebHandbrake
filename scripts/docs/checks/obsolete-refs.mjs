/**
 * obsolete-refs: nothing cites the deleted documents or their numbering. No "requisiti",
 * "ux-redesign" or "Appendix A"; no "§" followed by a number, except on lines about an external
 * specification (WebDriver, W3C); in code comments, no bare decision label D1–D11 and no principle
 * label G1–G10 unless written "principle G1".
 */

import { isCode, SECTION_SIGN_ALLOWED, TOOLS_DIR } from '../config.mjs';
import { comments } from '../source.mjs';

const OLD_DOCS = /requisiti|ux-redesign|Appendix A/gi;
const SECTION = /§\s?\d/g;
const DECISION = /(?<![\w-])D(1[01]|[1-9])(?![\w-])/g;
const PRINCIPLE = /(?<![\w-])G(10|[1-9])(?![\w-])/g;

export default {
  slug: 'obsolete-refs',
  scope: 'file',
  description: 'no citations of the deleted documents, section numbers or bare D/G labels in comments',
  async run({ repo }) {
    const problems = [];
    for (const path of repo.files()) {
      const md = path.endsWith('.md');
      if ((!md && !isCode(path)) || path.startsWith(TOOLS_DIR)) continue;
      const text = repo.read(path);
      if (text === null || text.includes('\0')) continue;
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(OLD_DOCS))
          problems.push({
            path,
            line: i + 1,
            message: `cites '${m[0]}', which no longer exists: cite the requirement ID or the new document.`,
          });
        if (!SECTION_SIGN_ALLOWED.test(line))
          for (const m of line.matchAll(SECTION))
            problems.push({
              path,
              line: i + 1,
              message: `cites '${m[0]}': cite a requirement ID or a document anchor (docs/<file>.md#<heading>), never a section number.`,
            });
      });
      if (md) continue;
      for (const c of comments(path, text)) {
        for (const m of c.text.matchAll(DECISION))
          problems.push({
            path,
            line: c.line,
            message: `cites the decision label '${m[0]}': cite the ADR or requirement instead.`,
          });
        for (const m of c.text.matchAll(PRINCIPLE))
          if (!/principles?\b[^.]*$/i.test(c.text.slice(0, m.index)))
            problems.push({
              path,
              line: c.line,
              message: `write 'principle ${m[0]}', not a bare '${m[0]}'.`,
            });
      }
    }
    return problems;
  },
};
