/**
 * Readers of the specification for the `ids` check and the traceability generator: the
 * requirement items of docs/requirements.md, the circumvention routes of docs/threat-model.md,
 * the manual checks of docs/testing.md and the test titles that cite IDs.
 *
 * Requirement item format (one Markdown list item per ID, under the H2 of its area):
 *
 *   - <a id="pro-15"></a>**PRO-15 Emergency exit** · implemented · e2e
 *     The statement, on indented lines.
 *     Note: … (required when the status is partial or unverified)
 *   - <a id="foc-06"></a>**FOC-06 Pomodoro cycles** · planned · Should
 *   - <a id="us-01"></a>**US-01** · withdrawn
 *
 * The separator is " · " (a middle dot between spaces). The status is implemented, partial,
 * unverified, planned or withdrawn. Then come the verification methods (comma-separated: unit, e2e,
 * manual, ci, review, study) for the first three, the priority (Must, Should, Could) for planned
 * items, and nothing (or "—") for withdrawn items. Range lines ("US-01 to US-16 · withdrawn") are
 * not supported: every ID has its own item, so that it has its own anchor. A list item that starts
 * with `<a id=` or with an ID in bold but does not follow this format is reported, so other lists
 * in the document must not start that way.
 *
 * Circumvention routes: rows of the table under "Circumvention routes" in docs/threat-model.md
 * whose first cell is `<a id="cir-06"></a>CIR-06`; the columns named "Route" and "Status" are read.
 *
 * Manual checks: the list items under "Manual checks" in docs/testing.md. The IDs at the start of
 * an item, before its first colon, are the IDs it verifies: "- COMP-03, A11Y-04: On a phone, …".
 *
 * IDs in titles and text: AREA-NN with a known area prefix, anywhere in a test title (for a
 * template-literal title, in its static text before the first `${`). Shorthand such as
 * "A11Y-02/03" cites only A11Y-02. A range "ENF-02…ENF-12" (also "...", "–" or " to ") cites its
 * two ends and is not expanded.
 */

import { SPEC } from './config.mjs';
import { listItems, section, splitRow } from './md.mjs';
import { testTitles } from './source.mjs';

export const STATUSES = ['implemented', 'partial', 'unverified', 'planned', 'withdrawn'];
export const VERIFICATIONS = ['unit', 'e2e', 'manual', 'ci', 'review', 'study'];
export const PRIORITIES = ['Must', 'Should', 'Could'];

const ITEM_START = /^- (?:<a id="|\*\*[A-Z][A-Z0-9]*-\d{2}\b)/;
const ITEM =
  /^- <a id="([^"]+)"><\/a>\*\*([A-Z][A-Z0-9]*-\d{2})(?: ([^*]*[^*\s]))?\*\*(?: · ([a-z]+))?(?: · (.+?))?\s*$/;

/** The requirement items of the requirements document, by area (its H2), and parse problems. */
export function parseRequirements(doc, path = SPEC.requirements) {
  const items = [];
  const problems = [];
  const h2s = doc.headings.filter((h) => h.level === 2);
  for (const li of listItems(doc)) {
    if (!ITEM_START.test(`- ${li.lines[0]}`)) continue;
    const first = `- ${li.lines[0]}`;
    const m = first.match(ITEM);
    if (!m) {
      problems.push({
        path,
        line: li.line,
        message: `cannot read this requirement item; write '- <a id="pro-15"></a>**PRO-15 Title** · status · verification'.`,
      });
      continue;
    }
    const [, anchor, id, title = '', status, rest] = m;
    const area = h2s.filter((h) => h.line < li.line).at(-1);
    const body = li.lines.slice(1);
    const noteAt = body.findIndex((l) => /^Note:/.test(l));
    const item = {
      id,
      anchor,
      title,
      status,
      rest: rest ?? '',
      verification: [],
      priority: null,
      statement: (noteAt === -1 ? body : body.slice(0, noteAt)).join(' '),
      note:
        noteAt === -1
          ? ''
          : body
              .slice(noteAt)
              .join(' ')
              .replace(/^Note:\s*/, ''),
      area: area ? area.text : '',
      areaSlug: area ? area.slug : '',
      line: li.line,
    };
    const fail = (message) => problems.push({ path, line: li.line, message: `${id}: ${message}` });
    if (anchor !== id.toLowerCase()) fail(`the anchor must be "${id.toLowerCase()}", not "${anchor}".`);
    if (!STATUSES.includes(status)) fail(`unknown status '${status ?? ''}'; use ${STATUSES.join(', ')}.`);
    else if (status === 'planned') {
      if (!PRIORITIES.includes(item.rest))
        fail(`a planned item ends with its priority: ${PRIORITIES.join(', ')}.`);
      item.priority = item.rest;
    } else if (status === 'withdrawn') {
      if (item.rest && item.rest !== '—') fail('a withdrawn item has nothing after its status.');
    } else if (item.rest === '—' || item.rest === '') {
      item.verification = [];
    } else {
      item.verification = item.rest.split(/\s*,\s*/);
      const bad = item.verification.filter((v) => !VERIFICATIONS.includes(v));
      if (bad.length) fail(`unknown verification '${bad.join(', ')}'; use ${VERIFICATIONS.join(', ')}.`);
    }
    items.push(item);
  }
  return { items, problems };
}

/** The circumvention routes: { id, route, status, line }. */
export function parseRoutes(doc, path = SPEC.threatModel) {
  const routes = [];
  const problems = [];
  const sec = section(doc, SPEC.circumventionRoutes);
  if (!sec) return { routes, problems: [{ path, message: `no "Circumvention routes" section.` }] };
  let header = null;
  for (let i = sec.start; i < sec.end; i++) {
    const line = doc.lines[i];
    if (doc.code[i] || !line.trim().startsWith('|')) {
      header = null;
      continue;
    }
    const cells = splitRow(line);
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (/^:?-{3,}/.test(cells[0])) continue;
    const m = cells[0].match(/^<a id="([^"]+)"><\/a>(CIR-\d{2})$/);
    if (!m) {
      if (/CIR-\d{2}/.test(cells[0]))
        problems.push({ path, line: i + 1, message: `write the first cell as '<a id="cir-06"></a>CIR-06'.` });
      continue;
    }
    if (m[1] !== m[2].toLowerCase())
      problems.push({ path, line: i + 1, message: `${m[2]}: the anchor must be "${m[2].toLowerCase()}".` });
    const col = (name) => {
      const k = header.findIndex((h) => h.startsWith(name));
      return k === -1 ? '' : (cells[k] ?? '');
    };
    routes.push({ id: m[2], route: col('route'), status: col('status'), line: i + 1 });
  }
  return { routes, problems };
}

/** The manual checks: { ids, text, line }. */
export function parseManualChecks(doc) {
  const sec = section(doc, SPEC.manualChecks);
  if (!sec) return null;
  return listItems(doc, sec.start, sec.end).map((li) => {
    const head = li.text.split(':')[0];
    const ids = /^[\s*`]*[A-Z][A-Z0-9]*-\d{2}/.test(head)
      ? [...head.matchAll(/\b[A-Z][A-Z0-9]*-\d{2}\b/g)].map((m) => m[0])
      : [];
    return { ids, text: li.text.replace(/\s+/g, ' '), line: li.line };
  });
}

/** The regular expression of IDs with these area prefixes. */
export function idPattern(prefixes) {
  const alt = [...prefixes].sort((a, b) => b.length - a.length).join('|');
  return new RegExp(`(?<![A-Za-z0-9_-])(?:${alt || 'NO-PREFIX'})-\\d{2}(?![0-9])`, 'g');
}

const RANGE_SEP = /^\s*(?:…|\.\.\.|–|—|to)\s*$/;

/**
 * The IDs cited in a text: { id, index, inRange } for each, where inRange marks the ends of a
 * range such as "ENF-02…ENF-12".
 */
export function citedIds(text, re) {
  const found = [...text.matchAll(re)].map((m) => ({ id: m[0], index: m.index, inRange: false }));
  for (let k = 0; k + 1 < found.length; k++) {
    const a = found[k];
    const b = found[k + 1];
    const between = text.slice(a.index + a.id.length, b.index);
    if (RANGE_SEP.test(between) && a.id.split('-')[0] === b.id.split('-')[0]) {
      a.inRange = true;
      b.inRange = true;
    }
  }
  return found;
}

/**
 * The evidence in the test files: for each ID, the tests of each kind that cite it.
 * Returns Map<id, { unit: [{ file, title }], e2e: [...] }>. A describe title that cites an ID
 * counts for every test of its block and is listed once. Tests declared with skip, fixme, todo or
 * fail are not evidence.
 */
export function testEvidence(repo, re) {
  const evidence = new Map();
  const add = (id, kind, entry) => {
    if (!evidence.has(id)) evidence.set(id, { unit: [], e2e: [] });
    const list = evidence.get(id)[kind];
    if (!list.some((e) => e.file === entry.file && e.title === entry.title)) list.push(entry);
  };
  for (const [kind, pattern, folder] of [
    ['unit', SPEC.unitTests, 'tests/unit/'],
    ['e2e', SPEC.e2eTests, 'tests/e2e/'],
  ]) {
    for (const path of repo.match(pattern)) {
      const file = path.slice(folder.length);
      for (const t of testTitles(repo.read(path))) {
        if (!t.runs) continue;
        const ids = [...t.idText.matchAll(re)].map((m) => m[0]);
        const chain = [...t.describes.map((d) => d.title), t.title].join(' › ');
        const inherited = new Set(t.describes.flatMap((d) => [...d.idText.matchAll(re)].map((m) => m[0])));
        for (const id of ids) if (!inherited.has(id)) add(id, kind, { file, title: chain, line: t.line });
      }
    }
  }
  return evidence;
}
