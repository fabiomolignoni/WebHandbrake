/**
 * Markdown helpers for the documentation tools: fenced-code-aware line scanning, GitHub heading
 * slugs, explicit anchors, links, code spans, tables, list items and fact markers.
 *
 * The parser is line-based and covers the Markdown the repository uses (GitHub Flavored Markdown):
 * ATX and setext headings, fenced code (``` and ~~~), multi-line HTML comments, inline and
 * reference links, images, `<a id>` anchors and pipe tables. Indented code blocks are not
 * recognised, because list continuations use indentation.
 */

/** A fact marker: `<!-- fact: name|transform -->value<!-- /fact -->`, on one line. */
export const FACT_RE = /<!--\s*fact:\s*([^\s|>]+)((?:\|[A-Za-z]+)*)\s*-->(.*?)<!--\s*\/fact\s*-->/g;

/**
 * GitHub's heading slug (github-slugger): lower case, punctuation and symbols removed, each space
 * replaced by a hyphen. Letters, marks, numbers, `_` and `-` are kept.
 */
export function githubSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Slugs for one document: a repeated slug gets -1, -2… as on GitHub. */
export function slugger() {
  const occurrences = new Map();
  return (text) => {
    const original = githubSlug(text);
    let slug = original;
    while (occurrences.has(slug)) {
      occurrences.set(original, occurrences.get(original) + 1);
      slug = `${original}-${occurrences.get(original)}`;
    }
    occurrences.set(slug, 0);
    return slug;
  };
}

/** The text GitHub renders for a heading's inline Markdown (used for the slug). */
export function headingText(raw) {
  return raw
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1$2')
    .replace(/\*\*|`/g, '')
    .replace(/\\(.)/g, '$1')
    .trim();
}

/** The code spans of one line: their content and their columns, delimiters included. */
export function codeSpans(line) {
  const spans = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\\') {
      i += 2;
      continue;
    }
    if (line[i] !== '`') {
      i++;
      continue;
    }
    let n = 0;
    while (line[i + n] === '`') n++;
    const fence = '`'.repeat(n);
    let j = i + n;
    let close = -1;
    while (j < line.length) {
      const k = line.indexOf(fence, j);
      if (k === -1) break;
      if (line[k + n] !== '`' && line[k - 1] !== '`') {
        close = k;
        break;
      }
      j = k + 1;
      while (line[j] === '`') j++;
    }
    if (close === -1) {
      i += n;
      continue;
    }
    let text = line.slice(i + n, close);
    if (text.length > 1 && text.startsWith(' ') && text.endsWith(' ') && text.trim())
      text = text.slice(1, -1);
    spans.push({ text, start: i, end: close + n });
    i = close + n;
  }
  return spans;
}

/** The line with every code span replaced by spaces of the same length (columns are kept). */
export function blankCodeSpans(line) {
  let out = line;
  for (const s of codeSpans(line))
    out = out.slice(0, s.start) + ' '.repeat(s.end - s.start) + out.slice(s.end);
  return out;
}

/** Replaces the matches of `re` with spaces of the same length. */
export function blank(text, re) {
  return text.replace(re, (m) => ' '.repeat(m.length));
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Parses a Markdown document once: which lines are code (fenced blocks and multi-line HTML
 * comments), the headings with their GitHub slugs, the explicit anchors and the links.
 */
export function parseMarkdown(src) {
  const lines = src.split('\n');
  const code = new Array(lines.length).fill(false);
  let fence = null;
  let comment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      code[i] = true;
      const m = line.match(FENCE);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim())
        fence = null;
      continue;
    }
    if (comment) {
      code[i] = true;
      if (line.includes('-->')) comment = false;
      continue;
    }
    const m = line.match(FENCE);
    if (m && !(m[1][0] === '`' && line.slice(m[0].length).includes('`'))) {
      code[i] = true;
      fence = m[1];
      continue;
    }
    const open = line.lastIndexOf('<!--');
    if (open !== -1 && line.indexOf('-->', open) === -1 && line.trimStart().startsWith('<!--')) {
      code[i] = true;
      comment = true;
    }
  }

  const slug = slugger();
  const headings = [];
  const anchors = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) continue;
    const line = lines[i];
    let level = 0;
    let raw = '';
    let at = i + 1;
    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/);
    if (atx) {
      level = atx[1].length;
      raw = atx[2] ?? '';
    } else if (i > 0 && !code[i - 1] && /^ {0,3}(=+|-+)[ \t]*$/.test(line) && isParagraphLine(lines[i - 1])) {
      level = line.trim()[0] === '=' ? 1 : 2;
      raw = lines[i - 1].trim();
      at = i;
    }
    if (!level) continue;
    const text = headingText(raw);
    const s = slug(text);
    headings.push({ level, text, raw, line: at, slug: s });
    anchors.add(s);
  }
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) continue;
    for (const m of blankCodeSpans(lines[i]).matchAll(/\s(?:id|name)=["']([^"']+)["']/g)) anchors.add(m[1]);
  }
  return { src, lines, code, headings, anchors, links: findLinks(lines, code) };
}

function isParagraphLine(line) {
  const t = line.trim();
  return (
    t !== '' &&
    !/^\s/.test(line) &&
    !/^(#|>|[-*+]\s|\d+[.)]\s|\||<|`{3}|~{3})/.test(t) &&
    !/^(=+|-+)$/.test(t)
  );
}

/**
 * Links outside code: inline links and images `[text](dest)`, reference definitions
 * `[label]: dest`, and `href`/`src` attributes. Autolinks (`<https://…>`) are external and skipped.
 */
function findLinks(lines, code) {
  const links = [];
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) continue;
    const line = blankCodeSpans(lines[i]).replace(/<!--.*?-->/g, (m) => ' '.repeat(m.length));
    const def = line.match(/^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/);
    if (def) {
      links.push({ dest: def[2], line: i + 1, kind: 'def', label: def[1] });
      continue;
    }
    for (const m of line.matchAll(
      /(!?)\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+["'(][^)]*["')])?\s*\)/g,
    )) {
      const dest = m[3].startsWith('<') ? m[3].slice(1, -1) : m[3];
      links.push({ dest, line: i + 1, kind: m[1] ? 'image' : 'link', text: m[2] });
    }
    for (const m of line.matchAll(/\s(?:href|src)=["']([^"']+)["']/g))
      links.push({ dest: m[1], line: i + 1, kind: 'html' });
  }
  return links;
}

/** The lines [start, end) of the section under the heading with this slug, or null. */
export function section(doc, slug) {
  const idx = doc.headings.findIndex((h) => h.slug === slug);
  if (idx === -1) return null;
  const h = doc.headings[idx];
  const next = doc.headings.slice(idx + 1).find((x) => x.level <= h.level);
  return { start: h.line, end: next ? next.line - 1 : doc.lines.length, heading: h };
}

/** Splits a table row into trimmed cells; `|` inside code spans or escaped as `\|` does not split. */
export function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const spans = codeSpans(t);
  const cells = [];
  let cell = '';
  for (let i = 0; i < t.length; i++) {
    const inSpan = spans.some((s) => i > s.start && i < s.end);
    if (t[i] === '\\' && t[i + 1] === '|') {
      cell += inSpan ? '\\|' : '|';
      i++;
      continue;
    }
    if (t[i] === '|' && !inSpan) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += t[i];
  }
  cells.push(cell.trim());
  return cells;
}

/** The pipe tables in lines [start, end): header cells and rows with their line numbers. */
export function tables(doc, start = 0, end = doc.lines.length) {
  const out = [];
  for (let i = start; i < end - 1; i++) {
    if (doc.code[i]) continue;
    const head = doc.lines[i];
    const delim = doc.lines[i + 1];
    if (!head.trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(delim))
      continue;
    const table = { header: splitRow(head), rows: [], line: i + 1 };
    let j = i + 2;
    while (j < end && doc.lines[j].trim().startsWith('|')) {
      table.rows.push({ cells: splitRow(doc.lines[j]), line: j + 1 });
      j++;
    }
    out.push(table);
    i = j - 1;
  }
  return out;
}

/**
 * The top-level list items in lines [start, end), each with its first line and the text of its
 * continuation lines (indented), joined by newlines.
 */
export function listItems(doc, start = 0, end = doc.lines.length) {
  const items = [];
  let current = null;
  for (let i = start; i < end; i++) {
    const line = doc.lines[i];
    if (doc.code[i] && !current) continue;
    const m = line.match(/^[-*+] (.*)$/) ?? line.match(/^\d+[.)] (.*)$/);
    if (m && !doc.code[i]) {
      current = { text: m[1], lines: [m[1]], line: i + 1 };
      items.push(current);
      continue;
    }
    if (!current) continue;
    if (/^\s+\S/.test(line)) {
      current.lines.push(line.trim());
      current.text += `\n${line.trim()}`;
    } else if (line.trim() !== '') current = null;
  }
  return items;
}

/** The fact markers of a document outside code: name, transforms, value and position. */
export function factMarkers(doc) {
  const out = [];
  for (let i = 0; i < doc.lines.length; i++) {
    if (doc.code[i]) continue;
    const spans = codeSpans(doc.lines[i]);
    for (const m of doc.lines[i].matchAll(FACT_RE)) {
      if (spans.some((s) => m.index >= s.start && m.index < s.end)) continue;
      out.push({
        name: m[1],
        transforms: m[2] ? m[2].slice(1).split('|') : [],
        value: m[3],
        line: i + 1,
        index: m.index,
        length: m[0].length,
      });
    }
  }
  return out;
}

/** Escapes text for a Markdown paragraph or table cell. */
export function escapeText(text, { table = false } = {}) {
  let out = text.replace(/([\\`*_[\]<>])/g, '\\$1');
  if (table) out = out.replace(/\|/g, '\\|');
  return out;
}
