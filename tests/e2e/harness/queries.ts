/**
 * Element queries resolved inside the page, identically in every browser: by ARIA role and
 * accessible name (like Testing Library and Playwright's getByRole), label, placeholder, text or
 * CSS. Open shadow roots are searched too (the overlay is open in the test build).
 */

export type TextMatch = string | RegExp;

export interface Query {
  css?: string;
  role?: string;
  /** Accessible name: case-insensitive substring, exact string with `exact`, or a RegExp. */
  name?: TextMatch;
  /** Visible text of the smallest element containing it. */
  text?: TextMatch;
  /** Form control by its label (label element, aria-label, aria-labelledby). */
  label?: TextMatch;
  placeholder?: TextMatch;
  /** Only elements whose text contains this. */
  hasText?: TextMatch;
  exact?: boolean;
  /** CSS selector of the container(s) to search in. */
  within?: string;
  /** Index among the matches (default: the first visible one). */
  nth?: number;
}

/** A query with RegExps converted for transport into the page. */
export type WireQuery = Omit<Query, 'name' | 'text' | 'label' | 'placeholder' | 'hasText'> & {
  name?: WireMatch;
  text?: WireMatch;
  label?: WireMatch;
  placeholder?: WireMatch;
  hasText?: WireMatch;
};
type WireMatch = string | { source: string; flags: string };

export function toWire(q: Query): WireQuery {
  const conv = (m: TextMatch | undefined) => (m instanceof RegExp ? { source: m.source, flags: m.flags } : m);
  return {
    ...q,
    name: conv(q.name),
    text: conv(q.text),
    label: conv(q.label),
    placeholder: conv(q.placeholder),
    hasText: conv(q.hasText),
  };
}

export function describeQuery(q: Query): string {
  const parts: string[] = [];
  if (q.role) parts.push(`role=${q.role}`);
  if (q.name !== undefined) parts.push(`name=${String(q.name)}`);
  if (q.text !== undefined) parts.push(`text=${String(q.text)}`);
  if (q.label !== undefined) parts.push(`label=${String(q.label)}`);
  if (q.placeholder !== undefined) parts.push(`placeholder=${String(q.placeholder)}`);
  if (q.css) parts.push(`css=${q.css}`);
  if (q.hasText !== undefined) parts.push(`hasText=${String(q.hasText)}`);
  if (q.within) parts.push(`within=${q.within}`);
  if (q.nth !== undefined) parts.push(`nth=${q.nth}`);
  return parts.join(' ');
}

export interface ElementInfo {
  count: number;
  visible: boolean;
  enabled: boolean;
  text: string;
  value: string | null;
  checked: boolean | null;
  attr: string | null;
  focused: boolean;
}

/**
 * Runs in the page. `op`: 'element' returns the element to act on (or null), 'info' an
 * ElementInfo, 'texts' the texts of every match. Self-contained: it is sent as source code.
 */
export function pageQuery(q: WireQuery, op: 'element' | 'info' | 'texts', attrName?: string): unknown {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const matches = (value: string, m: WireMatch | undefined, exact?: boolean) => {
    if (m === undefined) return true;
    const v = norm(value);
    if (typeof m === 'object') return new RegExp(m.source, m.flags).test(v);
    return exact ? v === m : v.toLowerCase().includes(m.toLowerCase());
  };
  const all = (root: Document | ShadowRoot | Element): Element[] => {
    const out: Element[] = [];
    const walk = (n: Document | ShadowRoot | Element) => {
      for (const el of Array.from(n.querySelectorAll('*'))) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    if ((root as Element).shadowRoot) walk((root as Element).shadowRoot!);
    return out;
  };
  const visible = (el: Element): boolean => {
    const h = el as HTMLElement;
    if (typeof h.checkVisibility === 'function' && !h.checkVisibility({ visibilityProperty: true } as never))
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const textOf = (el: Element): string => {
    const h = el as HTMLElement;
    const t = typeof h.innerText === 'string' && visible(el) ? h.innerText : el.textContent;
    return norm(t);
  };
  const byIds = (ids: string | null) =>
    norm(
      (ids ?? '')
        .split(/\s+/)
        .map((id) => (id ? (el0.getRootNode() as Document).getElementById?.(id) : null))
        .filter(Boolean)
        .map((x) => textOf(x as Element))
        .join(' '),
    );
  let el0: Element = document.documentElement;
  const implicitRole = (el: Element): string | null => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    switch (tag) {
      case 'button':
        return 'button';
      case 'summary':
        return 'button';
      case 'a':
      case 'area':
        return el.hasAttribute('href') ? 'link' : null;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return 'heading';
      case 'textarea':
        return 'textbox';
      case 'select':
        return el.hasAttribute('multiple') ? 'listbox' : 'combobox';
      case 'option':
        return 'option';
      case 'img':
        return el.getAttribute('alt') === '' ? 'presentation' : 'img';
      case 'dialog':
        return 'dialog';
      case 'nav':
        return 'navigation';
      case 'main':
        return 'main';
      case 'aside':
        return 'complementary';
      case 'ul':
      case 'ol':
        return 'list';
      case 'li':
        return 'listitem';
      case 'table':
        return 'table';
      case 'tr':
        return 'row';
      case 'td':
        return 'cell';
      case 'th':
        return 'columnheader';
      case 'progress':
        return 'progressbar';
      case 'hr':
        return 'separator';
      case 'form':
        return 'form';
      case 'fieldset':
        return 'group';
      case 'input':
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'number') return 'spinbutton';
        if (type === 'search') return 'searchbox';
        if (['', 'text', 'email', 'url', 'tel'].includes(type)) return 'textbox';
        return null;
      default:
        if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null)
          return 'textbox';
        return null;
    }
  };
  const roleOf = (el: Element) => el.getAttribute('role')?.split(/\s+/)[0] || implicitRole(el);
  const labelText = (el: Element): string => {
    el0 = el;
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = byIds(labelledby);
      if (t) return t;
    }
    const aria = el.getAttribute('aria-label');
    if (aria && norm(aria)) return norm(aria);
    const id = el.getAttribute('id');
    const labels: string[] = [];
    if (id) {
      for (const l of Array.from((el.getRootNode() as Document).querySelectorAll?.('label') ?? []))
        if ((l as HTMLLabelElement).htmlFor === id) labels.push(textOf(l));
    }
    const wrap = el.closest('label');
    if (wrap) labels.push(textOf(wrap));
    return norm(labels.join(' '));
  };
  const nameOf = (el: Element): string => {
    const label = labelText(el);
    if (label) return label;
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') return norm(el.getAttribute('alt'));
    if (tag === 'input') {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type)) return norm((el as HTMLInputElement).value);
      return norm(el.getAttribute('title') ?? el.getAttribute('placeholder'));
    }
    if (tag === 'textarea' || tag === 'select') return norm(el.getAttribute('title'));
    const role = roleOf(el);
    const fromContent = [
      'button',
      'link',
      'heading',
      'radio',
      'checkbox',
      'switch',
      'tab',
      'menuitem',
      'menuitemradio',
      'menuitemcheckbox',
      'option',
      'cell',
      'columnheader',
      'row',
      'listitem',
      'treeitem',
      'tooltip',
      'status',
      'alert',
      'timer',
    ];
    if (role && fromContent.includes(role)) {
      const t = textOf(el);
      if (t) return t;
    }
    return norm(el.getAttribute('title'));
  };

  const roots: (Document | Element)[] = q.within
    ? Array.from(document.querySelectorAll(q.within))
    : [document];
  let found: Element[] = [];
  for (const root of roots) {
    let candidates: Element[] = q.css
      ? (() => {
          const out: Element[] = [];
          const walk = (n: Document | ShadowRoot | Element) => {
            out.push(...Array.from(n.querySelectorAll(q.css!)));
            for (const el of Array.from(n.querySelectorAll('*'))) if (el.shadowRoot) walk(el.shadowRoot);
          };
          walk(root);
          if ((root as Element).shadowRoot) walk((root as Element).shadowRoot!);
          return out;
        })()
      : all(root);
    if (q.role) candidates = candidates.filter((el) => roleOf(el) === q.role);
    if (q.name !== undefined) candidates = candidates.filter((el) => matches(nameOf(el), q.name, q.exact));
    if (q.label !== undefined)
      candidates = candidates.filter(
        (el) =>
          ['input', 'textarea', 'select'].includes(el.tagName.toLowerCase()) ||
          [
            'textbox',
            'combobox',
            'searchbox',
            'spinbutton',
            'switch',
            'checkbox',
            'radio',
            'slider',
          ].includes(roleOf(el) ?? ''),
      );
    if (q.label !== undefined)
      candidates = candidates.filter((el) => matches(labelText(el), q.label, q.exact));
    if (q.placeholder !== undefined)
      candidates = candidates.filter((el) =>
        matches(el.getAttribute('placeholder') ?? '', q.placeholder, q.exact),
      );
    if (q.text !== undefined) {
      const hits = candidates.filter((el) => {
        const tag = el.tagName.toLowerCase();
        return tag !== 'script' && tag !== 'style' && matches(textOf(el), q.text, q.exact);
      });
      // The innermost elements only.
      candidates = hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)));
    }
    if (q.hasText !== undefined) candidates = candidates.filter((el) => matches(textOf(el), q.hasText));
    found.push(...candidates);
  }
  found = found.filter((el, i) => found.indexOf(el) === i);

  const shown = found.filter(visible);
  const pick = (): Element | null => {
    if (q.nth !== undefined) return found[q.nth] ?? null;
    return shown[0] ?? null;
  };
  if (op === 'element') return pick();
  if (op === 'texts') return shown.map(textOf);
  const el = pick() ?? found[0] ?? null;
  const info = {
    count: found.length,
    visible: Boolean(el && visible(el)),
    enabled: Boolean(
      el &&
        !(el as HTMLButtonElement).disabled &&
        el.getAttribute('aria-disabled') !== 'true' &&
        !el.closest('[inert]'),
    ),
    text: el ? textOf(el) : '',
    value: el && 'value' in el ? String((el as HTMLInputElement).value) : null,
    checked: el
      ? el.hasAttribute('aria-checked')
        ? el.getAttribute('aria-checked') === 'true'
        : 'checked' in el
          ? Boolean((el as HTMLInputElement).checked)
          : el.hasAttribute('aria-pressed')
            ? el.getAttribute('aria-pressed') === 'true'
            : null
      : null,
    attr: el && attrName ? el.getAttribute(attrName) : null,
    focused: Boolean(el && (el === document.activeElement || el.matches(':focus'))),
  };
  return info;
}
