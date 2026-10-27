/**
 * Pseudo-localisation (en-XA style): every message of src/locales/en.json with accented letters,
 * about 40% longer and between ⟦ ⟧, while placeholders and ICU syntax stay as they are.
 * `npm run build:pseudo` builds dist-pseudo/ with it, to see in the browser what a translation
 * would change:
 *
 * - text without ⟦ ⟧ never went through t(): it cannot be translated;
 * - ⟦…⟧ ⟦…⟧ side by side is a sentence built from pieces, which other languages cannot reorder;
 * - cut or overflowing text breaks with longer languages (German and Finnish run about 30% longer
 *   than English, short labels much more).
 *
 *   import { pseudoMessage } from './pseudo.mjs';
 */

const ACCENTS = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ľ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ľ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/**
 * Letters accented, and padding for 40% more length: after each word, as long words of other
 * languages would be, so that lines still break between words. The same text gets the same form.
 */
function pseudoText(text) {
  return text.replace(/\p{L}+/gu, (word) => {
    const accented = [...word].map((c) => ACCENTS[c] ?? c).join('');
    return `${accented}${'·'.repeat(Math.ceil([...word].length * 0.4))}`;
  });
}

/**
 * The pseudo-localised form of an ICU message: text is accented and padded, placeholders, plural
 * and select keywords, `#` and apostrophe quoting are kept. The whole message goes between ⟦ ⟧.
 */
export function pseudoMessage(message) {
  let i = 0;
  const ident = () => {
    const start = i;
    while (i < message.length && /[^\s,{}]/.test(message[i])) i++;
    return message.slice(start, i);
  };
  const ws = () => {
    const start = i;
    while (/\s/.test(message[i] ?? '')) i++;
    return message.slice(start, i);
  };
  const nodes = (nested, inPlural) => {
    let out = '';
    let text = '';
    const flush = () => {
      out += pseudoText(text);
      text = '';
    };
    while (i < message.length) {
      const c = message[i];
      if (c === "'") {
        const next = message[i + 1];
        if (next === "'") {
          text += "''";
          i += 2;
          continue;
        }
        if (next === '{' || next === '}' || (inPlural && next === '#')) {
          flush();
          const end = message.indexOf("'", i + 1);
          const stop = end === -1 ? message.length : end + 1;
          out += message.slice(i, stop);
          i = stop;
          continue;
        }
      }
      if (c === '}' && nested) break;
      if (c === '#' && inPlural) {
        flush();
        out += '#';
        i++;
        continue;
      }
      if (c === '{') {
        flush();
        i++;
        out += `{${arg()}`;
        continue;
      }
      text += c;
      i++;
    }
    flush();
    return out;
  };
  const arg = () => {
    let out = ws() + ident() + ws();
    if (message[i] === '}') {
      i++;
      return `${out}}`;
    }
    out += message[i++]; // ,
    out += ws();
    const type = ident();
    out += type + ws();
    if (type !== 'plural' && type !== 'select' && type !== 'selectordinal') {
      const end = message.indexOf('}', i);
      out += message.slice(i, end + 1);
      i = end + 1;
      return out;
    }
    out += message[i++]; // ,
    for (;;) {
      out += ws();
      if (i >= message.length) return out;
      if (message[i] === '}') {
        i++;
        return `${out}}`;
      }
      out += ident() + ws();
      if (message[i] !== '{') continue; // offset:n
      i++;
      out += `{${nodes(true, type !== 'select')}}`;
      i++;
    }
  };
  return `⟦${nodes(false, false)}⟧`;
}
