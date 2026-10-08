/**
 * paths: a backticked repository path in a document exists (a file, a directory, or a glob that
 * matches at least one file). Paths start with src/, scripts/, tests/, docs/, static/ or .github/,
 * or are root files (package.json, README.md…); placeholders such as `<lang>` or `{x}` skip the
 * token. Line numbers go stale, so `file.ts:41` and links to `#L41` are refused.
 */

import { dirname, join, normalize } from 'node:path';
import { PATH_PREFIXES, ROOT_FILES } from '../config.mjs';
import { codeSpans } from '../md.mjs';

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}/?$`);
}

function isPath(token) {
  if (/\s/.test(token) || /[<>{}$]/.test(token)) return false;
  if (PATH_PREFIXES.some((p) => token.startsWith(p))) return true;
  const bare = token.replace(/:\d+(-\d+)?$/, '').replace(/#.*$/, '');
  return ROOT_FILES.includes(bare) || /^[A-Z][A-Z_]*\.md$/.test(bare) || /^[a-z0-9-]+\.md$/.test(bare);
}

export default {
  slug: 'paths',
  scope: 'file',
  description: 'backticked repository paths in documents exist, without line numbers',
  async run({ repo }) {
    const problems = [];
    for (const path of repo.markdown()) {
      const doc = repo.doc(path);
      doc.lines.forEach((line, i) => {
        if (doc.code[i]) return;
        for (const span of codeSpans(line)) {
          const token = span.text.trim();
          if (!isPath(token)) continue;
          const at = { path, line: i + 1 };
          if (/:\d+(-\d+)?$/.test(token)) {
            problems.push({ ...at, message: `${token}: line numbers go stale; cite the file or a symbol.` });
            continue;
          }
          const target = token.replace(/#.*$/, '');
          if (/[*?]/.test(target)) {
            const re = globToRegex(target.replace(/^\.\//, ''));
            if (!repo.files().some((f) => re.test(f)))
              problems.push({ ...at, message: `${token} matches no file.` });
            continue;
          }
          const candidates = target.includes('/')
            ? [target]
            : [target, normalize(join(dirname(path), target))];
          if (!candidates.some((c) => repo.exists(c)))
            problems.push({ ...at, message: `${token} does not exist.` });
        }
        for (const link of doc.links.filter((l) => l.line === i + 1)) {
          if (/#L\d+/.test(link.dest))
            problems.push({
              path,
              line: i + 1,
              message: `${link.dest}: line numbers go stale; link the file.`,
            });
        }
      });
    }
    return problems;
  },
};
