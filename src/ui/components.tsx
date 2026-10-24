/** Shared accessible components. */

import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { InterventionType } from '../engine/types';
import { t } from '../i18n/i18n';
import { Icon } from './icons';
import { interventionIcon, toneOf, typeName } from './status';

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
  class: cls,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ComponentChildren; icon?: string; disabled?: boolean; aria?: string }[];
  label?: string;
  labelledBy?: string;
  disabled?: boolean;
  block?: boolean;
  class?: string;
}) {
  const { ref, onKey } = useRovingRadio(options, onChange);
  const selected = options.some((o) => o.value === value);
  const firstEnabled = Math.max(
    0,
    options.findIndex((o) => !o.disabled),
  );
  return (
    <div
      class={`segmented${block ? ' block' : ''}${cls ? ` ${cls}` : ''}`}
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
  labelledBy,
  describedBy,
  class: cls = 'stack stack-sm',
  itemClass = 'choice',
  render,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; disabled?: boolean; tone?: string }[];
  label?: string;
  labelledBy?: string;
  describedBy?: string;
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
    <div
      class={cls}
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      ref={ref}
    >
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
  idle,
  title,
}: {
  tone: string;
  icon?: string;
  children: ComponentChildren;
  small?: boolean;
  /** Outlined: the state exists but is not in effect now (words next to it say so). */
  idle?: boolean;
  title?: string;
}) {
  return (
    <span class={`pill tone-${tone}${small ? ' small' : ''}${idle ? ' idle' : ''}`} title={title}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </span>
  );
}

/**
 * What a rule does (`ruleTypes()`), one pill per type, named as in the "What should happen?"
 * picker. With `inEffect` (Today), the other types are idle.
 */
export function TypePills({
  types,
  inEffect,
}: {
  types: InterventionType[];
  inEffect?: InterventionType | null;
}) {
  return (
    <span class="type-pills">
      {types.map((x) => (
        <StatusPill
          key={x}
          tone={toneOf(x)}
          icon={interventionIcon(x)}
          idle={inEffect !== undefined && x !== inEffect}
        >
          {typeName(x)}
        </StatusPill>
      ))}
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
  /** The id of the control, and the ids that describe it; a group of radios is labelled by `${id}-label`. */
  children: (id: string, describedBy: string | undefined) => ComponentChildren;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy =
    [help ? `${fid}-help` : '', error ? `${fid}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div class="field">
      <label for={fid} id={`${fid}-label`}>
        {label}
      </label>
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

/** As many characters as the largest value has, for the width of a number field. */
const digitsOf = (max: number | undefined, fraction: boolean) =>
  Math.max(2, String(Math.trunc(Math.abs(max ?? 999))).length) + (fraction ? 2 : 0);

/**
 * A number, typed in a text field with a numeric keyboard (`type="number"` changes the value when
 * the page scrolls and has spin arrows too small to hit), stepped with the arrow keys, as wide as
 * its largest value. Its unit, a word or a list of units, is in the same box (`suffix`).
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  fraction,
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
  /** Fractions can be typed (1.5 hours); otherwise the value is a whole number of steps. */
  fraction?: boolean;
  id?: string;
  label?: string;
  describedBy?: string;
  suffix?: ComponentChildren;
  /** Report the value only when the field loses focus or Enter is pressed (settings that are saved at once). */
  commitOnBlur?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(String(value));
  const limit = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  /** The number typed, in whole steps unless fractions are allowed; null for no number. */
  const read = (v: string) => {
    // A decimal comma is read as a point.
    const s = v.trim().replace(',', '.');
    const n = Number(s);
    if (s === '' || !Number.isFinite(n)) return null;
    return fraction ? n : Math.round(n / step) * step;
  };
  const parse = (v: string) => {
    const n = read(v);
    return n === null ? null : limit(n);
  };
  // A value set from outside, or limited to min and max, replaces the text; the value of the text
  // typed does not, or a late update would overwrite keys typed meanwhile ("120" read as "10").
  useEffect(() => {
    if (text === '' || read(text) !== value) setText(String(value));
  }, [value]);
  const typed = parse(text);
  const enter = (v: string) => {
    setText(v);
    const n = parse(v);
    if (!commitOnBlur && n !== null) onChange(n);
  };
  return (
    <span class="quantity">
      <input
        ref={input}
        id={id}
        class="quantity-num"
        type="text"
        inputMode={fraction ? 'decimal' : 'numeric'}
        autoComplete="off"
        role="spinbutton"
        aria-valuenow={typed ?? value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-invalid={typed === null}
        aria-label={label}
        aria-describedby={describedBy}
        style={{ ['--digits' as string]: digitsOf(max, Boolean(fraction)) }}
        value={text}
        onInput={(e) => enter((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const from = typed ?? value;
            // A fraction steps to the next whole step: 1.5 → 2.
            const next = limit(
              e.key === 'ArrowUp'
                ? Math.floor(from / step + 1e-9) * step + step
                : Math.ceil(from / step - 1e-9) * step - step,
            );
            enter(String(Math.round(next * 100) / 100));
          } else if (commitOnBlur && e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => {
          if (commitOnBlur && typed !== null && typed !== value) onChange(typed);
          setText(String(typed ?? value));
        }}
      />
      {typeof suffix === 'string' ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: the input is focusable on its own; a click on its unit is a shortcut.
        // biome-ignore lint/a11y/useKeyWithClickEvents: as above.
        <span class="quantity-unit" onClick={() => input.current?.focus()}>
          {suffix}
        </span>
      ) : (
        suffix
      )}
    </span>
  );
}

/**
 * A list to pick one of many options (five or more, or a list of the person's rules or sites), as
 * wide as its options. Fewer options are all in view: `Segmented` for short names, `RadioList`
 * for long ones.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  id,
  label,
  describedBy,
  disabled,
  class: cls,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  id?: string;
  label?: string;
  describedBy?: string;
  disabled?: boolean;
  class?: string;
}) {
  return (
    <select
      id={id}
      class={cls ? `select ${cls}` : 'select'}
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

/** Two to four choices with long names, one under the other, each with its radio button. */
export function RadioList<T extends string>({
  value,
  onChange,
  options,
  label,
  labelledBy,
  describedBy,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label?: string;
  labelledBy?: string;
  describedBy?: string;
}) {
  return (
    <RadioCards<T>
      value={value}
      onChange={onChange}
      label={label}
      labelledBy={labelledBy}
      describedBy={describedBy}
      class="radio-list"
      itemClass="choice"
      options={options}
      render={(o, checked) => (
        <>
          <span class="radio-dot" aria-hidden="true" />
          <span class={checked ? 'strong' : undefined}>
            {options.find((x) => x.value === o.value)?.label}
          </span>
        </>
      )}
    />
  );
}

export type DurationUnit = 'seconds' | 'minutes' | 'hours' | 'days';
const UNIT_SECONDS: Record<DurationUnit, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };

/**
 * The largest of the units in which an amount (in `base` units) is a whole number: 120 minutes →
 * hours.
 */
export function durationUnit(
  value: number,
  units: DurationUnit[],
  base: DurationUnit = 'minutes',
): DurationUnit {
  const seconds = value * UNIT_SECONDS[base];
  return (
    [...units].reverse().find((u) => seconds >= UNIT_SECONDS[u] && seconds % UNIT_SECONDS[u] === 0) ??
    units[0]
  );
}

/**
 * A length of time as a number and a unit in one box ("2 hours"), kept in one unit (`base`,
 * minutes unless said). Changing the unit keeps the number: 2 minutes become 2 hours.
 */
export function DurationInput({
  value,
  onChange,
  base = 'minutes',
  units: offered = ['minutes', 'hours', 'days'],
  min,
  max,
  unitMax,
  step = 1,
  label,
  id,
  describedBy,
  commitOnBlur,
}: {
  /** In `base` units, as are min, max, unitMax and step. */
  value: number;
  onChange: (value: number, unit: DurationUnit) => void;
  base?: DurationUnit;
  units?: DurationUnit[];
  min: number;
  max: number;
  /** A lower maximum in some units (a period of hours is at most a day). */
  unitMax?: Partial<Record<DurationUnit, number>>;
  /** The precision. */
  step?: number;
  label?: string;
  id?: string;
  describedBy?: string;
  /** Report the value only when the field loses focus (settings that are saved at once). */
  commitOnBlur?: boolean;
}) {
  // A unit larger than the maximum is not offered (hours for at most 15 minutes).
  const units = offered.filter((u, i) => !i || UNIT_SECONDS[u] / UNIT_SECONDS[base] <= max);
  const [unit, setUnit] = useState(() => durationUnit(value, units, base));
  // The value last reported: a different one comes from outside and picks its own unit.
  const own = useRef(value);
  useEffect(() => {
    if (value !== own.current) {
      own.current = value;
      setUnit(durationUnit(value, units, base));
    }
  }, [value]);
  /** One `unit` in `base` units. */
  const per = UNIT_SECONDS[unit] / UNIT_SECONDS[base];
  const top = (u: DurationUnit) => Math.min(max, unitMax?.[u] ?? max);
  const shown = Math.round((value / per) * 100) / 100;
  const report = (v: number, u: DurationUnit) => {
    const clamped = Math.min(top(u), Math.max(min, Math.round(v / step) * step));
    own.current = clamped;
    onChange(clamped, u);
  };
  return (
    <NumberInput
      id={id}
      value={shown}
      // In a larger unit the arrows count whole units; the minimum is applied in `base` units.
      min={unit === base ? min : 0}
      max={top(unit) / per}
      step={unit === base ? step : 1}
      fraction={unit !== base}
      label={label}
      describedBy={describedBy}
      commitOnBlur={commitOnBlur}
      onChange={(n) => report(n * per, unit)}
      suffix={
        units.length === 1 ? (
          t(`duration.unit.${unit}`, { n: shown })
        ) : (
          <Select<DurationUnit>
            value={unit}
            label={label ? t('duration.unitOf', { label }) : t('duration.unit')}
            onChange={(u) => {
              setUnit(u);
              report((shown * UNIT_SECONDS[u]) / UNIT_SECONDS[base], u);
            }}
            options={units.map((u) => ({ value: u, label: t(`duration.unit.${u}`, { n: shown }) }))}
          />
        )
      }
    />
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
  onDismiss,
}: {
  kind?: 'info' | 'warning' | 'danger' | 'ok' | 'accent';
  icon?: string;
  children: ComponentChildren;
  action?: ComponentChildren;
  /** Shows a close button: for a banner about something that happened, not a lasting problem. */
  onDismiss?: () => void;
}) {
  const defaultIcon = kind === 'warning' || kind === 'danger' ? 'alert' : kind === 'ok' ? 'check' : 'info';
  return (
    <div class={`banner ${kind}`} role={kind === 'danger' || kind === 'warning' ? 'alert' : 'status'}>
      <Icon name={icon ?? defaultIcon} />
      <div class="grow stack stack-sm">{children}</div>
      {action}
      {onDismiss && (
        <IconButton icon="x" label={t('common.dismiss')} variant="ghost" size="small" onClick={onDismiss} />
      )}
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

/** Modal dialog on the native <dialog> element: focus is trapped and restored. */
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
