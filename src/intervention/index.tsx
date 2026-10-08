/**
 * Intervention page: block, delay, intention question, challenge, session,
 * cool-down and protected browser pages. Calm design, healthy choice first (principle G3, INT-01).
 * The page always re-checks with the background, which has the last word (ENF-09).
 */

import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n/i18n';
import { formatWhen } from '../shared/format';
import type { DecisionView, InterventionModel, StepView, TicketView } from '../shared/models';
import { call } from '../shared/rpc';
import { setWeekStart } from '../shared/summary';
import { Banner, Button, ColorDot, Segmented, Toasts, toast } from '../ui/components';
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

/** ENF-09: never bounce forever between the page and the site. */
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

/** The icon at the top of the page: what kind of pause this is (docs/design.md). */
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
        await call('intervention.left', { url, how: 'close' });
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

  useEffect(() => {
    titleRef.current?.focus();
  }, [m?.kind]);

  // ENF-04: when the restriction ends, offer to reopen the page (or reopen automatically).
  const recheck = async () => {
    if (!m || m.kind === 'selftest' || m.kind === 'allow') return;
    const d: DecisionView = await call('explain', { url });
    if (d.severity < 4) {
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
  // ENF-10: coming back with the back button re-checks.
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
    await call('intervention.left', { url, how: 'close' });
    await call('tabs.close', {});
  };
  const goBack = async () => {
    await call('intervention.left', { url, how: 'back' });
    if (history.length > 1) history.back();
    else await call('tabs.close', {});
  };
  const saveLater = async () => {
    await call('later.add', { url, title: m.host, groupId: m.group?.id });
    await call('intervention.left', { url, how: 'later' });
    setSaved(true);
    toast(t('iv.saved'));
  };

  const passed = () => {
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
          <PassStep ticket={m.ticket!} url={url} model={m} onPassed={passed} onClose={closeTab} />
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

        {m.alternatives.length > 0 && m.kind !== 'selftest' && (
          <div class="stack stack-sm" style={{ alignItems: 'center' }}>
            <span class="section-title">{t('iv.alternatives')}</span>
            <div class="alternatives">
              {m.alternatives.map((a) =>
                a.url ? (
                  <Button
                    key={a.id}
                    size="small"
                    icon="external"
                    onClick={async () => {
                      await call('intervention.left', { url, how: 'alternative' });
                      go(a.url!);
                    }}
                  >
                    {a.label}
                  </Button>
                ) : (
                  <span key={a.id} class="alt">
                    <Icon name="leaf" />
                    {a.label}
                  </span>
                ),
              )}
            </div>
          </div>
        )}

        {m.pause && m.kind !== 'session' && (
          <p class="break-link">
            {m.pause.available ? (
              <>
                <button type="button" class="link-btn" onClick={() => setPauseOpen(true)}>
                  {t('iv.takeBreak')}
                </button>{' '}
                · {[costsLabel(m.pause.costs), pauseBudgetLabel(m.pause)].filter(Boolean).join(' · ')}
              </>
            ) : (
              m.pause.reason && t(m.pause.reason)
            )}
          </p>
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

const SUGGESTIONS = ['iv.ask.s1', 'iv.ask.s2', 'iv.ask.s3', 'iv.ask.s4'];
const RING = 2 * Math.PI * 46;

/** Delay, intention question or challenge (INT-02, INT-03, INT-04). */
function PassStep({
  ticket: initial,
  url,
  model,
  onPassed,
  onClose,
}: {
  ticket: TicketView;
  url: string;
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const step: StepView = ticket.step;
  const now = useNow(250);
  const intervention = model.decision?.intervention;
  const delayOpts = intervention?.type === 'delay' ? intervention : null;

  // INT-02 b: the countdown pauses or restarts when the page loses focus.
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

  const left = Math.max(0, Math.ceil((readyAt - now) / 1000));
  const waiting = (step.type === 'wait' || step.type === 'intention') && left > 0;

  const submit = async () => {
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
      } else {
        setError(t(r.error));
        if (r.ticket) setTicket(r.ticket);
      }
    } finally {
      setBusy(false);
    }
  };

  // INT-02 a: automatic continuation.
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
          {/* Announced at a moderate pace (A11Y-03); sighted users follow the ring. */}
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
          <label class="label" for="intention">
            {t('iv.ask.question')}
          </label>
          <div class="chips">
            {SUGGESTIONS.map((k) => (
              <button
                key={k}
                type="button"
                class="chip"
                aria-pressed={value === t(k)}
                onClick={() => setValue(t(k))}
              >
                {t(k)}
              </button>
            ))}
          </div>
          <input
            id="intention"
            class="input"
            value={value}
            maxLength={300}
            placeholder={t('iv.ask.placeholder')}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          />
          <div class="field">
            <span class="label" id="how-long">
              {t('iv.ask.howLong')}
            </span>
            <Segmented
              value={minutes}
              onChange={setMinutes}
              labelledBy="how-long"
              options={step.choices
                .filter((c) => c <= step.maxMinutes)
                .map((c) => ({ value: c, label: t('common.minutes', { n: c }) }))}
            />
          </div>
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
      <p class="tiny muted center">
        {t('iv.continueNote')} {url && null}
      </p>
    </form>
  );
}

// The page is web accessible (needed by the redirect rules): refuse to run inside a frame
// so that a site cannot embed it and trick the user into clicking (clickjacking).
if (window.top === window) render(<App />, document.getElementById('app')!);
