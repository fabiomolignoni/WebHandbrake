/** Shared accessible components (A11Y-01…A11Y-04). */

import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { t } from '../i18n/i18n';
import { Icon } from './icons';

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size' | 'type'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | 'large';
  block?: boolean;
  icon?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
};

export function Button({
  variant = 'secondary',
  size,
  block,
  icon,
  children,
  class: cls,
  type = 'button',
  ...rest
}: BtnProps) {
  const classes = ['btn', variant !== 'secondary' && variant, size, block && 'block', cls]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} class={classes} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, ...rest }: BtnProps & { icon: string; label: string }) {
  return (
    <Button {...rest} class={`icon ${rest.class ?? ''}`} aria-label={label} title={label}>
      <Icon name={icon} />
    </Button>
  );
}

/**
 * Switch with immediate effect, laid out as a setting row: label and help first, switch at the
 * end (NN/g toggle guidelines). `compact` keeps label and switch together (toolbars, headers).
 */
export function Toggle({
  checked,
  onChange,
  label,
  help,
  disabled,
  compact,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ComponentChildren;
  help?: ComponentChildren;
  disabled?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  return (
    <div class={`toggle${compact ? ' compact' : ''}`}>
      <div class="toggle-text">
        <label for={id}>{label}</label>
        {help && (
          <span class="help" id={`${id}-help`}>
            {help}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        aria-describedby={help ? `${id}-help` : undefined}
      />
    </div>
  );
}

/** Arrow-key navigation shared by radio groups rendered as buttons (roving tab index). */
function useRovingRadio<T>(
  options: { value: T; disabled?: boolean }[],
  onChange: (v: T) => void,
  selector = 'button',
) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = e.key === 'End';
    const first = e.key === 'Home';
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!dir && !first && !last) return;
    e.preventDefault();
    const enabled = options.map((o, idx) => ({ o, idx })).filter((x) => !x.o.disabled);
    if (!enabled.length) return;
    const pos = enabled.findIndex((x) => x.idx === i);
    const next = first
      ? enabled[0]
      : last
        ? enabled[enabled.length - 1]
        : enabled[(pos + dir + enabled.length) % enabled.length];
    onChange(next.o.value);
    (ref.current?.querySelectorAll(selector)[next.idx] as HTMLElement | undefined)?.focus();
  };
  return { ref, onKey };
}

/** Segmented control: a short set of exclusive options (Apple HIG, Material 3: 2–5 options). */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
  disabled,
  block,
  labelledBy,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ComponentChildren; icon?: string; disabled?: boolean; aria?: string }[];
  label?: string;
  labelledBy?: string;
  disabled?: boolean;
  block?: boolean;
}) {
  const { ref, onKey } = useRovingRadio(options, onChange);
  const selected = options.some((o) => o.value === value);
  const firstEnabled = Math.max(
    0,
    options.findIndex((o) => !o.disabled),
  );
  return (
    <div
      class={`segmented${block ? ' block' : ''}`}
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      ref={ref}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.aria}
            tabIndex={checked || (!selected && i === firstEnabled) ? 0 : -1}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e as unknown as KeyboardEvent, i)}
          >
            {o.icon && <Icon name={o.icon} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Radio group of rich options (radio cards, friction picker). */
export function RadioCards<T extends string | number>({
  value,
  onChange,
  options,
  label,
  class: cls = 'stack stack-sm',
  itemClass = 'choice',
  render,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; disabled?: boolean; tone?: string }[];
  label: string;
  class?: string;
  itemClass?: string;
  render: (o: { value: T }, checked: boolean) => ComponentChildren;
}) {
  const { ref, onKey } = useRovingRadio(options, onChange);
  const selected = options.some((o) => o.value === value);
  const firstEnabled = Math.max(
    0,
    options.findIndex((o) => !o.disabled),
  );
  return (
    <div class={cls} role="radiogroup" aria-label={label} ref={ref}>
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            class={`${itemClass}${o.tone ? ` tone-${o.tone}` : ''}`}
            aria-checked={checked}
            tabIndex={checked || (!selected && i === firstEnabled) ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e as unknown as KeyboardEvent, i)}
          >
            {render(o, checked)}
          </button>
        );
      })}
    </div>
  );
}

/** A state shown as tone + icon + words (never colour alone, WCAG 1.4.1). */
export function StatusPill({
  tone,
  icon,
  children,
  small,
  title,
}: {
  tone: string;
  icon?: string;
  children: ComponentChildren;
  small?: boolean;
  title?: string;
}) {
  return (
    <span class={`pill tone-${tone}${small ? ' small' : ''}`} title={title}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </span>
  );
}

export function ToneIcon({
  tone,
  icon,
  size = 36,
  round,
  label,
}: {
  tone: string;
  icon: string;
  size?: number;
  round?: boolean;
  label?: string;
}) {
  const cls = `tone-icon tone-${tone}${round ? ' round' : ''}`;
  const style = { ['--size' as string]: `${size}px` };
  return label ? (
    <span class={cls} style={style} role="img" aria-label={label}>
      <Icon name={icon} />
    </span>
  ) : (
    <span class={cls} style={style} aria-hidden="true">
      <Icon name={icon} />
    </span>
  );
}

/** The group's icon on a tile tinted with the group colour. */
export function GroupTile({ color, icon, size = 40 }: { color: string; icon: string; size?: number }) {
  return (
    <span
      class="group-tile"
      style={{ ['--group' as string]: color, ['--size' as string]: `${size}px` }}
      aria-hidden="true"
    >
      <Icon name={icon || 'circle'} />
    </span>
  );
}

/** Four notches from free to protected: the handbrake, made visible. Decorative: the level is
    always also given in words next to it. */
export function FrictionMeter({ level, tone }: { level: number; tone: string }) {
  return (
    <span class={`meter tone-${tone}`} aria-hidden="true">
      {[1, 2, 3, 4].map((n) => (
        <i key={n} class={n <= level ? 'on' : ''} />
      ))}
    </span>
  );
}

/** Circular progress (0…1) with a label inside. */
export function Ring({
  value,
  children,
  label,
  class: cls,
}: {
  value: number;
  children?: ComponentChildren;
  label?: string;
  class?: string;
}) {
  const c = 2 * Math.PI * 44;
  const v = Math.min(1, Math.max(0, value));
  const inner = (
    <>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle class="track" cx="50" cy="50" r="44" />
        <circle
          class="value"
          cx="50"
          cy="50"
          r="44"
          style={{ strokeDasharray: `${c}`, strokeDashoffset: `${c * (1 - v)}` }}
        />
      </svg>
      <span class="label" aria-hidden={label ? 'true' : undefined}>
        {children}
      </span>
    </>
  );
  const klass = `ring${cls ? ` ${cls}` : ''}`;
  return label ? (
    <span class={klass} role="img" aria-label={label}>
      {inner}
    </span>
  ) : (
    <span class={klass}>{inner}</span>
  );
}

export type MenuItem =
  | {
      label: string;
      icon?: string;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
    }
  | 'separator';

/**
 * Overflow menu (menu button pattern, WAI-ARIA APG): arrows, Home/End, Escape and Tab close it
 * and focus returns to the button.
 */
export function Menu({
  label,
  items,
  icon = 'more',
  size = 'small',
  up,
  text,
}: {
  label: string;
  items: MenuItem[];
  icon?: string;
  size?: 'small';
  up?: boolean;
  /** Visible label: the button shows it next to the icon instead of being icon-only. */
  text?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const entries = () =>
    Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  useEffect(() => {
    if (!open) return;
    entries()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const list = entries();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      list[(i + d + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    }
  };
  return (
    <div class="menu-wrap above" ref={wrap}>
      <button
        ref={button}
        type="button"
        class={text ? `btn ${size}` : `btn ghost icon ${size}`}
        aria-label={text ? undefined : label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name={icon} />
        {text}
      </button>
      {open && (
        <div
          class={`menu${up ? ' up' : ''}`}
          role="menu"
          id={menuId}
          aria-label={label}
          onKeyDown={(e) => onKey(e as unknown as KeyboardEvent)}
        >
          {items.map((it, i) =>
            it === 'separator' ? (
              <hr key={`s${i}`} />
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                class={it.danger ? 'danger' : undefined}
                disabled={it.disabled}
                onClick={() => {
                  close();
                  it.onSelect();
                }}
              >
                {it.icon && <Icon name={it.icon} />}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function Field({
  label,
  help,
  error,
  children,
  id,
}: {
  label: ComponentChildren;
  help?: ComponentChildren;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => ComponentChildren;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy =
    [help ? `${fid}-help` : '', error ? `${fid}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div class="field">
      <label for={fid}>{label}</label>
      {children(fid, describedBy)}
      {help && (
        <span class="help" id={`${fid}-help`}>
          {help}
        </span>
      )}
      {error && (
        <span class="error-text" id={`${fid}-err`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  id,
  label,
  describedBy,
  suffix,
  commitOnBlur,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  label?: string;
  describedBy?: string;
  suffix?: string;
  /** Report the value only when the field loses focus or Enter is pressed (settings that are saved at once). */
  commitOnBlur?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const parse = (v: string) => {
    const n = Number(v);
    if (v === '' || !Number.isFinite(n)) return null;
    return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  };
  return (
    <span class="row nowrap" style={{ gap: '6px' }}>
      <input
        id={id}
        class="input num"
        type="number"
        inputMode="decimal"
        value={text}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        aria-describedby={describedBy}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setText(v);
          const n = parse(v);
          if (!commitOnBlur && n !== null) onChange(n);
        }}
        onKeyDown={(e) => {
          if (commitOnBlur && e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => {
          const n = parse(text);
          if (commitOnBlur && n !== null && n !== value) onChange(n);
          setText(String(n ?? value));
        }}
      />
      {suffix && <span class="muted small">{suffix}</span>}
    </span>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  id,
  label,
  describedBy,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  id?: string;
  label?: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      class="select"
      value={value}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Radio group rendered as chips, with arrow key navigation. */
export function Chips<T extends string | number>({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ComponentChildren; disabled?: boolean }[];
  label: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    const enabled = options.map((o, idx) => ({ o, idx })).filter((x) => !x.o.disabled);
    const pos = enabled.findIndex((x) => x.idx === i);
    const next = enabled[(pos + dir + enabled.length) % enabled.length];
    onChange(next.o.value);
    (ref.current?.querySelectorAll('button')[next.idx] as HTMLButtonElement | undefined)?.focus();
  };
  return (
    <div class="chips" role="radiogroup" aria-label={label} ref={ref}>
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            class="chip"
            aria-checked={checked}
            tabIndex={checked || (!options.some((x) => x.value === value) && i === 0) ? 0 : -1}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e as unknown as KeyboardEvent, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Banner({
  kind = 'info',
  icon,
  children,
  action,
}: {
  kind?: 'info' | 'warning' | 'danger' | 'ok' | 'accent';
  icon?: string;
  children: ComponentChildren;
  action?: ComponentChildren;
}) {
  const defaultIcon = kind === 'warning' || kind === 'danger' ? 'alert' : kind === 'ok' ? 'check' : 'info';
  return (
    <div class={`banner ${kind}`} role={kind === 'danger' || kind === 'warning' ? 'alert' : 'status'}>
      <Icon name={icon ?? defaultIcon} />
      <div class="grow stack stack-sm">{children}</div>
      {action}
    </div>
  );
}

export function Progress({
  value,
  max,
  label,
  tone,
}: {
  value: number;
  max: number;
  label: string;
  tone?: 'warning' | 'done';
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      class={`progress${tone ? ` ${tone}` : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({
  icon = 'leaf',
  title,
  children,
}: {
  icon?: string;
  title: string;
  children?: ComponentChildren;
}) {
  return (
    <div class="empty">
      <Icon name={icon} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Disclosure({
  summary,
  children,
  open,
}: {
  summary: ComponentChildren;
  children: ComponentChildren;
  open?: boolean;
}) {
  return (
    <details class="disclosure" open={open}>
      <summary>{summary}</summary>
      <div class="body stack">{children}</div>
    </details>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { value: T; label: string; badge?: ComponentChildren }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div class="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          tabIndex={tab.value === value ? 0 : -1}
          onClick={() => onChange(tab.value)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.value === value);
            if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].value);
            if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].value);
          }}
        >
          {tab.label}
          {tab.badge}
        </button>
      ))}
    </div>
  );
}

/** Modal dialog on the native <dialog> element: focus is trapped and restored (A11Y-02). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  wide,
  closable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ComponentChildren;
  children: ComponentChildren;
  actions?: ComponentChildren;
  wide?: boolean;
  closable?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      restore.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      restore.current?.focus?.();
    }
  }, [open]);
  useEffect(
    () => () => {
      if (ref.current?.open) ref.current.close();
    },
    [],
  );
  if (!open) return <dialog ref={ref} class="dialog" />;
  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-labelledby={titleId}
      style={wide ? { width: 'min(760px, calc(100vw - 24px))' } : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (closable) onClose();
      }}
    >
      <div class="dialog-inner">
        <div class="row between nowrap top">
          <h2 id={titleId}>{title}</h2>
          {closable && (
            <IconButton icon="x" label={t('common.close')} variant="ghost" size="small" onClick={onClose} />
          )}
        </div>
        {children}
        {actions && <div class="dialog-actions">{actions}</div>}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type ToastItem = { id: number; text: string; action?: { label: string; run: () => void } };
let toastSeq = 0;
const toastListeners = new Set<(items: ToastItem[]) => void>();
let toastItems: ToastItem[] = [];

export function toast(text: string, action?: ToastItem['action']) {
  const item = { id: ++toastSeq, text, action };
  toastItems = [...toastItems, item];
  for (const l of toastListeners) l(toastItems);
  setTimeout(() => {
    toastItems = toastItems.filter((x) => x.id !== item.id);
    for (const l of toastListeners) l(toastItems);
  }, 6000);
}

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>(toastItems);
  useEffect(() => {
    toastListeners.add(setItems);
    return () => toastListeners.delete(setItems);
  }, []);
  return (
    <div class="toasts" aria-live="polite" aria-atomic="false">
      {items.map((i) => (
        <div class="toast" key={i.id} role="status">
          <span>{i.text}</span>
          {i.action && (
            <button type="button" class="link-btn" onClick={i.action.run}>
              {i.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function ColorDot({ color, label }: { color: string; label?: string }) {
  return label ? (
    <span class="dot" style={{ background: color }} role="img" aria-label={label} />
  ) : (
    <span class="dot" style={{ background: color }} aria-hidden="true" />
  );
}

export function Spinner() {
  return (
    <div class="muted small" role="status" aria-live="polite">
      {t('common.loading')}
    </div>
  );
}
