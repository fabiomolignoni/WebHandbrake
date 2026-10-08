/**
 * words: user-facing documents use the interface's words (README, PRIVACY, SECURITY, SUPPORT,
 * CHANGELOG, the user guide, the accessibility statement, the store listings and the issue forms).
 *
 * - No word that the glossary (docs/glossary.md, column "Avoid in user-facing text", the words in
 *   backticks) says to avoid, as a whole word, case-insensitive, except inside its allowed phrases.
 *   Fenced code is skipped; a code span is checked too, unless it is an allowed code span
 *   (scripts/docs/config.mjs), a manifest permission name or a repository path.
 * - UK spelling (colour, behaviour, organise…), except in proper names.
 * - No words that date a sentence ("currently", "coming soon"…), except in CHANGELOG.md.
 * - No status emoji or tick marks.
 *
 * In the interface strings (src/locales/en.json, src/_locales/en/messages.json) only a narrow list
 * is checked: the code words `group`, `groups`, `DNR` and `declarativeNetRequest`, in the text of
 * each message (placeholder names and ICU syntax are not text).
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ALLOWED_CODE_SPANS,
  isUserFacing,
  LOCALE,
  MANIFEST_LOCALE,
  SPELLING_ALLOWED,
  STATUS_EMOJI,
  STRING_WORDS,
  TIME_WORDS,
  TIME_WORDS_EXEMPT,
  UK_SPELLING,
} from '../config.mjs';
import { blank, blankCodeSpans, codeSpans, section, tables } from '../md.mjs';
import { loadModules } from '../ts.mjs';

const GLOSSARY = 'docs/glossary.md';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (words) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words.map(esc).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');

/** The avoided words of the glossary and the phrases in which they are allowed. */
function glossaryWords(repo) {
  const doc = repo.doc(GLOSSARY);
  if (!doc) return null;
  const sec = section(doc, 'terms');
  const avoid = [];
  for (const table of tables(doc, sec?.start ?? 0, sec?.end ?? doc.lines.length)) {
    const col = table.header.findIndex((h) => /^avoid/i.test(h));
    const termCol = table.header.findIndex((h) => /interface term/i.test(h));
    if (col === -1) continue;
    for (const row of table.rows) {
      const cellText = row.cells[col] ?? '';
      const allowedMatch = cellText.match(/allowed phrases?:\s*([^)]*)\)/i);
      const allowed = allowedMatch
        ? allowedMatch[1]
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
        : [];
      const head = allowedMatch ? cellText.slice(0, allowedMatch.index) : cellText.replace(/\([^)]*\)/g, '');
      for (const span of codeSpans(head))
        avoid.push({ word: span.text, allowed, term: (row.cells[termCol] ?? '').split(/[;,:]/)[0].trim() });
    }
  }
  return avoid;
}

export default {
  slug: 'words',
  scope: 'file',
  description: 'user-facing text: glossary words, UK spelling, no dating words, no status emoji',
  async run({ repo }) {
    const problems = [];
    const avoid = glossaryWords(repo);
    if (!avoid)
      return [{ path: GLOSSARY, message: 'does not exist; the words check reads its Avoid column.' }];
    const { manifest } = await import(pathToFileURL(join(repo.root, 'scripts/manifest.mjs')).href);
    const version = JSON.parse(repo.read('package.json')).version;
    const permissionNames = new Set(
      ['chrome', 'firefox'].flatMap((t) => {
        const m = manifest(t, version);
        return [...(m.permissions ?? []), ...(m.optional_permissions ?? []), ...(m.host_permissions ?? [])];
      }),
    );
    const allowedSpan = (text) =>
      ALLOWED_CODE_SPANS.includes(text) ||
      permissionNames.has(text) ||
      /\//.test(text) ||
      /^[\w.-]+\.[a-z]{2,4}$/.test(text);

    const avoidRules = avoid.map((a) => ({
      ...a,
      re: wordRe([a.word]),
      allowedRe: a.allowed.length ? wordRe(a.allowed) : null,
    }));
    const spellingRe = wordRe(Object.keys(UK_SPELLING));
    const spellingAllowedRe = wordRe(SPELLING_ALLOWED);
    const timeRe = wordRe(TIME_WORDS);

    const checkAvoid = (path, line, text) => {
      for (const rule of avoidRules) {
        const t = rule.allowedRe ? blank(text, rule.allowedRe) : text;
        for (const m of t.matchAll(rule.re))
          problems.push({
            path,
            line,
            message: `'${m[0]}': the interface term is '${rule.term}' (${GLOSSARY}).`,
          });
      }
    };

    const checkProse = (path, line, raw) => {
      let text = raw
        .replace(/<!--.*?-->/g, (m) => ' '.repeat(m.length))
        .replace(/\]\([^)]*\)/g, (m) => ' '.repeat(m.length))
        .replace(/<[^>]+>/g, (m) => ' '.repeat(m.length))
        .replace(/https?:\/\/\S+/g, (m) => ' '.repeat(m.length))
        .replace(/\{[^{}]*\}/g, (m) => ' '.repeat(m.length));
      for (const span of codeSpans(text)) {
        if (!allowedSpan(span.text)) checkAvoid(path, line, span.text);
      }
      text = blankCodeSpans(text);
      checkAvoid(path, line, text);
      for (const m of blank(text, spellingAllowedRe).matchAll(spellingRe))
        problems.push({
          path,
          line,
          message: `'${m[0]}': write '${UK_SPELLING[m[0].toLowerCase()]}' (UK English).`,
        });
      if (!TIME_WORDS_EXEMPT.includes(path))
        for (const m of text.matchAll(timeRe))
          problems.push({
            path,
            line,
            message: `'${m[0]}' dates the sentence: state what is true (plans go in the roadmap).`,
          });
      for (const e of STATUS_EMOJI)
        if (text.includes(e)) problems.push({ path, line, message: `'${e}': write the status as a word.` });
    };

    for (const path of repo.files()) {
      if (!isUserFacing(path)) continue;
      if (path.endsWith('.md')) {
        const doc = repo.doc(path);
        doc.lines.forEach((line, i) => {
          if (!doc.code[i]) checkProse(path, i + 1, line);
        });
      } else {
        repo
          .read(path)
          .split('\n')
          .forEach((line, i) => {
            const value = line.replace(/^\s*(?:-\s+)?(?:[\w-]+:\s*)?/, '').replace(/^[>|]-?\s*$/, '');
            if (value.trim()) checkProse(path, i + 1, value);
          });
      }
    }

    const { parseMessage } = await loadModules(repo.root);
    const textOf = (nodes) =>
      nodes
        .map((n) =>
          typeof n === 'string' ? n : n.options ? Object.values(n.options).map(textOf).join(' ') : ' ',
        )
        .join('');
    const stringRe = wordRe(STRING_WORDS);
    for (const path of [LOCALE, MANIFEST_LOCALE]) {
      const raw = repo.read(path);
      const lines = raw.split('\n');
      for (const [key, { message }] of Object.entries(JSON.parse(raw))) {
        let text;
        try {
          text = textOf(parseMessage(message));
        } catch {
          text = message;
        }
        text = text.replace(/\{[^{}]*\}/g, ' ');
        const line = lines.findIndex((l) => l.includes(`"${key}":`)) + 1;
        for (const m of text.matchAll(stringRe))
          problems.push({
            path,
            line,
            message: `${key}: '${m[0]}' is a code word; see ${GLOSSARY} for the interface term.`,
          });
      }
    }
    return problems;
  },
};
