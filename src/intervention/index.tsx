/**
 * Intervention page: block, delay, intention question, challenge, session,
 * cool-down and protected browser pages. Calm design, healthy choice first.
 * The page always re-checks with the background, which has the last word.
 */

import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isNav } from '../engine/severity';
import { t } from '../i18n/i18n';
import { formatDuration, formatList, formatWhen } from '../shared/format';
import type { DecisionView, InterventionModel, PauseOptions, StepView, TicketView } from '../shared/models';
import { call } from '../shared/rpc';
import { setWeekStart } from '../shared/summary';
import { Banner, Button, ColorDot, DurationInput, Field, Segmented, Toasts, toast } from '../ui/components';
import { Explain } from '../ui/explain';
import { bootPage, onBackgroundChange, useNow } from '../ui/hooks';
import { Icon } from '../ui/icons';
import { costsLabel, PauseDialog, pauseBudgetLabel } from '../ui/pause';
import { CanvasText, TypingInput } from '../ui/ticket';

const blockedUrl = () => decodeHash(location.hash.slice(1));

function decodeHash(h: string): string {
  // The URL is appended raw by the redirect rule; tolerate encoded forms too.
  if (/^https?%3A/i.test(h)) {
    try {
      return decodeURIComponent(h);
    } catch {
      return h;
    }
  }
  return h;
}

/** Never bounce forever between the page and the site. */
function bounceGuard(url: string): boolean {
  try {
    const key = `whb-bounce:${url}`;
    const now = Date.now();
    const list = (JSON.parse(sessionStorage.getItem(key) ?? '[]') as number[]).filter(
      (x) => now - x < 20_000,
    );
    list.push(now);
    sessionStorage.setItem(key, JSON.stringify(list));
    return list.length <= 3;
  } catch {
    return true;
  }
}

function go(url: string) {
  // Web pages are opened directly; never javascript: or data: URLs, even from an imported configuration.
  if (/^https?:\/\//i.test(url)) location.replace(url);
}

/**
 * Goes (back) to the blocked URL. Local files and browser pages cannot be opened by an extension
 * page: the background reopens them in this tab, or, where the browser refuses it, history.back()
 * returns to them (they were replaced after loading, so they are in the history).
 */
async function returnTo(url: string) {
  if (/^https?:\/\//i.test(url)) {
    location.replace(url);
    return;
  }
  const r = await call('tabs.reopen', { url }).catch(() => ({ ok: false }));
  if (!r.ok && history.length > 1) history.back();
}

let customSheet: CSSStyleSheet | null = null;

/** The user's custom CSS, replaced (not added again) every time the model is reloaded. */
function applyCustomCss(css: string) {
  if (!css && !customSheet) return;
  try {
    if (!customSheet) {
      customSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, customSheet];
    }
    customSheet.replaceSync(css);
  } catch {
    // invalid CSS is ignored
  }
}

function headline(m: InterventionModel): string {
  const until = m.until ? formatWhen(m.until) : null;
  switch (m.kind) {
    case 'session':
      return until ? t('iv.session.until', { when: until }) : t('iv.session');
    case 'cooldown':
      return until ? t('iv.cooldown.until', { when: until }) : t('iv.cooldown');
    case 'internal':
      return t('iv.internal');
    case 'delay':
      return t('iv.delay');
    case 'ask':
      return t('iv.ask', { host: m.hideUrl ? (m.group?.name ?? '') : m.host });
    case 'challenge':
      return t('iv.challenge');
    case 'close':
      return t('iv.close');
    case 'redirect':
      return t('iv.redirect');
    case 'selftest':
      return t('iv.selftest');
    default:
      return until ? t('iv.block.until', { when: until }) : t('iv.block');
  }
}

/** The icon at the top of the page: what kind of pause this is. */
function emblem(m: InterventionModel): string {
  switch (m.kind) {
    case 'session':
      return 'target';
    case 'cooldown':
      return 'hourglass';
    case 'internal':
      return 'shield';
    case 'ask':
      return 'chat';
    case 'challenge':
      return 'keyboard';
    case 'delay':
      return 'wind';
    case 'selftest':
      return 'check-circle';
    default:
      return 'brake';
  }
}

function App() {
  const url = blockedUrl();
  const [m, setM] = useState<InterventionModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [saved, setSaved] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const load = async () => {
    try {
      const model = await call('intervention.get', { url });
      setM(model);
      applyCustomCss(model.customCss);
      document.title = model.hideUrl ? t('iv.title') : `${model.host} — ${t('iv.title')}`;
      if (model.kind === 'allow') {
        if (/^https?:/i.test(url) && bounceGuard(url)) go(url);
        else if (!/^https?:/i.test(url)) setReopen(true);
        else setError(t('iv.loop'));
      } else if (model.kind === 'close') {
        await call('intervention.left', {});
        await call('tabs.close', {});
      } else if (model.kind === 'redirect' && model.redirectUrl) {
        go(model.redirectUrl);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void bootPage().then((s) => {
      setWeekStart(s.weekStart);
      return load();
    });
  }, []);

  // The next rule of the page moves the focus too, even with an intervention of the same kind.
  useEffect(() => {
    titleRef.current?.focus();
  }, [m?.kind, m?.group?.id]);

  // When the restriction ends, offer to reopen the page (or reopen automatically).
  const recheck = async () => {
    if (!m || m.kind === 'selftest' || m.kind === 'allow') return;
    const d: DecisionView = await call('explain', { url });
    if (!isNav(d)) {
      const settings = (await call('config.get', {})).config.settings;
      if (settings.interventions.autoReopen) void returnTo(url);
      else setReopen(true);
    } else if (!['delay', 'ask', 'challenge'].includes(m.kind) || d.intervention.type !== m.kind) {
      setReopen(false);
      void load();
    }
  };
  useEffect(() => onBackgroundChange(() => void recheck()), [m]);
  useEffect(() => {
    if (!m?.until) return;
    const delay = m.until - Date.now() + 800;
    if (delay < 0 || delay > 2 ** 31 - 1) return;
    const id = setTimeout(() => void recheck(), delay);
    return () => clearTimeout(id);
  }, [m?.until]);
  // Coming back with the back button re-checks.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) void recheck();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [m]);

  if (error) {
    return (
      <main class="intervention">
        <div class="panel">
          <span class="emblem" aria-hidden="true">
            <Icon name="brake" />
          </span>
          <Banner kind="warning">{error}</Banner>
        </div>
      </main>
    );
  }
  if (!m || m.kind === 'allow' || m.kind === 'close' || m.kind === 'redirect') {
    return (
      <main class="intervention" aria-busy="true">
        <div class="panel">
          <span class="emblem" aria-hidden="true">
            <Icon name="brake" />
          </span>
          {reopen ? (
            <Button variant="primary" size="large" onClick={() => history.back()}>
              {t('iv.back')}
            </Button>
          ) : (
            <p class="muted">{t('common.loading')}</p>
          )}
        </div>
      </main>
    );
  }

  const closeTab = async () => {
    await call('intervention.left', {});
    await call('tabs.close', {});
  };
  const goBack = async () => {
    await call('intervention.left', {});
    if (history.length > 1) history.back();
    else await call('tabs.close', {});
  };
  const saveLater = async () => {
    await call('later.add', { url, title: m.host, groupId: m.group?.id });
    await call('intervention.left', {});
    setSaved(true);
    toast(t('iv.saved'));
  };

  const passed = async () => {
    // Another rule may still restrict the page: it asks next, here.
    const d = await call('explain', { url }).catch(() => null);
    if (d && isNav(d)) return void load();
    if (bounceGuard(url)) void returnTo(url);
  };
  const passable = Boolean(m.ticket) && !reopen;

  return (
    <main class="intervention" style={m.group ? { ['--group' as string]: m.group.color } : undefined}>
      <div class="panel">
        <span class="emblem" aria-hidden="true">
          <Icon name={emblem(m)} />
        </span>
        <h1 ref={titleRef} tabIndex={-1}>
          {headline(m)}
        </h1>
        {m.kind === 'selftest' && <Banner kind="ok">{t('iv.selftest.body')}</Banner>}
        {m.kind === 'internal' && <p class="message">{t('iv.internal.body')}</p>}
        {m.group?.note && (
          <blockquote class="note">
            “{m.group.note}”<span class="by">— {t('iv.yourNote')}</span>
          </blockquote>
        )}
        {m.group?.message && <p class="pre message">{m.group.message}</p>}
        {m.kind !== 'selftest' && (
          <p class="meta">
            {!m.hideUrl && <span>{m.host}</span>}
            {m.group && (
              <span class="row nowrap" style={{ gap: '6px' }}>
                <ColorDot color={m.group.color} />
                {t('iv.group', { group: m.group.name })}
              </span>
            )}
            {m.decision && (
              <button type="button" class="link-btn" aria-expanded={why} onClick={() => setWhy(!why)}>
                {t('iv.why')}
              </button>
            )}
          </p>
        )}
        {m.others.length > 0 && (
          <p class="small muted others">
            {t('iv.others', { count: m.others.length, rules: formatList(m.others.map((o) => o.name)) })}
            {m.ticket && <> {t('iv.othersNext', { count: m.others.length })}</>}
          </p>
        )}
        {why && m.decision && (
          <div class="card why">
            <Explain d={m.decision} />
          </div>
        )}

        {reopen && (
          <Banner
            kind="ok"
            action={
              <Button variant="primary" onClick={() => void returnTo(url)}>
                {t('iv.reopen')}
              </Button>
            }
          >
            {t('iv.nowAllowed')}
          </Banner>
        )}

        {passable ? (
          <PassStep key={m.ticket!.id} ticket={m.ticket!} model={m} onPassed={passed} onClose={closeTab} />
        ) : (
          m.kind !== 'selftest' && (
            <div class="actions">
              <Button variant="primary" size="large" icon="x" onClick={closeTab}>
                {t('iv.closeTab')}
              </Button>
            </div>
          )
        )}
        {m.kind !== 'selftest' && (
          <div class="secondary-actions">
            <Button variant="ghost" onClick={goBack} icon="arrow-left">
              {t('iv.goBack')}
            </Button>
            {m.canSaveLater && (
              <Button variant="ghost" onClick={saveLater} icon="bookmark" disabled={saved}>
                {saved ? t('iv.savedShort') : t('iv.saveLater')}
              </Button>
            )}
          </div>
        )}

        {m.pause && m.kind !== 'session' && !reopen && (
          <BreakOffer pause={m.pause} onTake={() => setPauseOpen(true)} />
        )}
        {m.kind === 'session' && m.locked && <p class="small muted">{t('iv.session.locked')}</p>}
      </div>
      {pauseOpen && m.pause && (
        <PauseDialog
          options={m.pause}
          url={url}
          onClose={() => setPauseOpen(false)}
          onStarted={() => void returnTo(url)}
        />
      )}
      <Toasts />
    </main>
  );
}

/**
 * The break the rule allows, as one quiet row under the actions: the whole row opens the break,
 * with what it costs and how many are left on lines of their own; or why there is none now.
 */
function BreakOffer({ pause, onTake }: { pause: PauseOptions; onTake: () => void }) {
  const icon = (
    <span class="break-icon" aria-hidden="true">
      <Icon name="pause" />
    </span>
  );
  if (!pause.available) {
    return (
      <p class="break-offer off">
        {icon}
        <span class="break-text">{pause.reason && t(pause.reason)}</span>
      </p>
    );
  }
  const left = pauseBudgetLabel(pause);
  return (
    <button
      type="button"
      class="break-offer"
      aria-labelledby="break-title"
      aria-describedby="break-terms"
      onClick={onTake}
    >
      {icon}
      <span class="break-text">
        <span class="break-title" id="break-title">
          {t('iv.takeBreak')}
        </span>
        <span class="break-terms" id="break-terms">
          <span class="break-cost">
            {pause.costs.length
              ? t('pause.summary.cost', { cost: costsLabel(pause.costs) })
              : t('pause.summary.free')}
          </span>
          {left && <span class="break-left">{left}</span>}
        </span>
      </span>
      <Icon name="chevron-right" />
    </button>
  );
}

const RING = 2 * Math.PI * 46;

/** Delay, intention question or challenge. */
function PassStep({
  ticket: initial,
  model,
  onPassed,
  onClose,
}: {
  ticket: TicketView;
  model: InterventionModel;
  onPassed: () => void;
  onClose: () => void;
}) {
  const [ticket, setTicket] = useState(initial);
  const [value, setValue] = useState('');
  // The first duration offered: choices above the maximum are not shown.
  const firstChoice = (st: StepView) =>
    st.type === 'intention' ? (st.choices.find((c) => c <= st.maxMinutes) ?? st.choices[0]) : 5;
  const [minutes, setMinutes] = useState<number>(() => firstChoice(initial.step));
  // Another number of minutes, typed, up to the maximum.
  const [custom, setCustom] = useState(false);
  // Going in always takes a reason.
  const [missing, setMissing] = useState(false);
  const reasonRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const step: StepView = ticket.step;
  const now = useNow(250);
  const intervention = model.decision?.intervention;
  const delayOpts = intervention?.type === 'delay' ? intervention : null;

  // The countdown pauses or restarts when the page loses focus.
  const waitSeconds = step.type === 'wait' ? step.seconds : (delayOpts?.seconds ?? 0);
  const [readyAt, setReadyAt] = useState<number>(
    step.type === 'wait' || step.type === 'intention' ? step.readyAt : 0,
  );
  useEffect(() => {
    if (step.type === 'wait' || step.type === 'intention') setReadyAt(step.readyAt);
  }, [ticket]);
  useEffect(() => {
    if (!delayOpts || delayOpts.onBlur === 'ignore') return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt) {
        const away = Date.now() - hiddenAt;
        hiddenAt = 0;
        // The wait of this ticket (random or increasing delays make it longer than the base).
        if (delayOpts.onBlur === 'restart') setReadyAt(Date.now() + waitSeconds * 1000);
        else setReadyAt((r) => r + away);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [delayOpts, waitSeconds]);

  // Never more than the wait itself: the page's clock may be a moment behind when it opens.
  const total = step.type === 'wait' || step.type === 'intention' ? step.seconds : Number.POSITIVE_INFINITY;
  const left = Math.max(0, Math.min(total, Math.ceil((readyAt - now) / 1000)));
  // Durations above the maximum are never offered.
  const offered = step.type === 'intention' ? step.choices.filter((c) => c <= step.maxMinutes) : [];
  const waiting = (step.type === 'wait' || step.type === 'intention') && left > 0;

  const submit = async () => {
    if (step.type === 'intention' && !value.trim()) {
      setMissing(true);
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await call('ticket.answer', { id: ticket.id, answer: value, minutes });
      if (r.status === 'done') onPassed();
      else if (r.status === 'next') {
        // A new step starts empty: what was typed for the previous one does not carry over.
        setTicket(r.ticket);
        setValue('');
        setMinutes(firstChoice(r.ticket.step));
        setCustom(false);
      } else {
        setError(t(r.error));
        if (r.ticket) setTicket(r.ticket);
      }
    } finally {
      setBusy(false);
    }
  };

  // Automatic continuation.
  const auto = useRef(false);
  useEffect(() => {
    if (step.type === 'wait' && delayOpts?.autoContinue && left === 0 && !auto.current) {
      auto.current = true;
      void submit();
    }
  }, [left]);

  return (
    <form
      class="card stack pass"
      // The page checks the answers itself: no browser bubbles (a typed duration is capped, not refused).
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!waiting) void submit();
      }}
    >
      {step.type === 'wait' && (
        <div class="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <div class="breathe" aria-hidden="true">
            <svg viewBox="0 0 100 100" focusable="false" aria-hidden="true">
              <circle class="track" cx="50" cy="50" r="46" />
              <circle
                class="value"
                cx="50"
                cy="50"
                r="46"
                style={{
                  strokeDasharray: `${RING}`,
                  strokeDashoffset: `${RING * (1 - (waitSeconds > 0 ? Math.min(1, left / waitSeconds) : 0))}`,
                }}
              />
            </svg>
            <span>{delayOpts?.hideCountdown ? '' : left}</span>
          </div>
          {/* Announced at a moderate pace; sighted users follow the ring. */}
          <p
            class={left > 0 && !delayOpts?.hideCountdown ? 'sr-only' : 'muted'}
            role="status"
            aria-live="polite"
          >
            {left > 0
              ? delayOpts?.hideCountdown
                ? t('iv.delay.hidden')
                : t('iv.delay.left', { seconds: left > 10 ? Math.ceil(left / 10) * 10 : left })
              : t('iv.delay.ready')}
          </p>
          {left > 0 && !delayOpts?.hideCountdown && (
            <p class="muted" aria-hidden="true">
              {t('iv.delay.hint')}
            </p>
          )}
          {delayOpts?.onBlur === 'restart' && <p class="tiny muted">{t('iv.delay.restartNote')}</p>}
        </div>
      )}
      {step.type === 'intention' && (
        <>
          <Field
            label={t('iv.ask.reason')}
            id="intention"
            error={missing ? t('ticket.error.intentionRequired') : null}
          >
            {(id, describedBy) => (
              <input
                id={id}
                ref={reasonRef}
                class="input"
                value={value}
                maxLength={300}
                aria-required="true"
                aria-invalid={missing || undefined}
                aria-describedby={describedBy}
                placeholder={t('iv.ask.placeholder')}
                onInput={(e) => {
                  setValue((e.target as HTMLInputElement).value);
                  setMissing(false);
                }}
              />
            )}
          </Field>
          <div class="field">
            <span class="label" id="how-long">
              {t('iv.ask.howLong')}
            </span>
            <Segmented<number | 'custom'>
              value={custom ? 'custom' : minutes}
              onChange={(v) => {
                setCustom(v === 'custom');
                if (v !== 'custom') setMinutes(v);
              }}
              labelledBy="how-long"
              options={[
                ...offered.map((c) => ({ value: c, label: t('common.minutes', { n: c }) })),
                // Hidden when every possible duration is already a choice.
                ...(step.maxMinutes > offered.length
                  ? [{ value: 'custom' as const, label: t('iv.ask.other') }]
                  : []),
              ]}
            />
          </div>
          {custom && (
            <Field
              label={t('iv.ask.custom')}
              help={t('iv.ask.upTo', { duration: formatDuration(step.maxMinutes * 60) })}
            >
              {(id, describedBy) => (
                <DurationInput
                  units={['minutes', 'hours']}
                  id={id}
                  value={minutes}
                  min={1}
                  max={step.maxMinutes}
                  label={t('iv.ask.custom')}
                  describedBy={describedBy}
                  onChange={(n) => setMinutes(Math.max(1, Math.round(n)))}
                />
              )}
            </Field>
          )}
          {left > 0 && (
            <p class="muted small" role="status" aria-live="polite">
              {t('iv.ask.wait', { seconds: left })}
            </p>
          )}
        </>
      )}
      {step.type === 'text' && (
        <>
          <p>{t('iv.challenge.body', { length: step.length })}</p>
          <CanvasText text={step.text} />
          <TypingInput value={value} onInput={setValue} label={t('ticket.text.input')} />
          <button
            type="button"
            class="link-btn small"
            onClick={async () => {
              const v = await call('ticket.accessible', { id: ticket.id });
              if (v) {
                setTicket(v);
                setValue('');
              }
            }}
          >
            {t('ticket.text.accessible')}
          </button>
        </>
      )}
      {step.type === 'phrase' && (
        <>
          <p>{t('ticket.phrase.body')}</p>
          <blockquote class="card flat tight" style={{ margin: 0 }}>
            {step.phrase}
          </blockquote>
          <TypingInput value={value} onInput={setValue} label={t('ticket.phrase.input')} />
        </>
      )}
      {step.type === 'math' && (
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
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          />
        </>
      )}
      {error && <Banner kind="danger">{error}</Banner>}
      <div class="choice-actions">
        <Button variant="primary" size="large" icon="x" onClick={onClose}>
          {step.type === 'intention' ? t('iv.notNow') : t('iv.closeTab')}
        </Button>
        <Button type="submit" size="large" disabled={busy || waiting} icon="chevron-right">
          {step.type === 'intention' ? t('iv.ask.continue', { minutes }) : t('iv.continue')}
        </Button>
      </div>
    </form>
  );
}

// The page is web accessible (needed by the redirect rules): refuse to run inside a frame
// so that a site cannot embed it and trick the user into clicking (clickjacking).
if (window.top === window) render(<App />, document.getElementById('app')!);
