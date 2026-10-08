/**
 * Cost dialog for tickets (BRK-05, PRO-01, PRO-05, INT-04). Steps are verified by the background;
 * this component only presents them. Codes are drawn on a canvas (not in the DOM), paste and
 * synthetic input are refused, and an accessible alternative is offered (A11Y-05).
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n/i18n';
import type { StepView, TicketView } from '../shared/models';
import { call } from '../shared/rpc';
import { describeUnit } from '../shared/summary';
import { Banner, Button, Dialog } from './components';
import { useNow } from './hooks';

/** Draws text on a canvas so it cannot be copied from the DOM (CIR-12). */
export function CanvasText({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const perLine = 24;
    const lines: string[] = [];
    for (let i = 0; i < text.length; i += perLine) lines.push(text.slice(i, i + perLine));
    const ratio = window.devicePixelRatio || 1;
    const width = c.clientWidth || 420;
    const lineH = 30;
    const height = lines.length * lineH + 20;
    c.width = width * ratio;
    c.height = height * ratio;
    c.style.height = `${height}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const style = getComputedStyle(document.documentElement);
    ctx.fillStyle = style.getPropertyValue('--text').trim() || '#000';
    ctx.font = `20px ${style.getPropertyValue('--mono') || 'monospace'}`;
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      // Draw character by character with a small offset so the text is not trivially machine readable.
      let x = 14;
      for (const ch of line) {
        ctx.fillText(ch, x, 10 + i * lineH + (Math.random() * 2 - 1));
        x += 16;
      }
    });
  }, [text]);
  return (
    <canvas
      ref={ref}
      class="challenge-canvas"
      role="img"
      aria-label={t('challenge.canvasLabel', { length: text.length })}
    />
  );
}

/** Text input that accepts only real typing (INT-04: no paste, only trusted events). */
export function TypingInput({
  value,
  onInput,
  id,
  label,
  password,
  autoFocus,
}: {
  value: string;
  onInput: (v: string) => void;
  id?: string;
  label: string;
  password?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      class="input mono"
      {...({ type: password ? 'password' : 'text' } as { type: 'text' })}
      value={value}
      aria-label={label}
      autoComplete="off"
      autoCapitalize="off"
      spellcheck={false}
      autoFocus={autoFocus}
      onPaste={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      onBeforeInput={(e) => {
        if (!e.isTrusted) e.preventDefault();
      }}
      onInput={(e) => {
        const el = e.target as HTMLInputElement;
        if (!e.isTrusted) {
          el.value = value;
          return;
        }
        onInput(el.value);
      }}
    />
  );
}

export function WaitStep({ readyAt, onReady }: { readyAt: number; onReady?: () => void }) {
  const now = useNow(250);
  const left = Math.max(0, Math.ceil((readyAt - now) / 1000));
  const fired = useRef(false);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onReady?.();
    }
  }, [left, onReady]);
  return (
    <div class="stack" style={{ alignItems: 'center' }}>
      <div class="breathe" aria-hidden="true">
        {left}
      </div>
      <p class="muted" role="status" aria-live="polite">
        {left > 0
          ? t('ticket.wait.left', { seconds: left > 10 ? Math.ceil(left / 10) * 10 : left })
          : t('ticket.wait.ready')}
      </p>
    </div>
  );
}

function StepBody({
  step,
  value,
  setValue,
  ticket,
  onSwap,
}: {
  step: StepView;
  value: string;
  setValue: (v: string) => void;
  ticket: TicketView;
  onSwap: (v: TicketView) => void;
}) {
  switch (step.type) {
    case 'confirm':
      return <p>{t('ticket.confirm.body')}</p>;
    case 'wait':
      return (
        <>
          <p>{t('ticket.wait.body', { seconds: step.seconds })}</p>
          <WaitStep readyAt={step.readyAt} />
        </>
      );
    case 'text':
      return (
        <>
          <p>{t('ticket.text.body', { length: step.length })}</p>
          <CanvasText text={step.text} />
          <TypingInput value={value} onInput={setValue} label={t('ticket.text.input')} autoFocus />
          <button
            type="button"
            class="link-btn small"
            onClick={async () => {
              const v = await call('ticket.accessible', { id: ticket.id });
              if (v) onSwap(v);
            }}
          >
            {t('ticket.text.accessible')}
          </button>
        </>
      );
    case 'phrase':
      return (
        <>
          <p>{t('ticket.phrase.body')}</p>
          <blockquote class="card flat tight" style={{ margin: 0 }}>
            {step.phrase}
          </blockquote>
          <TypingInput value={value} onInput={setValue} label={t('ticket.phrase.input')} autoFocus />
        </>
      );
    case 'math':
      return (
        <>
          <p>{t('ticket.math.body')}</p>
          <p class="num" style={{ fontSize: '1.4rem', fontWeight: 650 }}>
            {step.question} = ?
          </p>
          <input
            class="input num"
            inputMode="numeric"
            value={value}
            aria-label={t('ticket.math.input')}
            autoFocus
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          />
        </>
      );
    case 'password':
      return (
        <>
          <p>{t('ticket.password.body')}</p>
          <TypingInput
            value={value}
            onInput={setValue}
            label={t('ticket.password.input')}
            password
            autoFocus
          />
        </>
      );
    case 'reason':
      return (
        <>
          <p>{step.required ? t('ticket.reason.required') : t('ticket.reason.optional')}</p>
          <textarea
            class="textarea"
            value={value}
            aria-label={t('ticket.reason.input')}
            maxLength={500}
            onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
          />
        </>
      );
    case 'intention':
      return <p>{t('ticket.intention.body')}</p>;
  }
}

export function TicketDialog({
  ticket: initial,
  title,
  intro,
  onDone,
  onCancel,
}: {
  ticket: TicketView;
  title: string;
  intro?: ComponentChildren;
  onDone: (result: unknown) => void;
  onCancel: () => void;
}) {
  const [ticket, setTicket] = useState(initial);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(500);
  useEffect(() => setTicket(initial), [initial]);
  const step = ticket.step;
  const waiting = step.type === 'wait' && step.readyAt > now;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('ticket.answer', { id: ticket.id, answer: value });
      if (r.status === 'done') onDone(r.result);
      else if (r.status === 'next') {
        setTicket(r.ticket);
        setValue('');
      } else {
        setError(t(r.error));
        if (r.ticket) setTicket(r.ticket);
      }
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    void call('ticket.cancel', { id: ticket.id });
    onCancel();
  };
  return (
    <Dialog
      open
      onClose={cancel}
      title={title}
      actions={
        <>
          <Button variant="primary" onClick={cancel}>
            {t('ticket.keep')}
          </Button>
          <Button onClick={submit} disabled={busy || waiting}>
            {step.type === 'confirm' ? t('ticket.confirm.action') : t('ticket.continue')}
          </Button>
        </>
      }
    >
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!waiting) void submit();
        }}
      >
        {intro}
        {ticket.units && ticket.units.length > 0 && (
          <ul class="list compact small">
            {ticket.units.map((u, i) => (
              <li key={i}>{describeUnit(u)}</li>
            ))}
          </ul>
        )}
        {ticket.stepCount > 1 && (
          <p class="tiny muted">{t('ticket.step', { n: ticket.stepIndex + 1, total: ticket.stepCount })}</p>
        )}
        <StepBody
          step={step}
          value={value}
          setValue={setValue}
          ticket={ticket}
          onSwap={(v) => {
            setTicket(v);
            setValue('');
          }}
        />
        {error && <Banner kind="danger">{error}</Banner>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
