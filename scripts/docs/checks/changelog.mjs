/**
 * changelog: CHANGELOG.md follows Keep a Changelog 1.1.0. "## [Unreleased]" comes first; releases
 * are "## [X.Y.Z] - YYYY-MM-DD", newest first, never newer than package.json; H3 headings are only
 * Added, Changed, Deprecated, Removed, Fixed and Security, and none is empty; every bracketed
 * heading has a link definition.
 */

import { CHANGE_TYPES } from '../config.mjs';

const PATH = 'CHANGELOG.md';

function compare(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export default {
  slug: 'changelog',
  scope: 'file',
  description: 'CHANGELOG.md follows Keep a Changelog: headings, order, dates, link definitions',
  async run({ repo }) {
    const doc = repo.doc(PATH);
    if (!doc) return [{ path: PATH, message: 'does not exist.' }];
    const version = JSON.parse(repo.read('package.json')).version;
    const problems = [];
    const fail = (line, message) => problems.push({ path: PATH, line, message });
    const defs = new Set(doc.links.filter((l) => l.kind === 'def').map((l) => l.label.toLowerCase()));
    const h2 = doc.headings.filter((h) => h.level === 2);
    if (!h2.length || h2[0].raw !== '[Unreleased]')
      fail(h2[0]?.line, `the first H2 must be '## [Unreleased]'.`);
    let previous = null;
    for (const h of h2) {
      if (h.raw === '[Unreleased]') {
        if (h !== h2[0]) fail(h.line, `'## [Unreleased]' must be the first H2.`);
        if (!defs.has('unreleased'))
          fail(h.line, `add a link definition '[Unreleased]: <url>' at the end of the file.`);
        continue;
      }
      const m = h.raw.match(/^\[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/);
      if (!m) {
        fail(h.line, `'## ${h.raw}' must be '## [X.Y.Z] - YYYY-MM-DD'.`);
        continue;
      }
      if (!defs.has(m[1])) fail(h.line, `add a link definition '[${m[1]}]: <url>' at the end of the file.`);
      if (compare(m[1], version) > 0)
        fail(h.line, `release ${m[1]} is newer than package.json (${version}).`);
      if (previous && (compare(m[1], previous.version) >= 0 || m[2] > previous.date))
        fail(h.line, `releases go newest first: ${m[1]} comes after ${previous.version}.`);
      previous = { version: m[1], date: m[2] };
    }
    const all = doc.headings;
    all.forEach((h, k) => {
      if (h.level !== 3) return;
      if (!CHANGE_TYPES.includes(h.text))
        fail(h.line, `'### ${h.text}' is not a change type; use ${CHANGE_TYPES.join(', ')}.`);
      const next = all[k + 1];
      const body = doc.lines.slice(h.line, next ? next.line - 1 : doc.lines.length);
      if (!body.some((l) => l.trim() && !/^\[[^\]]+\]:/.test(l)))
        fail(h.line, `'### ${h.text}' is empty: remove it.`);
    });
    return problems;
  },
};
