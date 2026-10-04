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

export function Toggle({
  checked,
  onChange,
  label,
  help,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ComponentChildren;
  help?: ComponentChildren;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div class="stack" style={{ gap: '2px' }}>
      <div class="toggle">
        <button
          type="button"
          role="switch"
          id={id}
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          aria-describedby={help ? `${id}-help` : undefined}
        />
        <label for={id}>{label}</label>
      </div>
      {help && (
        <span class="help" id={`${id}-help`} style={{ paddingInlineStart: '54px' }}>
          {help}
        </span>
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
