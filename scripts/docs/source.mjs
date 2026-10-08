/**
 * A small JavaScript and TypeScript scanner for the documentation tools: it finds comments, string
 * and template literals and the titles of test(), it() and describe() calls without a parser
 * dependency. Regular-expression literals are told from division by the token before them.
 */

const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
  'instanceof',
]);

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

/**
 * Tokens of a source file: { type: 'comment' | 'string' | 'template' | 'regex' | 'ident' |
 * 'number' | 'punct', start, end, value }. A template token has `quasis` (the static parts), `exprs`
 * (the tokens of its `${…}` expressions, flattened) and a value in which each expression is "…".
 */
export function tokenize(src) {
  return scan(src, 0, false).tokens;
}

function scan(src, start, untilBrace) {
  const tokens = [];
  let i = start;
  let depth = 0;
  let prev = null;
  const push = (t) => {
    tokens.push(t);
    if (t.type !== 'comment') prev = t;
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      push({ type: 'comment', start: i, end, value: src.slice(i + 2, end) });
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      push({ type: 'comment', start: i, end, value: src.slice(i + 2, close === -1 ? end : close) });
      i = end;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') {
          value += ESCAPES[src[j + 1]] ?? src[j + 1];
          j += 2;
          continue;
        }
        value += src[j];
        j++;
      }
      push({ type: 'string', start: i, end: j + 1, value });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      const t = template(src, i);
      push(t);
      i = t.end;
      continue;
    }
    if (c === '/') {
      const regexAllowed =
        !prev ||
        (prev.type === 'punct' && REGEX_AFTER.has(prev.value)) ||
        (prev.type === 'ident' && REGEX_KEYWORDS.has(prev.value));
      if (regexAllowed) {
        let j = i + 1;
        let cls = false;
        while (j < src.length && src[j] !== '\n') {
          if (src[j] === '\\') {
            j += 2;
            continue;
          }
          if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          else if (src[j] === '/' && !cls) break;
          j++;
        }
        j++;
        while (/[a-z]/i.test(src[j] ?? '')) j++;
        push({ type: 'regex', start: i, end: j, value: src.slice(i, j) });
        i = j;
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (/[\w$]/.test(src[j] ?? '')) j++;
      push({ type: 'ident', start: i, end: j, value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/\d/.test(c)) {
      let j = i + 1;
      while (/[\w.]/.test(src[j] ?? '')) j++;
      push({ type: 'number', start: i, end: j, value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (untilBrace) {
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0) return { tokens, end: i };
        depth--;
      }
    }
    push({ type: 'punct', start: i, end: i + 1, value: c });
    i++;
  }
  return { tokens, end: i };
}

function template(src, start) {
  const quasis = [];
  const exprs = [];
  let quasi = '';
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      quasi += ESCAPES[src[i + 1]] ?? src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      quasis.push(quasi);
      return { type: 'template', start, end: i + 1, quasis, exprs, value: quasis.join('…') };
    }
    if (c === '$' && src[i + 1] === '{') {
      quasis.push(quasi);
      quasi = '';
      const inner = scan(src, i + 2, true);
      exprs.push(...inner.tokens);
      i = inner.end + 1;
      continue;
    }
    quasi += c;
    i++;
  }
  quasis.push(quasi);
  return { type: 'template', start, end: src.length, quasis, exprs, value: quasis.join('…') };
}

/** A function mapping a character offset to its 1-based line number. */
export function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

const NOT_TESTS = new Set([
  'use',
  'step',
  'extend',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'info',
  'setTimeout',
  'slow',
  'configure',
  'expect',
  'each',
]);
/** Modifiers that declare a test that does not run: it is not evidence. */
const NOT_RUN = new Set(['skip', 'fixme', 'todo', 'fail']);

/**
 * The test and describe titles of a test file. Each entry: { kind: 'test' | 'describe', title (for
 * display; each expression of a template becomes …), idText (the text whose IDs count: the static text
 * before the first `${` of a template), line, describes (the enclosing describe entries, outermost
 * first), runs (false for skip, fixme, todo and fail) }.
 */
export function testTitles(src) {
  const tokens = tokenize(src).filter((t) => t.type !== 'comment');
  const lineOf = lineIndex(src);
  const entries = [];
  const blocks = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type !== 'ident' || !['test', 'it', 'describe'].includes(t.value)) continue;
    const before = tokens[k - 1];
    if (before && before.type === 'punct' && before.value === '.') continue;
    const chain = [t.value];
    let j = k + 1;
    while (tokens[j]?.value === '.' && tokens[j + 1]?.type === 'ident') {
      chain.push(tokens[j + 1].value);
      j += 2;
    }
    if (tokens[j]?.value !== '(') continue;
    const arg = tokens[j + 1];
    if (!arg || (arg.type !== 'string' && arg.type !== 'template')) continue;
    if (chain.some((c) => NOT_TESTS.has(c))) continue;
    const kind = chain.includes('describe') ? 'describe' : 'test';
    const title = arg.value;
    const idText = arg.type === 'template' ? arg.quasis[0] : arg.value;
    let end = src.length;
    let parens = 0;
    for (let m = j; m < tokens.length; m++) {
      if (tokens[m].value === '(') parens++;
      else if (tokens[m].value === ')') {
        parens--;
        if (parens === 0) {
          end = tokens[m].end;
          break;
        }
      }
    }
    const describes = blocks.filter((b) => b.start < t.start && t.start < b.end).map((b) => b.entry);
    const entry = {
      kind,
      title,
      idText,
      line: lineOf(t.start),
      describes,
      runs: !chain.some((c) => NOT_RUN.has(c)) && describes.every((d) => d.runs),
    };
    entries.push(entry);
    if (kind === 'describe') blocks.push({ start: t.start, end, entry });
  }
  return entries;
}

/** The comments of a file: { text, line } for each comment line, by file type. */
export function comments(path, src) {
  const lineOf = lineIndex(src);
  const out = [];
  if (/\.(m?[jt]sx?|cjs)$/.test(path)) {
    for (const t of tokenize(src)) {
      if (t.type !== 'comment') continue;
      const first = lineOf(t.start);
      t.value.split('\n').forEach((text, n) => {
        out.push({ text, line: first + n });
      });
    }
  } else if (/\.css$/.test(path)) {
    for (const m of src.matchAll(/\/\*([\s\S]*?)\*\//g)) {
      const first = lineOf(m.index);
      m[1].split('\n').forEach((text, n) => {
        out.push({ text, line: first + n });
      });
    }
  } else if (/\.html?$/.test(path)) {
    for (const m of src.matchAll(/<!--([\s\S]*?)-->/g)) {
      const first = lineOf(m.index);
      m[1].split('\n').forEach((text, n) => {
        out.push({ text, line: first + n });
      });
    }
  } else if (/\.ya?ml$/.test(path)) {
    src.split('\n').forEach((line, n) => {
      const m = line.match(/(?:^|\s)#(.*)$/);
      if (m && !/["'][^"']*#/.test(line.slice(0, m.index + 1))) out.push({ text: m[1], line: n + 1 });
    });
  }
  return out;
}
