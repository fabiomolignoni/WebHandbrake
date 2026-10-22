/**
 * Target list editor: paste anything (URLs, lists, uBlock/uBlacklist
 * syntax), see line-by-line errors, exceptions in their own section, sort and de-duplicate,
 * edit everything as text in advanced mode. A short guide with examples sits next to the input.
 */

import type { Ref } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { newId, sortTargets } from '../../engine/defaults';
import { parseTargetList, targetToLine } from '../../engine/patterns';
import type { Target, TargetType } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { describeTarget, targetTypeLabel } from '../../shared/summary';
import { Banner, Button, IconButton, Select } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { ADDRESS_TOPIC, helpRoute } from '../help-content';

const COMPATIBLE: Record<TargetType, TargetType[]> = {
  domain: ['domain', 'host'],
  host: ['host', 'domain'],
  path: ['path', 'page'],
  page: ['page', 'path'],
  homepage: ['homepage', 'domain'],
  wildcard: ['wildcard'],
  regex: ['regex'],
};

function changeType(tg: Target, type: TargetType): Target {
  if (tg.type === 'homepage' && type === 'domain') return { ...tg, type };
  return { ...tg, type };
}

const key = (x: Pick<Target, 'type' | 'value' | 'allow'>) => `${x.type}|${x.value}|${x.allow ? 1 : 0}`;

/**
 * The short guide (#11): the five things people want to do, with an example each (worked examples,
 * task-oriented help). Picking an example puts it in the input, ready to be edited. Every other
 * address type is in Help, which the guide opens at its address table.
 */
const GUIDE: [string, string][] = [
  ['youtube.com', 'targets.guide.site'],
  ['example.com/page$', 'targets.guide.page'],
  ['*news*', 'targets.guide.wildcard'],
  ['*', 'targets.guide.allSites'],
  ['+youtube.com/feed/subscriptions', 'targets.guide.exception'],
];

function Guide({ onPick }: { onPick: (example: string) => void }) {
  return (
    <details class="disclosure guide">
      <summary>
        <Icon name="help" />
        {t('targets.guide.title')}
      </summary>
      <div class="body stack stack-sm">
        <ul class="guide-list plain">
          {GUIDE.map(([code, key]) => (
            <li key={code}>
              <button
                type="button"
                class="guide-example"
                title={t('targets.guide.use')}
                aria-label={t('targets.guide.useExample', { example: code })}
                onClick={() => onPick(code)}
              >
                {code}
              </button>
              <span class="small text-2">{t(key)}</span>
            </li>
          ))}
        </ul>
        <p class="small muted">
          {t('targets.guide.more')} {/* A new tab keeps the rule being edited (#11). */}
          <a href={helpRoute(ADDRESS_TOPIC)} target="_blank" rel="noopener">
            {t('targets.guide.moreLink')}
          </a>
        </p>
      </div>
    </details>
  );
}

function AddBox({
  onAdd,
  exception,
  placeholder,
  text: outerText,
  setText: setOuterText,
  inputRef,
}: {
  onAdd: (lines: string) => string[];
  exception: boolean;
  placeholder: string;
  text?: string;
  setText?: (text: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [innerText, setInnerText] = useState('');
  const text = outerText ?? innerText;
  const setText = setOuterText ?? setInnerText;
  const [errors, setErrors] = useState<string[]>([]);
  const submit = () => {
    if (!text.trim()) return;
    const errs = onAdd(text);
    setErrors(errs);
    if (!errs.length) setText('');
  };
  const multiline = text.includes('\n');
  return (
    <div class="stack stack-sm">
      <div class="row nowrap top">
        {multiline ? (
          <textarea
            class="textarea mono grow"
            value={text}
            aria-label={placeholder}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          />
        ) : (
          <input
            ref={inputRef}
            class="input mono grow"
            value={text}
            placeholder={placeholder}
            aria-label={placeholder}
            autoCapitalize="off"
            spellcheck={false}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData?.getData('text') ?? '';
              if (pasted.includes('\n')) {
                e.preventDefault();
                setText(pasted);
              }
            }}
          />
        )}
        <Button icon="plus" onClick={submit}>
          {exception ? t('targets.addException') : t('targets.add')}
        </Button>
      </div>
      {errors.length > 0 && (
        <Banner kind="warning">
          <strong>{t('targets.errors', { count: errors.length })}</strong>
          <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
            {errors.slice(0, 10).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Banner>
      )}
    </div>
  );
}

/** The address of an entry as typed, without the exception mark. */
const addressOf = (tg: Target) => targetToLine({ ...tg, allow: false });

/**
 * One entry. Its address is edited where it is shown: the pencil, or a click on the address, turns
 * it into a field with the address as typed ("=m.youtube.com" for an exact site). Enter or leaving
 * the field applies it, Escape puts the entry back as it was.
 */
function Row({
  tg,
  advanced,
  onChange,
  onEdit,
  onRemove,
}: {
  tg: Target;
  advanced: boolean;
  onChange: (t: Target) => void;
  /** Returns the error to show, or null when the entry was changed. */
  onEdit: (next: Omit<Target, 'id'>) => string | null;
  onRemove: () => void;
}) {
  const row = useRef<HTMLLIElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // The address being typed, null when the entry is not being edited. Also kept in a ref, so that
  // Enter and the blur that follows apply it once.
  const [draft, setDraftState] = useState<string | null>(null);
  const typed = useRef<string | null>(null);
  const setDraft = (v: string | null) => {
    typed.current = v;
    setDraftState(v);
  };
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const editing = draft !== null;
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);
  const display = tg.type === 'regex' ? `/${tg.value}/` : describeTarget({ ...tg, allow: false });
  const options = COMPATIBLE[tg.type].map((x) => ({ value: x, label: targetTypeLabel(x) }));
  const focusPencil = () =>
    requestAnimationFrame(() => row.current?.querySelector<HTMLButtonElement>('[data-edit]')?.focus());

  const start = () => {
    if (typed.current === null) setDraft(addressOf(tg));
  };
  const stop = () => {
    setDraft(null);
    setError(null);
  };
  /** Applies the typed address. Returns false, and shows why, when it cannot be applied. */
  const apply = (): boolean => {
    if (typed.current === null) return true;
    // The field itself: a value set without an input event (autofill, automation) counts too.
    const value = field.current?.value ?? typed.current;
    if (value !== typed.current) setDraft(value);
    if (value.trim() === addressOf(tg)) {
      stop();
      return true;
    }
    const { targets: parsed, errors } = parseTargetList(value.replace(/^\s*(\+|@@)\s*/, ''));
    let err: string | null = null;
    if (errors.length) err = t(errors[0].error);
    else if (parsed.length !== 1) err = t(parsed.length ? 'targets.error.oneAddress' : 'targets.error.empty');
    else {
      const next: Omit<Target, 'id'> = { ...parsed[0], allow: tg.allow };
      if (!next.allow) delete next.allow;
      err = onEdit(next);
    }
    if (err) setError(err);
    else stop();
    return !err;
  };

  return (
    <li ref={row} class={`target-row${tg.allow ? ' exception' : ''}`}>
      {!editing ? (
        // The pencil is the way in from the keyboard; a click on the address is a shortcut.
        // biome-ignore lint/a11y/useKeyWithClickEvents: the pencil next to it does the same
        // biome-ignore lint/a11y/noStaticElementInteractions: the pencil next to it does the same
        <span class="value" onClick={start}>
          {display}
        </span>
      ) : (
        <span class="value editing">
          <input
            ref={field}
            class="input mono"
            value={draft}
            aria-label={tg.allow ? t('targets.exceptionAddress') : t('targets.address')}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            autoCapitalize="off"
            spellcheck={false}
            onFocus={(e) => {
              const el = e.target as HTMLInputElement;
              el.setSelectionRange(el.value.length, el.value.length);
            }}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onBlur={apply}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (apply()) focusPencil();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                stop();
                focusPencil();
              }
            }}
          />
        </span>
      )}
      {advanced && options.length > 1 ? (
        <span style={{ minWidth: '150px' }}>
          <Select
            value={tg.type}
            onChange={(v) => onChange(changeType(tg, v))}
            options={options}
            label={t('targets.type', { value: tg.value })}
          />
        </span>
      ) : (
        <span class="tag">{targetTypeLabel(tg.type)}</span>
      )}
      {!editing ? (
        <IconButton
          icon="edit"
          size="small"
          variant="ghost"
          data-edit
          label={t('targets.edit', { value: display })}
          onClick={start}
        />
      ) : (
        <IconButton
          icon="check"
          size="small"
          variant="ghost"
          data-edit
          label={t('common.done')}
          // Keeps the focus in the field, so that a refused address can be corrected at once.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (apply()) focusPencil();
          }}
        />
      )}
      <IconButton
        icon="trash"
        size="small"
        variant="ghost"
        label={t('targets.remove', { value: tg.value })}
        onClick={onRemove}
      />
      {error && (
        <span class="error-text" id={errorId} role="alert">
          {error}
        </span>
      )}
    </li>
  );
}

export function TargetsEditor({
  targets,
  onChange,
  advanced,
  exceptions = true,
  hint,
}: {
  targets: Target[];
  onChange: (t: Target[]) => void;
  advanced: boolean;
  exceptions?: boolean;
  hint?: string;
}) {
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');
  const [textErrors, setTextErrors] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // An entry whose address changes gets a new id: its row keeps the key it had, so that it is not
  // rebuilt under the pointer (a click on its bin would be lost) or the keyboard.
  const rowKeys = useRef(new Map<string, string>());
  const rowKey = (tg: Target) => rowKeys.current.get(tg.id) ?? tg.id;
  const blocks = targets.filter((x) => !x.allow);
  const allows = targets.filter((x) => x.allow);
  const pick = (example: string) => {
    setDraft(example);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      el?.focus();
      el?.select();
    });
  };

  const addLines = (lines: string, asException: boolean): string[] => {
    const { targets: parsed, errors } = parseTargetList(lines);
    const existing = new Set(targets.map(key));
    const added: Target[] = [];
    for (const p of parsed) {
      const tg: Target = { ...p, id: newId(), ...(asException || p.allow ? { allow: true } : {}) };
      if (!tg.allow) delete tg.allow;
      if (existing.has(key(tg))) continue;
      existing.add(key(tg));
      added.push(tg);
    }
    if (added.length) onChange([...targets, ...added]);
    return errors.map((e) => t('targets.lineError', { line: e.line, text: e.text, error: t(e.error) }));
  };

  const update = (tg: Target) => onChange(targets.map((x) => (x.id === tg.id ? tg : x)));
  /** Replaces an entry in place. A different address gets a new id, as in text mode, so the
   *  change is a removal plus an addition, each following the rule's protection. */
  const edit = (old: Target, next: Omit<Target, 'id'>): string | null => {
    const same = key(next) === key(old);
    if (!same && targets.some((x) => x.id !== old.id && key(x) === key(next)))
      return t('targets.error.duplicate');
    const id = same ? old.id : newId();
    if (!same) rowKeys.current.set(id, rowKey(old));
    onChange(targets.map((x) => (x.id === old.id ? { ...next, id } : x)));
    return null;
  };
  const remove = (id: string) => onChange(targets.filter((x) => x.id !== id));
  const sort = () => onChange(sortTargets(targets));
  const dedupe = () => {
    const seen = new Set<string>();
    onChange(
      targets.filter((x) => {
        if (seen.has(key(x))) return false;
        seen.add(key(x));
        return true;
      }),
    );
  };

  if (textMode) {
    return (
      <div class="stack">
        <p class="help">{t('targets.textHelp')}</p>
        <textarea
          class="textarea mono"
          rows={14}
          value={text}
          aria-label={t('targets.textMode')}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
        {textErrors.length > 0 && (
          <Banner kind="warning">
            <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
              {textErrors.slice(0, 10).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Banner>
        )}
        <div class="row end">
          <Button variant="ghost" onClick={() => setTextMode(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const { targets: parsed, errors } = parseTargetList(text);
              if (errors.length) {
                setTextErrors(
                  errors.map((e) =>
                    t('targets.lineError', { line: e.line, text: e.text, error: t(e.error) }),
                  ),
                );
                return;
              }
              // Keep the ids of unchanged entries so that the change classifier sees real differences only.
              const byKey = new Map(targets.map((x) => [key(x), x]));
              onChange(
                parsed.map((p) => {
                  const old = byKey.get(key({ ...p, allow: Boolean(p.allow) }));
                  return old ?? { ...p, id: newId() };
                }),
              );
              setTextMode(false);
            }}
          >
            {t('targets.applyText')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div class="stack">
      {hint && <p class="help">{hint}</p>}
      <AddBox
        onAdd={(l) => addLines(l, false)}
        exception={false}
        placeholder={t('targets.addPlaceholder')}
        text={draft}
        setText={setDraft}
        inputRef={inputRef}
      />
      <Guide onPick={pick} />
      <div class="row between">
        <span class="small muted">
          {exceptions || allows.length
            ? t('targets.count', { sites: blocks.length, exceptions: allows.length })
            : t('groups.sites', { count: blocks.length })}
        </span>
        <div class="row">
          <Button size="small" variant="ghost" icon="list" onClick={sort} disabled={targets.length < 2}>
            {t('targets.sort')}
          </Button>
          <Button size="small" variant="ghost" icon="copy" onClick={dedupe} disabled={targets.length < 2}>
            {t('targets.dedupe')}
          </Button>
          {advanced && (
            <Button
              size="small"
              variant="ghost"
              icon="edit"
              onClick={() => {
                setText(targets.map(targetToLine).join('\n'));
                setTextErrors([]);
                setTextMode(true);
              }}
            >
              {t('targets.textMode')}
            </Button>
          )}
        </div>
      </div>
      {blocks.length > 0 && (
        <ul class="list compact" aria-label={t('targets.sites')}>
          {blocks.map((tg) => (
            <Row
              key={rowKey(tg)}
              tg={tg}
              advanced={advanced}
              onChange={update}
              onEdit={(next) => edit(tg, next)}
              onRemove={() => remove(tg.id)}
            />
          ))}
        </ul>
      )}
      {(exceptions || allows.length > 0) && (
        <div class="stack stack-sm" style={{ marginTop: '8px' }}>
          <h4>{t('targets.exceptions')}</h4>
          <p class="help">{t('targets.exceptionsHelp')}</p>
          {allows.length > 0 && (
            <ul class="list compact" aria-label={t('targets.exceptions')}>
              {allows.map((tg) => (
                <Row
                  key={rowKey(tg)}
                  tg={tg}
                  advanced={advanced}
                  onChange={update}
                  onEdit={(next) => edit(tg, next)}
                  onRemove={() => remove(tg.id)}
                />
              ))}
            </ul>
          )}
          {exceptions && (
            <AddBox
              onAdd={(l) => addLines(l, true)}
              exception
              placeholder={t('targets.addExceptionPlaceholder')}
            />
          )}
        </div>
      )}
    </div>
  );
}
