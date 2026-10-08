/**
 * links: relative links and images in Markdown resolve, and their #anchors match a heading or an
 * explicit id of the target; "ADR NNNN" names an existing record; references to documents in code
 * (`docs/x.md#anchor`) resolve; links to this repository's files on GitHub
 * (…/blob/main/<path>, …/tree/main/<path>, written literally or after `${REPO_URL}`) and to its
 * issue forms (…/issues/new?template=<form>) resolve. A path that contains `${` is skipped.
 */

import { dirname, join, normalize } from 'node:path';
import { isCode, REPO_URL, TOOLS_DIR } from '../config.mjs';
import { blankCodeSpans } from '../md.mjs';

const REPO_LINK = new RegExp(
  `(?:${REPO_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}|\\$\\{REPO_URL\\})/(blob|tree)/main/([^\\s)'"\`>\\]]+)`,
  'g',
);
const ISSUE_FORM = new RegExp(
  `${REPO_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/issues/new\\?(?:[^\\s)'"\`>]*&)?template=([\\w.-]+)`,
  'g',
);
const ADR_CITATION = /\bADR[ -](\d{4})\b/g;
const DOC_REF = /(?<![\w./-])((?:docs\/)?[\w.-]+(?:\/[\w.-]+)*\.md)(#[\w-]+)?(?![\w/])/g;

/** The closest anchor, for the failure message. */
function closest(anchors, want) {
  let best = null;
  let score = -1;
  for (const a of anchors) {
    const common = a.split('-').filter((w) => want.split('-').includes(w)).length;
    if (common > score) {
      best = a;
      score = common;
    }
  }
  return best;
}

function checkTarget(repo, from, line, target, problems) {
  const [rawPath, anchor] = target.split('#');
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    path = rawPath;
  }
  const resolved =
    path === '' ? from : normalize(path.startsWith('/') ? path.slice(1) : join(dirname(from), path));
  if (path !== '' && !repo.exists(resolved)) {
    problems.push({ path: from, line, message: `${target}: ${resolved} does not exist.` });
    return;
  }
  if (anchor === undefined || !resolved.endsWith('.md')) return;
  const doc = repo.doc(resolved);
  if (!doc) return;
  if (!doc.anchors.has(anchor)) {
    const near = closest(doc.anchors, anchor);
    problems.push({
      path: from,
      line,
      message: `${resolved}#${anchor} has no such heading${near ? ` (closest: #${near})` : ''}.`,
    });
  }
}

function checkRepoUrls(repo, path, line, text, problems) {
  for (const m of text.matchAll(REPO_LINK)) {
    const target = m[2].replace(/[.,;:]+$/, '').split(/[?#]/)[0];
    if (target.includes('${') || target.includes('$')) continue;
    if (!repo.exists(target))
      problems.push({ path, line, message: `${m[0]}: ${target} does not exist on main.` });
  }
  for (const m of text.matchAll(ISSUE_FORM)) {
    if (!repo.exists(`.github/ISSUE_TEMPLATE/${m[1]}`))
      problems.push({ path, line, message: `issue form ${m[1]} does not exist in .github/ISSUE_TEMPLATE.` });
  }
}

function checkAdrs(repo, path, line, text, problems) {
  for (const m of text.matchAll(ADR_CITATION)) {
    if (!repo.files().some((f) => f.startsWith(`docs/adr/${m[1]}-`)))
      problems.push({ path, line, message: `ADR ${m[1]} does not exist in docs/adr.` });
  }
}

export default {
  slug: 'links',
  scope: 'file',
  description: 'relative links, anchors, "ADR NNNN" citations and links to this repository resolve',
  async run({ repo }) {
    const problems = [];
    for (const path of repo.markdown()) {
      const doc = repo.doc(path);
      for (const link of doc.links) {
        const dest = link.dest.trim();
        if (/^[a-z][a-z0-9+.-]*:/i.test(dest)) {
          checkRepoUrls(repo, path, link.line, dest, problems);
          continue;
        }
        if (dest.startsWith('//')) continue;
        checkTarget(repo, path, link.line, dest, problems);
      }
      doc.lines.forEach((line, i) => {
        if (doc.code[i]) return;
        const prose = blankCodeSpans(line);
        checkAdrs(repo, path, i + 1, prose, problems);
        for (const m of prose.matchAll(/<(https?:\/\/[^>\s]+)>/g))
          checkRepoUrls(repo, path, i + 1, m[1], problems);
      });
    }
    for (const path of repo.files()) {
      if (!isCode(path) || path.startsWith(TOOLS_DIR)) continue;
      const text = repo.read(path);
      if (text === null || text.includes('\0')) continue;
      text.split('\n').forEach((line, i) => {
        checkAdrs(repo, path, i + 1, line, problems);
        checkRepoUrls(repo, path, i + 1, line, problems);
        for (const m of line.matchAll(DOC_REF)) {
          if (line.slice(Math.max(0, m.index - 30), m.index).match(/\/(blob|tree)\/main\/$/)) continue;
          const file = m[1];
          if (!file.startsWith('docs/') && !/^[A-Z_]+\.md$/.test(file)) continue;
          if (!repo.exists(file)) {
            problems.push({ path, line: i + 1, message: `${file} does not exist.` });
            continue;
          }
          if (m[2]) checkTarget(repo, path, i + 1, `/${file}${m[2]}`, problems);
        }
      });
    }
    return problems;
  },
};
