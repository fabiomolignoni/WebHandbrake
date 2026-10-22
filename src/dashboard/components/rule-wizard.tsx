/**
 * Creating a rule, step by step: which sites → when → what happens → protection →
 * review. Creating is an infrequent task done by people who are new to the concepts, so it is a
 * short wizard (NN/g); the rule editor shows the same steps as parts. The steps build an if-then
 * plan ("When I open these sites…, then…"), and the review states it in a sentence.
 *
 * The same steps create a new rule from Rules (`GroupWizardPage`) and the first rule in first run
 * (`WelcomePage`): only the top of the page, the first step's button and what happens once the
 * rule exists differ.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { TEMPLATES } from '../../data/templates';
import {
  addTemplate,
  breaksLift,
  DAY_MINUTES,
  DEFAULT_PROTECTION,
  defaultPause,
  everyPeriod,
  GROUP_COLORS,
  newGroup,
  newId,
  periodMinutes,
  type QuickHow,
  type QuickWhen,
  quickIntervention,
  quickPolicies,
  SCHEDULE_PRESETS,
  targetKey,
  targetsFromLines,
} from '../../engine/defaults';
import { clone } from '../../engine/json';
import type { Group, Intervention, PausePolicy, Protection, Target, TimeWindow } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { formatDuration } from '../../shared/format';
import { Banner, Button, DurationInput, GroupTile, RadioCards, Toggle } from '../../ui/components';
import { GROUP_ICONS, Icon } from '../../ui/icons';
import { toneOf } from '../../ui/status';
import { useDashboard } from '../context';
import { planSentence, sitesPhrase } from '../plan';
import { DailyMinutes } from './daily-minutes';
import { HowPicker, type KeptInterventions, quickInterventionReady } from './how-picker';
import { PauseEditor, pauseRulesSummary } from './pause-editor';
import { ProtectionPicker, protectionLabel } from './protection-picker';
import { WindowsEditor } from './schedule';
import { TargetsEditor } from './targets';

const STEPS = ['sites', 'when', 'how', 'protection', 'review'] as const;
const WHEN: QuickWhen[] = ['always', 'schedule', 'daily'];
const WHEN_ICON: Record<QuickWhen, string> = { always: 'zap', schedule: 'calendar', daily: 'hourglass' };

interface State {
  /** The id the rule will have, so that a partner code is set up for it before it exists. */
  id: string;
  step: number;
  templates: string[];
  targets: Target[];
  name: string;
  nameTouched: boolean;
  when: QuickWhen;
  windows: TimeWindow[];
  minutes: number;
  /** "Other" is chosen for the time allowed (#13). */
  customMinutes: boolean;
  /** The time allowed starts again every so many minutes: a day unless changed. */
  every: number;
  /** Each site gets its own time allowed, instead of sharing it with the others of the rule. */
  perSite: boolean;
  /** What happens, with the settings chosen (#14); null until a choice is made. */
  intervention: Intervention | null;
  /** The settings chosen for each intervention tried (#14). */
  kept: KeptInterventions;
  /**
   * #12: the rule's protection, chosen actively (nothing is pre-selected). A password or
   * a partner code is never kept in storage: a resumed wizard asks for the protection again.
   */
  protection: Protection | null;
  /** #15: the rule's breaks, off until turned on, as in the full editor. */
  pause: PausePolicy;
  note: string;
  color: string;
  icon: string;
  lookTouched: boolean;
}

/** The wizard keeps its state for the session: leaving and coming back resumes it (NN/g). */
function load(store: string): State | null {
  try {
    const raw = sessionStorage.getItem(store);
    const s = raw
      ? (JSON.parse(raw) as State & { how?: QuickHow | null; redirectUrl?: string; breaks?: boolean })
      : null;
    if (!s) return null;
    // A wizard started by an earlier version kept only the kind of intervention.
    const intervention =
      s.intervention !== undefined ? s.intervention : s.how ? quickIntervention(s.how, s.redirectUrl) : null;
    const protection = s.protection ?? null;
    return {
      ...s,
      id: s.id ?? newId(),
      // A password or a partner code was not kept: past the protection step, the review would
      // show (and create) the default protection instead of the one chosen.
      step: protection ? s.step : Math.min(s.step, STEPS.indexOf('protection')),
      intervention,
      kept: s.kept ?? {},
      customMinutes: Boolean(s.customMinutes),
      every: s.every ?? DAY_MINUTES,
      perSite: Boolean(s.perSite),
      protection,
      // A wizard started by an earlier version kept only whether breaks were allowed.
      pause: s.pause ?? { ...defaultPause(), allowed: Boolean(s.breaks) },
      // A ready-made list may have been removed since.
      templates: (s.templates ?? []).filter((id) => TEMPLATES.some((x) => x.id === id)),
    };
  } catch {
    return null;
  }
}
function persist(store: string, s: State | null) {
  try {
    if (s) sessionStorage.setItem(store, JSON.stringify({ ...s, protection: withoutSecret(s.protection) }));
    else sessionStorage.removeItem(store);
  } catch {
    // storage unavailable: the wizard still works, it just does not resume
  }
}

/** Whether a rule was started in this session and not created or cancelled yet. */
export function hasRuleDraft(store: string): boolean {
  try {
    return sessionStorage.getItem(store) !== null;
  } catch {
    return false;
  }
}
/** Forgets the rule started in this session. */
export const discardRuleDraft = (store: string) => persist(store, null);

export function RuleWizard({
  store,
  template = null,
  head,
  before,
  class: extraClass = '',
  onBack,
  onCancel,
  onFullEditor,
  create,
  review,
}: {
  /** The session storage key of the draft. */
  store: string;
  /** A ready-made list to start from; a fresh draft is started. */
  template?: string | null;
  /** The top of the page: its heading and links. */
  head: ComponentChildren;
  /** A step shown as done before the wizard's own (first run: "Installed"). */
  before?: string;
  class?: string;
  /** The first step's button goes back and keeps the draft (first run)… */
  onBack?: () => void;
  /** …or cancels: the draft is discarded. */
  onCancel?: () => void;
  /** Offers the full editor, which takes over the draft. */
  onFullEditor?: (draft: Group) => void;
  /** Saves the new rule; resolves to true once it exists, and the draft is discarded. */
  create: (g: Group) => Promise<boolean>;
  /** More on the review, after the plan's details (first run: access to websites). */
  review?: ComponentChildren;
}) {
  const { model } = useDashboard();
  const cfg = model.config;
  const titleRef = useRef<HTMLHeadingElement>(null);

  const fresh = (): State => {
    const used = new Set(cfg.groups.map((g) => g.color));
    const s: State = {
      id: newId(),
      step: 0,
      templates: [],
      targets: [],
      name: '',
      nameTouched: false,
      when: 'always',
      windows: clone(SCHEDULE_PRESETS.office),
      minutes: 30,
      customMinutes: false,
      every: DAY_MINUTES,
      perSite: false,
      intervention: null,
      kept: {},
      protection: null,
      pause: defaultPause(),
      note: '',
      color: GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[cfg.groups.length % GROUP_COLORS.length],
      icon: 'circle',
      lookTouched: false,
    };
    return template ? toggleTemplate(s, template) : s;
  };
  const [restored] = useState(() => (template ? null : load(store)));
  const [s, setS] = useState<State>(() => restored ?? fresh());
  const update = (patch: Partial<State>) => setS((cur) => ({ ...cur, ...patch }));

  useEffect(() => persist(store, s), [s]);
  // Focus follows the step.
  useEffect(() => {
    titleRef.current?.focus();
  }, [s.step]);

  const sites = s.targets.filter((x) => !x.allow);
  // With several sites, a time limit is shared by them unless each site gets its own.
  const severalSites = sites.length > 1;
  // A ready-made list names the rule until the person types a name; a site never does, since the
  // rule's name is shown next to its sites (block page, "Add to" in the popup).
  const name = s.name.trim();

  // The full editor can be opened before choosing: it then starts from the default protection
  // and a gentle question.
  const protection = s.protection ?? DEFAULT_PROTECTION;
  const intervention = s.intervention ?? quickIntervention('ask');
  // A break lifts a block only: a rule that does something else has none (#15).
  const breaksOffered = breaksLift(intervention);
  const pause = { ...s.pause, allowed: breaksOffered && s.pause.allowed };

  const build = (): Group =>
    newGroup({
      id: s.id,
      name,
      color: s.color,
      icon: s.icon,
      note: s.note.trim(),
      targets: s.targets,
      policies: quickPolicies(s.when, intervention, s.windows, s.minutes, s.every, severalSites && s.perSite),
      pause,
      protection,
    });

  // A limit as long as its period would never be reached.
  const limitTooLong = s.when === 'daily' && s.minutes >= periodMinutes(everyPeriod(s.every));
  const canNext =
    s.step === 0
      ? sites.length > 0
      : s.step === 1
        ? s.when === 'schedule'
          ? s.windows.some((w) => w.days.length > 0)
          : !limitTooLong
        : s.step === 2
          ? quickInterventionReady(s.intervention)
          : s.step === 3
            ? s.protection !== null
            : true;
  const go = (step: number) => update({ step });

  const [busy, setBusy] = useState(false);
  const save = async () => {
    // A second click while saving would create the rule twice.
    if (busy) return;
    setBusy(true);
    try {
      if (await create(build())) persist(store, null);
    } finally {
      setBusy(false);
    }
  };
  const fullEditor = () => {
    const draft = build();
    persist(store, null);
    onFullEditor?.(draft);
  };
  const first = () => {
    if (onBack) return onBack();
    persist(store, null);
    onCancel?.();
  };

  const step = STEPS[s.step];
  const nextLabel = [
    t('wizard.next.when'),
    t('wizard.next.how'),
    t('wizard.next.protection'),
    t('wizard.next.review'),
  ][s.step];

  return (
    <div class={`stack stack-lg wizard-page ${extraClass}`}>
      <div class="page-head">
        {head}
        {onFullEditor && (
          <button type="button" class="link-btn small" onClick={fullEditor}>
            {t('wizard.fullEditor')}
          </button>
        )}
      </div>

      <ol class="wizard-progress" aria-label={t('wizard.steps')}>
        {before && (
          <li class="done">
            <span>
              <span class="num" aria-hidden="true">
                <Icon name="check" />
              </span>
              <span class="label">{before}</span>
            </span>
          </li>
        )}
        {STEPS.map((id, i) => {
          const label = (
            <>
              <span class="num" aria-hidden="true">
                {i < s.step ? <Icon name="check" /> : i + 1}
              </span>
              <span class="label">{t(`wizard.step.${id}`)}</span>
            </>
          );
          return (
            <li
              key={id}
              class={i < s.step ? 'done' : i === s.step ? 'current' : ''}
              aria-current={i === s.step ? 'step' : undefined}
            >
              {i < s.step ? (
                <button type="button" onClick={() => go(i)}>
                  {label}
                  <span class="sr-only"> — {t('wizard.done')}</span>
                </button>
              ) : (
                <span>{label}</span>
              )}
            </li>
          );
        })}
      </ol>

      {restored && s.step === restored.step && (
        <Banner
          kind="info"
          icon="refresh"
          action={
            <Button size="small" variant="ghost" onClick={() => setS(fresh())}>
              {t('wizard.startOver')}
            </Button>
          }
        >
          {t('wizard.resumed')}
        </Banner>
      )}

      <section class="card stack stack-lg" aria-labelledby="wizard-step-title">
        <div>
          <p class="overline">{t('wizard.stepOf', { n: s.step + 1, total: STEPS.length })}</p>
          <h2 id="wizard-step-title" ref={titleRef} tabIndex={-1}>
            {t(`wizard.${step}.title`)}
          </h2>
          <p class="card-sub">{t(`wizard.${step}.intro`)}</p>
        </div>

        {step === 'sites' && (
          <>
            <div class="field">
              <label class="label" for="wizard-name">
                {t('wizard.name')}
              </label>
              <input
                id="wizard-name"
                class="input"
                value={s.name}
                maxLength={80}
                placeholder={t('editor.namePlaceholder')}
                onInput={(e) => update({ name: (e.target as HTMLInputElement).value, nameTouched: true })}
              />
            </div>
            <div class="field">
              <span class="label" id="wizard-templates">
                {t('wizard.sites.templates')}
              </span>
              <div class="chips" role="group" aria-labelledby="wizard-templates">
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    class="chip"
                    aria-pressed={s.templates.includes(tpl.id)}
                    onClick={() => setS((cur) => toggleTemplate(cur, tpl.id))}
                  >
                    <Icon name={tpl.icon} />
                    {t(tpl.nameKey)}
                  </button>
                ))}
              </div>
            </div>
            <div class="field">
              <span class="label">{t('wizard.sites.yours')}</span>
              <TargetsEditor
                targets={s.targets}
                onChange={(targets) => update({ targets })}
                advanced={false}
                exceptions={false}
              />
              {!sites.length && <span class="help">{t('wizard.sites.none')}</span>}
            </div>
          </>
        )}

        {step === 'when' && (
          <>
            <RadioCards<QuickWhen>
              value={s.when}
              onChange={(when) => update({ when })}
              label={t('wizard.when.title')}
              itemClass="choice"
              options={WHEN.map((w) => ({ value: w }))}
              render={(o) => (
                <>
                  <Icon name={WHEN_ICON[o.value]} />
                  <span>
                    <strong>{t(`wizard.when.${o.value}`)}</strong>
                    <span class="small muted">{t(`wizard.when.${o.value}.desc`)}</span>
                  </span>
                </>
              )}
            />
            {s.when === 'schedule' && (
              <div class="option-panel">
                <WindowsEditor windows={s.windows} onChange={(windows) => update({ windows })} />
              </div>
            )}
            {s.when === 'daily' && (
              <div class="option-panel">
                <span class="label" id="wizard-minutes">
                  {t('wizard.when.minutes')}
                </span>
                <DailyMinutes
                  minutes={s.minutes}
                  custom={s.customMinutes}
                  onChange={(minutes, customMinutes) => update({ minutes, customMinutes })}
                  labelledBy="wizard-minutes"
                />
                <div class="row">
                  <span class="label" aria-hidden="true">
                    {t('wizard.when.every')}
                  </span>
                  <DurationInput
                    value={s.every}
                    min={5}
                    max={90 * DAY_MINUTES}
                    unitMax={{ minutes: DAY_MINUTES, hours: DAY_MINUTES }}
                    label={t('wizard.when.every')}
                    describedBy="wizard-every-help"
                    onChange={(every, unit) =>
                      update({
                        // A period of days counts whole days.
                        every:
                          unit === 'days'
                            ? Math.max(1, Math.round(every / DAY_MINUTES)) * DAY_MINUTES
                            : every,
                      })
                    }
                  />
                </div>
                {limitTooLong ? (
                  <span class="error-text" id="wizard-every-help">
                    {t('wizard.when.tooLong')}
                  </span>
                ) : (
                  <span class="help" id="wizard-every-help">
                    {t('wizard.when.everyHelp')}
                  </span>
                )}
                {severalSites && (
                  <Toggle
                    checked={s.perSite}
                    onChange={(perSite) => update({ perSite })}
                    label={t('budget.perSite')}
                    help={t(s.perSite ? 'wizard.when.perSiteOn' : 'wizard.when.perSiteOff', {
                      duration: formatDuration(s.minutes * 60),
                    })}
                  />
                )}
              </div>
            )}
          </>
        )}

        {step === 'how' && (
          <>
            <HowPicker
              value={s.intervention}
              kept={s.kept}
              onChange={(intervention, kept) => update({ intervention, kept })}
              label={t('wizard.how.title')}
            />
            {s.intervention && breaksOffered && (
              <PauseEditor
                basic
                value={s.pause}
                onChange={(p) => update({ pause: p })}
                hasPassword={s.protection?.kind === 'password'}
              />
            )}
          </>
        )}

        {step === 'protection' && (
          <ProtectionPicker
            value={s.protection}
            onChange={(p) => update({ protection: p })}
            groupId={s.id}
            name={name}
            label={t('wizard.protection.title')}
            breaks={pause.allowed}
          />
        )}

        {step === 'review' && (
          <>
            <div class={`plan tone-${toneOf(intervention.type)}`}>
              <GroupTile color={s.color} icon={s.icon} size={48} />
              <div class="stack stack-sm" style={{ minWidth: 0 }}>
                <strong class="plan-name">{name || t('editor.unnamed')}</strong>
                <p class="plan-text">
                  {planSentence(
                    s.when,
                    intervention,
                    sitesPhrase(s.targets),
                    s.windows,
                    s.minutes,
                    s.every,
                    severalSites ? (s.perSite ? 'each' : 'shared') : 'one',
                  )}
                </p>
              </div>
            </div>
            <div class="field">
              <label class="label" for="wizard-name-review">
                {t('wizard.name')}
              </label>
              <input
                id="wizard-name-review"
                class="input"
                value={s.name}
                placeholder={t('editor.namePlaceholder')}
                maxLength={80}
                aria-describedby={name ? undefined : 'wizard-name-help'}
                onInput={(e) => update({ name: (e.target as HTMLInputElement).value, nameTouched: true })}
              />
              {!name && (
                <span class="help" id="wizard-name-help">
                  {t('validate.noName')}
                </span>
              )}
            </div>
            <div class="field">
              <label class="label" for="wizard-note">
                {t('editor.note')}
              </label>
              <textarea
                id="wizard-note"
                class="textarea"
                rows={2}
                maxLength={500}
                aria-describedby="wizard-note-help"
                value={s.note}
                placeholder={t('editor.notePlaceholder')}
                onInput={(e) => update({ note: (e.target as HTMLTextAreaElement).value })}
              />
              <span class="help" id="wizard-note-help">
                {t('wizard.review.noteHelp')}
              </span>
            </div>
            <details class="disclosure">
              <summary>
                <Icon name="palette" />
                {t('editor.look')}
              </summary>
              <div class="body stack">
                <RadioCards
                  value={s.color}
                  onChange={(color) => update({ color, lookTouched: true })}
                  label={t('editor.color')}
                  class="picker"
                  itemClass="swatch"
                  options={GROUP_COLORS.map((c) => ({ value: c }))}
                  render={(o) => (
                    <>
                      <span style={{ background: o.value }} aria-hidden="true" />
                      <span class="sr-only">
                        {t('editor.colorN', { n: GROUP_COLORS.indexOf(o.value) + 1 })}
                      </span>
                    </>
                  )}
                />
                <RadioCards
                  value={s.icon}
                  onChange={(icon) => update({ icon, lookTouched: true })}
                  label={t('editor.icon')}
                  class="picker"
                  itemClass="icon-choice"
                  options={GROUP_ICONS.map((ic) => ({ value: ic }))}
                  render={(o) => <Icon name={o.value} label={t(`icon.${o.value}`)} />}
                />
              </div>
            </details>
            <div class="option-panel row nowrap top" style={{ gap: '12px' }}>
              <Icon name="info" />
              <div class="stack stack-xs small">
                {breaksOffered && <span>{pauseRulesSummary(pause)}</span>}
                <span>{t('wizard.review.protection', { level: protectionLabel(protection) })}</span>
                <span class="text-2">{t('wizard.review.later')}</span>
              </div>
            </div>
            {review}
          </>
        )}
      </section>

      <div class="sticky-actions row between">
        <Button
          variant="ghost"
          icon={s.step || onBack ? 'chevron-left' : undefined}
          onClick={() => (s.step ? go(s.step - 1) : first())}
        >
          {s.step || onBack ? t('wizard.back') : t('common.cancel')}
        </Button>
        <div class="row">
          {step === 'review' && onFullEditor && (
            <button type="button" class="link-btn small" onClick={fullEditor}>
              {t('wizard.customize')}
            </button>
          )}
          {step === 'review' ? (
            <Button variant="primary" icon="check" disabled={!name || busy} onClick={save}>
              {t('wizard.create')}
            </Button>
          ) : (
            <Button variant="primary" disabled={!canNext} onClick={() => go(s.step + 1)}>
              {nextLabel}
              <Icon name="chevron-right" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A password or a partner code is not kept in session storage: it is chosen again. */
function withoutSecret(p: Protection | null): Protection | null {
  return p && (p.kind === 'password' || p.kind === 'partner') ? null : p;
}

/**
 * Selecting a ready-made list adds its entries (and, until the user changes them, its name, colour
 * and icon); deselecting removes the entries no other selected list has.
 */
function toggleTemplate(s: State, id: string): State {
  const tpl = TEMPLATES.find((x) => x.id === id);
  if (!tpl) return s;
  const on = !s.templates.includes(id);
  const templates = on ? [...s.templates, id] : s.templates.filter((x) => x !== id);
  let targets: Target[];
  if (on) {
    targets = addTemplate(s.targets, tpl.entries);
  } else {
    const own = new Set(targetsFromLines(tpl.entries).map(targetKey));
    const kept = new Set(
      targetsFromLines(templates.flatMap((x) => TEMPLATES.find((y) => y.id === x)?.entries ?? [])).map(
        targetKey,
      ),
    );
    targets = s.targets.filter((x) => !own.has(targetKey(x)) || kept.has(targetKey(x)));
  }
  const chosen = templates.map((x) => TEMPLATES.find((y) => y.id === x)!);
  const first = chosen[0];
  return {
    ...s,
    templates,
    targets,
    ...(!s.nameTouched ? { name: chosen.map((x) => t(x.nameKey)).join(' + ') } : {}),
    ...(!s.lookTouched && first ? { color: first.color, icon: first.icon } : {}),
  };
}
