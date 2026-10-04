/**
 * Minimal ICU MessageFormat implementation (I18N-01): {name}, {n, number},
 * {n, plural, =0 {…} one {# item} other {# items}}, {x, select, a {…} other {…}}.
 * Apostrophes quote syntax characters as in ICU: '{' → {, '' → '.
 */

export type ParamValue = string | number | null | undefined;
export type Params = Record<string, ParamValue>;

type Node =
  | string
  | { t: 'arg'; name: string; format?: 'number' }
  | { t: 'plural'; name: string; offset: number; options: Record<string, Node[]> }
  | { t: 'select'; name: string; options: Record<string, Node[]> }
  | { t: 'hash' };

const cache = new Map<string, Node[]>();

export function parse(message: string): Node[] {
  let ast = cache.get(message);
  if (!ast) {
    const p = new Parser(message);
    ast = p.parseNodes(false, false);
    cache.set(message, ast);
  }
  return ast;
}

class Parser {
  i = 0;
  constructor(private s: string) {}

  parseNodes(inPlural: boolean, nested: boolean): Node[] {
    const out: Node[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push(text);
      text = '';
    };
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (c === "'") {
        const next = this.s[this.i + 1];
        if (next === "'") {
          text += "'";
          this.i += 2;
          continue;
        }
        if (next === '{' || next === '}' || (inPlural && next === '#')) {
          const end = this.s.indexOf("'", this.i + 1);
          const stop = end === -1 ? this.s.length : end;
          text += this.s.slice(this.i + 1, stop);
          this.i = stop + 1;
          continue;
        }
        text += c;
        this.i++;
        continue;
      }
      if (c === '}' && nested) break;
      if (c === '#' && inPlural) {
        flush();
        out.push({ t: 'hash' });
        this.i++;
        continue;
      }
      if (c === '{') {
        flush();
        this.i++;
        out.push(this.parseArg());
        continue;
      }
      text += c;
      this.i++;
    }
    flush();
    return out;
  }

  private ws() {
    while (/\s/.test(this.s[this.i] ?? '')) this.i++;
  }

  private ident(): string {
    this.ws();
    const start = this.i;
    while (this.i < this.s.length && /[^\s,{}]/.test(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i);
  }

  private parseArg(): Node {
    const name = this.ident();
    this.ws();
    if (this.s[this.i] === '}') {
      this.i++;
      return { t: 'arg', name };
    }
    if (this.s[this.i] !== ',') throw new Error(`ICU: expected , in ${this.s}`);
    this.i++;
    const type = this.ident();
    this.ws();
    if (type === 'number') {
      while (this.i < this.s.length && this.s[this.i] !== '}') this.i++;
      this.i++;
      return { t: 'arg', name, format: 'number' };
    }
    if (this.s[this.i] !== ',') throw new Error(`ICU: expected , after ${type}`);
    this.i++;
    let offset = 0;
    const options: Record<string, Node[]> = {};
    for (;;) {
      this.ws();
      if (this.s[this.i] === '}') {
        this.i++;
        break;
      }
      let key = this.ident();
      if (key.startsWith('offset:')) {
        offset = Number(key.slice(7));
        continue;
      }
      this.ws();
      if (this.s[this.i] !== '{') throw new Error(`ICU: expected { after ${key}`);
      this.i++;
      const nodes = this.parseNodes(type === 'plural' || type === 'selectordinal', true);
      this.i++; // closing }
      if (key.startsWith('=')) key = `=${Number(key.slice(1))}`;
      options[key] = nodes;
    }
    if (type === 'plural' || type === 'selectordinal') return { t: 'plural', name, offset, options };
    return { t: 'select', name, options };
  }
}

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function rules(locale: string) {
  let r = pluralRules.get(locale);
  if (!r) {
    r = new Intl.PluralRules(locale);
    pluralRules.set(locale, r);
  }
  return r;
}

export function formatNumber(n: number, locale: string): string {
  let f = numberFormats.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    numberFormats.set(locale, f);
  }
  return f.format(n);
}

function render(nodes: Node[], params: Params, locale: string, hash?: number): string {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') {
      out += n;
      continue;
    }
    switch (n.t) {
      case 'hash':
        out += hash === undefined ? '#' : formatNumber(hash, locale);
        break;
      case 'arg': {
        const v = params[n.name];
        out += typeof v === 'number' ? formatNumber(v, locale) : (v ?? '');
        break;
      }
      case 'plural': {
        const raw = Number(params[n.name] ?? 0);
        const v = raw - n.offset;
        const branch = n.options[`=${raw}`] ?? n.options[rules(locale).select(v)] ?? n.options.other ?? [];
        out += render(branch, params, locale, v);
        break;
      }
      case 'select': {
        const v = String(params[n.name] ?? 'other');
        out += render(n.options[v] ?? n.options.other ?? [], params, locale, hash);
        break;
      }
    }
  }
  return out;
}

export function formatMessage(message: string, params: Params = {}, locale = 'en'): string {
  try {
    return render(parse(message), params, locale);
  } catch {
    return message;
  }
}
