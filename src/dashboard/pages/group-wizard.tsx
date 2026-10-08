/**
 * Creating a rule, step by step (docs/design.md): which sites → when → what happens →
 * review. Creating is an infrequent task done by people who are new to the concepts, so it is a
 * short wizard (NN/g); editing stays on the one-page editor. The steps build an if-then plan
 * ("When I open these sites…, then…"), and the review states it in a sentence.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { isSensitiveSite, TEMPLATES } from '../../data/templates';
import {
  GROUP_COLORS,
  newGroup,
  pausePolicyFor,
  type QuickHow,
  type QuickWhen,
  quickIntervention,
  quickPolicies,
  SCHEDULE_PRESETS,
  targetsFromSites,
} from '../../engine/defaults';
import type { Group, Target, TimeWindow } from '../../engine/types';
import { isRedirectUrl } from '../../engine/validate';
import { t } from '../../i18n/i18n';
import { call } from '../../shared/rpc';
import { Banner, Button, GroupTile, RadioCards, Segmented, toast } from '../../ui/components';
import { GROUP_ICONS, Icon } from '../../ui/icons';
import { costLabel } from '../../ui/pause';
import { useSaveFlow } from '../../ui/saveflow';
import { toneOf } from '../../ui/status';
import { HowPicker } from '../components/how-picker';
import { WindowsEditor } from '../components/schedule';
import { TargetsEditor } from '../components/targets';
import { clone, useDashboard } from '../context';
import { planSentence, sitesPhrase } from '../plan';
import { navigate } from '../router';
import { setEditorHandoff } from './group-editor';

const STEPS = ['sites', 'when', 'how', 'review'] as const;
const WHEN: QuickWhen[] = ['always', 'schedule', 'daily'];
const WHEN_ICON: Record<QuickWhen, string> = { always: 'zap', schedule: 'calendar', daily: 'hourglass' };
const MINUTES = [15, 30, 45, 60, 90, 120];
/** The wizard keeps its state for the session: leaving and coming back resumes it (NN/g). */
const STORE = 'whb-new-rule';

interface State {
  step: number;
  templates: string[];
  targets: Target[];
  name: string;
  nameTouched: boolean;
  when: QuickWhen;
  windows: TimeWindow[];
  minutes: number;
  how: QuickHow | null;
  redirectUrl: string;
  note: string;
  color: string;
  icon: string;
  lookTouched: boolean;
}

function load(): State | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    const s = raw ? (JSON.parse(raw) as State) : null;
    // A wizard started by an earlier version has no redirect address.
    return s ? { ...s, redirectUrl: s.redirectUrl ?? '' } : null;
  } catch {
    return null;
  }
}
function persist(s: State | null) {
  try {
    if (s) sessionStorage.setItem(STORE, JSON.stringify(s));
    else sessionStorage.removeItem(STORE);
  } catch {
    // storage unavailable: the wizard still works, it just does not resume
  }
}

export function GroupWizardPage({ template }: { template: string | null }) {
  const { model } = useDashboard();
  const cfg = model.config;
  const level = cfg.settings.protection.level;
  const flow = useSaveFlow();
  const titleRef = useRef<HTMLHeadingElement>(null);

  const fresh = (): State => {
    const used = new Set(cfg.groups.map((g) => g.color));
    const s: State = {
      step: 0,
      templates: [],
      targets: [],
      name: '',
      nameTouched: false,
      when: 'always',
      windows: clone(SCHEDULE_PRESETS.office),
      minutes: 30,
      how: null,
      redirectUrl: '',
      note: '',
      color: GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[cfg.groups.length % GROUP_COLORS.length],
      icon: 'circle',
      lookTouched: false,
    };
    return template ? toggleTemplate(s, template) : s;
  };
  const [restored] = useState(() => (template ? null : load()));
  const [s, setS] = useState<State>(() => restored ?? fresh());
  const update = (patch: Partial<State>) => setS((cur) => ({ ...cur, ...patch }));

  useEffect(() => persist(s), [s]);
  // Focus follows the step (A11Y-02).
  useEffect(() => {
    titleRef.current?.focus();
  }, [s.step]);

  const sites = s.targets.filter((x) => !x.allow);
  // Without a name, the first site names the rule, never an address from a sensitive list.
  const name =
    s.name.trim() ||
    sites.find((x) => !isSensitiveSite(x.value))?.value ||
    s.templates.map((id) => t(TEMPLATES.find((x) => x.id === id)?.nameKey ?? '')).join(' + ') ||
    '';

  const build = (): Group =>
    newGroup({
      name,
      color: s.color,
      icon: s.icon,
      note: s.note.trim(),
      targets: s.targets,
      // The full editor can be opened before choosing: it then starts from a gentle question.
      policies: quickPolicies(s.when, s.how ?? 'ask', s.windows, s.minutes, s.redirectUrl),
      pause: pausePolicyFor(level),
    });

  const canNext =
    s.step === 0
      ? sites.length > 0
      : s.step === 1
        ? s.when !== 'schedule' || s.windows.some((w) => w.days.length > 0)
        : s.step === 2
          ? s.how !== null && (s.how !== 'redirect' || isRedirectUrl(s.redirectUrl))
          : true;
  const go = (step: number) => update({ step });

  const [busy, setBusy] = useState(false);
  const create = async () => {
    // A second click while saving would create the rule twice.
    if (busy) return;
    setBusy(true);
    const g = build();
    const next = clone(cfg);
    next.groups.push(g);
    const ok = await flow.run(call('config.save', { config: next })).finally(() => setBusy(false));
    if (ok) {
      persist(null);
      navigate('/groups');
      toast(t('wizard.created', { name: g.name }), {
        label: t('wizard.open'),
        run: () => navigate(`/groups/${g.id}`),
      });
    }
  };
  const fullEditor = () => {
    setEditorHandoff(build());
    persist(null);
    navigate('/groups/new?full=1');
  };
  const cancel = () => {
    persist(null);
    navigate('/groups');
  };

  const step = STEPS[s.step];
  const nextLabel = [t('wizard.next.when'), t('wizard.next.how'), t('wizard.next.review')][s.step];
  const intervention = quickIntervention(s.how ?? 'ask', s.redirectUrl);

  return (
    <div class="stack stack-lg wizard-page">
      <div class="page-head">
        <div>
          <a href="#/groups" class="back quiet">
            <Icon name="chevron-left" />
            {t('nav.groups')}
          </a>
          <h1>{t('wizard.title')}</h1>
        </div>
        <button type="button" class="link-btn small" onClick={fullEditor}>
          {t('wizard.fullEditor')}
        </button>
      </div>

      <ol class="wizard-progress" aria-label={t('wizard.steps')}>
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
                placeholder={sites[0]?.value ?? t('editor.namePlaceholder')}
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
              onChange={(when) =>
                update({ when, ...(when !== 'always' && s.how === 'track' ? { how: null } : {}) })
              }
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
                <Segmented
                  value={s.minutes}
                  onChange={(minutes) => update({ minutes })}
                  labelledBy="wizard-minutes"
                  options={MINUTES.map((m) => ({ value: m, label: t('common.minutes', { n: m }) }))}
                />
              </div>
            )}
          </>
        )}

        {step === 'how' && (
          <HowPicker
            value={s.how}
            onChange={(how) => update({ how })}
            label={t('wizard.how.title')}
            disabled={s.when === 'always' ? [] : ['track']}
            disabledHint={t('wizard.how.trackOnlyAlways')}
            redirectUrl={s.redirectUrl}
            onRedirectUrl={(redirectUrl) => update({ redirectUrl })}
          />
        )}

        {step === 'review' && (
          <>
            <div class={`plan tone-${toneOf(intervention.type)}`}>
              <GroupTile color={s.color} icon={s.icon} size={48} />
              <div class="stack stack-sm" style={{ minWidth: 0 }}>
                <strong class="plan-name">{name}</strong>
                <p class="plan-text">
                  {planSentence(
                    s.when,
                    s.how ?? 'ask',
                    sitesPhrase(s.targets),
                    s.windows,
                    s.minutes,
                    s.redirectUrl,
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
                placeholder={name}
                maxLength={80}
                onInput={(e) => update({ name: (e.target as HTMLInputElement).value, nameTouched: true })}
              />
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
                <span>
                  {t('wizard.review.defaults', {
                    cost: costLabel(pausePolicyFor(level).cost),
                    level: t(`level.${level}`),
                  })}
                </span>
                <span class="text-2">{t('wizard.review.later')}</span>
              </div>
            </div>
          </>
        )}
      </section>

      <div class="sticky-actions row between">
        <Button
          variant="ghost"
          icon={s.step ? 'chevron-left' : undefined}
          onClick={() => (s.step ? go(s.step - 1) : cancel())}
        >
          {s.step ? t('wizard.back') : t('common.cancel')}
        </Button>
        <div class="row">
          {step === 'review' && (
            <button type="button" class="link-btn small" onClick={fullEditor}>
              {t('wizard.customize')}
            </button>
          )}
          {step === 'review' ? (
            <Button variant="primary" icon="check" disabled={!name || busy} onClick={create}>
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
      {flow.element}
    </div>
  );
}

/**
 * Selecting a ready-made list adds its sites (and, until the user changes them, its name, colour
 * and icon); deselecting removes the sites no other selected list has.
 */
function toggleTemplate(s: State, id: string): State {
  const tpl = TEMPLATES.find((x) => x.id === id);
  if (!tpl) return s;
  const on = !s.templates.includes(id);
  const templates = on ? [...s.templates, id] : s.templates.filter((x) => x !== id);
  let targets: Target[];
  if (on) {
    const have = new Set(s.targets.map((x) => x.value));
    targets = [...s.targets, ...targetsFromSites(tpl.sites.filter((v) => !have.has(v)))];
  } else {
    const kept = new Set(templates.flatMap((x) => TEMPLATES.find((y) => y.id === x)?.sites ?? []));
    targets = s.targets.filter((x) => !tpl.sites.includes(x.value) || kept.has(x.value));
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
