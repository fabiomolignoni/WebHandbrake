/**
 * First run (ONB-01, ONB-02; docs/design.md): a welcome that states the value and
 * the privacy promise, then goal → sites → details → your plan, and a "you're set" screen with the
 * next steps. Skippable and resumable within the session.
 *
 * Nothing is recommended or pre-selected where the right answer depends on the person (goal, what
 * happens): we do not know why they installed the extension, so they choose actively.
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
import type { Group, ProtectionLevel, Target, TimeWindow } from '../../engine/types';
import { isRedirectUrl } from '../../engine/validate';
import { t } from '../../i18n/i18n';
import { api, browserName } from '../../platform/api';
import { call } from '../../shared/rpc';
import { Button, GroupTile, RadioCards, Segmented, StatusPill, ToneIcon } from '../../ui/components';
import { BrakeLogo, Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { interventionIcon, statusIcon, statusName, toneOf } from '../../ui/status';
import { HowPicker } from '../components/how-picker';
import { WindowsEditor } from '../components/schedule';
import { TargetsEditor } from '../components/targets';
import { clone, useDashboard } from '../context';
import { namesPhrase, planSentence } from '../plan';
import { navigate } from '../router';
import { levelIcon } from './group-editor';

type Goal = 'friction' | 'limit' | 'schedule' | 'block' | 'track';
type Screen = 'welcome' | 'goal' | 'sites' | 'details' | 'plan' | 'done';

const GOALS: { id: Goal; icon: string }[] = [
  { id: 'friction', icon: 'wind' },
  { id: 'limit', icon: 'hourglass' },
  { id: 'schedule', icon: 'calendar' },
  { id: 'block', icon: 'brake' },
  { id: 'track', icon: 'chart' },
];
const WHEN: Record<Goal, QuickWhen> = {
  friction: 'always',
  limit: 'daily',
  schedule: 'schedule',
  block: 'always',
  track: 'always',
};
/** Goals whose intervention is implied; the others let the person choose any intervention. */
const FIXED_HOW: Partial<Record<Goal, QuickHow>> = { block: 'block', track: 'track' };
const MINUTES = [15, 30, 45, 60, 90, 120];
const LEVELS: ProtectionLevel[] = ['soft', 'balanced', 'strict'];
/** The setup keeps its state for the session: closing the tab by mistake loses nothing. */
const STORE = 'whb-onboarding';

interface State {
  screen: Screen;
  goal: Goal | null;
  templates: string[];
  custom: Target[];
  windows: TimeWindow[];
  minutes: number;
  how: QuickHow | null;
  redirectUrl: string;
  level: ProtectionLevel;
  note: string;
}

function load(): State | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    const s = raw ? (JSON.parse(raw) as State) : null;
    return s && s.screen !== 'done' ? { ...s, redirectUrl: s.redirectUrl ?? '' } : null;
  } catch {
    return null;
  }
}
function persist(s: State | null) {
  try {
    if (s) sessionStorage.setItem(STORE, JSON.stringify(s));
    else sessionStorage.removeItem(STORE);
  } catch {
    // storage unavailable: the setup still works, it just does not resume
  }
}

/** A site to show as an example: a plain address, never one from a sensitive list. */
const sampleSite = (groups: Group[]) =>
  groups
    .flatMap((g) => g.targets)
    .find((x) => !x.allow && x.type === 'domain' && !x.value.includes('*') && !isSensitiveSite(x.value))
    ?.value;

const hasDetails = (g: Goal | null) => g === null || !FIXED_HOW[g];
const stepsFor = (g: Goal | null): Screen[] => [
  'goal',
  'sites',
  ...(hasDetails(g) ? (['details'] as Screen[]) : []),
  'plan',
];

/**
 * A miniature of what the choice looks like on a site (show, don't tell). Decorative: the option
 * text says the same in words.
 */
function MiniPreview({ how, host }: { how: QuickHow | null; host: string }) {
  if (!how)
    return (
      <div class="mini-iv mini-empty" aria-hidden="true">
        <span>{t('welcome.previewEmpty')}</span>
      </div>
    );
  const type = quickIntervention(how).type;
  const onPage = how === 'track' || how === 'remind' || how === 'filter';
  const title =
    how === 'ask'
      ? t('iv.ask', { host })
      : how === 'delay'
        ? t('iv.delay')
        : how === 'challenge'
          ? t('iv.challenge')
          : how === 'close'
            ? t('iv.close')
            : how === 'redirect'
              ? t('iv.redirect')
              : t('iv.block');
  const passable = how === 'ask' || how === 'delay' || how === 'challenge';
  return (
    <div class={`mini-iv tone-${toneOf(type)}`} aria-hidden="true">
      <div class="mini-bar">
        <i />
        <i />
        <i />
        <span class="mini-url">{host}</span>
      </div>
      {onPage ? (
        <div class={`mini-page${how === 'filter' ? ' gray' : ''}`}>
          <span class="mini-hero" />
          <span class="mini-line" />
          <span class="mini-line short" />
          <span class="mini-thumbs">
            <i />
            <i />
            <i />
          </span>
          {how === 'track' && (
            <span class="mini-timer">
              <Icon name="timer" />
              12:30
            </span>
          )}
          {how === 'remind' && <span class="mini-toast">{t('overlay.remind.title', { group: host })}</span>}
        </div>
      ) : (
        <div class="mini-body">
          <span class="mini-emblem">
            <Icon name={how === 'delay' ? 'wind' : interventionIcon(type)} />
          </span>
          <strong>{title}</strong>
          {how === 'ask' && (
            <span class="mini-chips">
              <i>{t('iv.ask.s1')}</i>
              <i>{t('common.minutes', { n: 10 })}</i>
            </span>
          )}
          {how === 'delay' && <span class="mini-ring">30</span>}
          {how === 'challenge' && <span class="mini-code">k7Q2 xP9m 4Rt8</span>}
          {(passable || how === 'block') && (
            <span class="mini-btn primary">{how === 'ask' ? t('iv.notNow') : t('iv.closeTab')}</span>
          )}
          {passable && <span class="mini-btn">{t('iv.continue')}</span>}
        </div>
      )}
      <span class="mini-caption">{t('welcome.preview')}</span>
    </div>
  );
}

export function WelcomePage() {
  const { model } = useDashboard();
  const settings = model.config.settings;
  const flow = useSaveFlow();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fresh = (): State => ({
    screen: 'welcome',
    goal: null,
    templates: [],
    custom: [],
    windows: clone(SCHEDULE_PRESETS.office),
    minutes: 30,
    how: null,
    redirectUrl: '',
    // The current level is a fact, not a recommendation: it starts selected.
    level: settings.protection.level === 'locked' ? 'strict' : settings.protection.level,
    note: '',
  });
  const [restored] = useState(load);
  const [s, setS] = useState<State>(() => restored ?? fresh());
  const [created, setCreated] = useState<Group[]>([]);
  const [hostAccess, setHostAccess] = useState<boolean | null>(null);
  const [incognito, setIncognito] = useState<boolean | null>(null);
  const update = (patch: Partial<State>) => setS((cur) => ({ ...cur, ...patch }));

  useEffect(() => {
    if (s.screen !== 'done') persist(s);
  }, [s]);
  // Focus follows the screen (A11Y-02).
  useEffect(() => {
    titleRef.current?.focus();
    window.scrollTo(0, 0);
  }, [s.screen]);
  // The one permission the plan needs is asked in context, only when it is missing.
  useEffect(() => {
    if (s.screen === 'plan')
      void api.permissions
        .contains({ origins: ['<all_urls>'] })
        .then(setHostAccess)
        .catch(() => setHostAccess(true));
    if (s.screen === 'done')
      void api.extension
        .isAllowedIncognitoAccess()
        .then(setIncognito)
        .catch(() => setIncognito(true));
  }, [s.screen]);

  const steps = stepsFor(s.goal);
  const stepIndex = steps.indexOf(s.screen);
  const when = WHEN[s.goal ?? 'friction'];
  const fixed = s.goal ? FIXED_HOW[s.goal] : undefined;
  const how: QuickHow | null = fixed ?? s.how;
  const ownSites = s.custom.filter((x) => !x.allow).length;
  const chosen = s.templates.map((id) => TEMPLATES.find((x) => x.id === id)!).filter(Boolean);

  const policies = () => quickPolicies(when, how ?? 'ask', s.windows, s.minutes, s.redirectUrl);
  const groups: Group[] = [
    ...chosen.map((tpl) =>
      newGroup({
        name: t(tpl.nameKey),
        color: tpl.color,
        icon: tpl.icon,
        note: s.note.trim(),
        targets: targetsFromSites(tpl.sites),
        policies: policies(),
        pause: pausePolicyFor(s.level),
      }),
    ),
    ...(ownSites
      ? [
          newGroup({
            name: t('welcome.mySites'),
            color: GROUP_COLORS[0],
            note: s.note.trim(),
            targets: s.custom,
            policies: policies(),
            pause: pausePolicyFor(s.level),
          }),
        ]
      : []),
  ];

  const go = (screen: Screen) => update({ screen });
  const next = () => go(steps[stepIndex + 1]);
  const back = () => go(stepIndex > 0 ? steps[stepIndex - 1] : 'welcome');
  const skip = async () => {
    persist(null);
    sessionStorage.setItem('whb-skip-welcome', '1');
    await call('onboarding.done', {});
    navigate('/today');
  };
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    // A second click while saving would create the rules twice.
    if (busy) return;
    setBusy(true);
    try {
      const out = groups;
      const cfg = clone(model.config);
      cfg.groups.push(...out);
      if (canSetLevel) cfg.settings.protection.level = s.level;
      cfg.settings.onboarded = true;
      const result = await call('config.save', { config: cfg });
      // New rules are a strengthening and are applied at once; only a gentler level can wait for a
      // cost or a cooling-off. Once the rules exist the setup is over whatever happens to the
      // level: trying again would add them twice.
      const added = result.applied.some((u) => u.kind === 'group.add');
      const ok = await flow.run(Promise.resolve(result));
      if (ok || added) {
        persist(null);
        sessionStorage.setItem('whb-skip-welcome', '1');
        setCreated(out);
        go('done');
      }
    } finally {
      setBusy(false);
    }
  };

  const detailsKind = s.goal === 'limit' || s.goal === 'schedule' ? s.goal : 'friction';
  const stepLabel = (screen: Screen) =>
    screen === 'details' ? t(`welcome.step.details.${detailsKind}`) : t(`welcome.step.${screen}`);
  const canNext =
    s.screen === 'goal'
      ? s.goal !== null
      : s.screen === 'sites'
        ? groups.length > 0
        : s.screen === 'details'
          ? how !== null &&
            (how !== 'redirect' || isRedirectUrl(s.redirectUrl)) &&
            (when !== 'schedule' || s.windows.some((w) => w.days.length > 0))
          : true;
  const restricting = how !== 'track';
  // A locked level cannot be changed here; "count only" restricts nothing, so needs no protection.
  const canSetLevel = restricting && settings.protection.level !== 'locked';
  const firstSite = restricting ? sampleSite(created.length ? created : groups) : undefined;
  const browser = browserName();
  const totalSites = groups.reduce((n, g) => n + g.targets.length, 0);

  // ---------------------------------------------------------------- welcome
  if (s.screen === 'welcome') {
    return (
      <div class="onb onb-welcome stack stack-xl">
        <div class="stack stack-lg center onb-hero">
          <BrakeLogo size={64} />
          <h1 ref={titleRef} tabIndex={-1}>
            {t('welcome.title')}
          </h1>
          <p class="onb-lead">{t('welcome.lead')}</p>
        </div>
        <ul class="value-list plain">
          {(['gentle', 'firm', 'private'] as const).map((v) => (
            <li key={v}>
              <ToneIcon
                tone={v === 'gentle' ? 'friction' : v === 'firm' ? 'protected' : 'free'}
                icon={v === 'gentle' ? 'wind' : v === 'firm' ? 'shield' : 'lock'}
                size={44}
              />
              <span class="stack stack-xs">
                <strong>{t(`welcome.value.${v}.title`)}</strong>
                <span class="text-2">{t(`welcome.value.${v}.text`)}</span>
              </span>
            </li>
          ))}
        </ul>
        <div class="stack center" style={{ alignItems: 'center' }}>
          <div class="row center onb-choices">
            <Button variant="primary" size="large" icon="arrow-right" onClick={() => go('goal')}>
              {t('welcome.begin')}
            </Button>
            <Button size="large" onClick={skip}>
              {t('welcome.skip')}
            </Button>
          </div>
          <p class="small muted">{t('welcome.startSmall')}</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- done
  if (s.screen === 'done') {
    return (
      <div class="onb stack stack-xl">
        <div class="stack stack-lg center onb-hero">
          <ToneIcon tone="free" icon="check-circle" size={72} round />
          <h1 ref={titleRef} tabIndex={-1}>
            {t('welcome.done.title')}
          </h1>
          <p class="onb-lead">{t('welcome.done.body', { count: created.length })}</p>
        </div>
        <section class="card stack" aria-labelledby="next-steps">
          <h2 id="next-steps">{t('welcome.done.next')}</h2>
          <ol class="next-steps plain">
            <li>
              <ToneIcon tone="neutral" icon="pin" size={40} />
              <span class="stack stack-xs">
                <strong>
                  {browser === 'firefox-android' ? t('welcome.pin.titleAndroid') : t('welcome.pin.title')}
                </strong>
                <span class="small text-2">
                  {t(
                    browser === 'firefox-android'
                      ? 'welcome.pin.android'
                      : browser === 'firefox'
                        ? 'welcome.pin.firefox'
                        : 'welcome.pin.chrome',
                  )}
                </span>
                <span class="small muted">{t('welcome.pin.why')}</span>
              </span>
            </li>
            {firstSite && (
              <li>
                <ToneIcon tone="friction" icon="play" size={40} />
                <span class="stack stack-xs grow">
                  <strong>{t('welcome.try.title')}</strong>
                  <span class="small text-2">{t('welcome.try.body', { site: firstSite })}</span>
                </span>
                <Button
                  size="small"
                  icon="external"
                  onClick={() => void call('tabs.open', { url: `https://${firstSite}` })}
                >
                  {t('welcome.try.action')}
                </Button>
              </li>
            )}
            {incognito === false && (
              <li>
                <ToneIcon tone="calm" icon="eye-off" size={40} />
                <span class="stack stack-xs">
                  <strong>{t('welcome.private.title')}</strong>
                  <span class="small text-2">
                    {t(
                      browser === 'chrome' || browser === 'edge'
                        ? 'checklist.incognito.chrome'
                        : browser === 'firefox-android'
                          ? 'checklist.incognito.android'
                          : 'checklist.incognito.firefox',
                    )}
                  </span>
                </span>
              </li>
            )}
          </ol>
        </section>
        <div class="row center">
          <Button variant="primary" size="large" icon="arrow-right" onClick={() => navigate('/today')}>
            {t('welcome.done.go')}
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- steps
  return (
    <div class="onb stack stack-lg">
      <div class="row between">
        <div class="row nowrap">
          <BrakeLogo size={28} />
          <strong>WebHandbrake</strong>
        </div>
        <button type="button" class="link-btn small" onClick={skip}>
          {t('welcome.skip')}
        </button>
      </div>

      <ol class="wizard-progress" aria-label={t('welcome.steps')}>
        <li class="done">
          <span>
            <span class="num" aria-hidden="true">
              <Icon name="check" />
            </span>
            <span class="label">{t('welcome.installed')}</span>
          </span>
        </li>
        {steps.map((id, i) => {
          const label = (
            <>
              <span class="num" aria-hidden="true">
                {i < stepIndex ? <Icon name="check" /> : i + 1}
              </span>
              <span class="label">{stepLabel(id)}</span>
            </>
          );
          return (
            <li
              key={id}
              class={i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}
              aria-current={i === stepIndex ? 'step' : undefined}
            >
              {i < stepIndex ? (
                <button type="button" onClick={() => go(id)}>
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

      {restored && s.screen === restored.screen && (
        <div class="banner info" role="status">
          <Icon name="refresh" />
          <span class="grow">{t('welcome.resumed')}</span>
          <Button size="small" variant="ghost" onClick={() => setS(fresh())}>
            {t('wizard.startOver')}
          </Button>
        </div>
      )}

      <section class="card stack stack-lg" aria-labelledby="onb-title">
        <div>
          <p class="overline">{t('wizard.stepOf', { n: stepIndex + 1, total: steps.length })}</p>
          <h1 id="onb-title" class="onb-title" ref={titleRef} tabIndex={-1}>
            {s.screen === 'details' ? t(`welcome.details.${detailsKind}`) : t(`welcome.${s.screen}.title`)}
          </h1>
          <p class="card-sub">
            {s.screen === 'details'
              ? t(`welcome.details.${detailsKind}.intro`)
              : t(`welcome.${s.screen}.intro`)}
          </p>
        </div>

        {s.screen === 'goal' && (
          <RadioCards<Goal>
            value={s.goal ?? ('' as Goal)}
            onChange={(goal) =>
              // Keep the chosen intervention unless the new goal cannot use it ("count only" needs "every time").
              update({ goal, how: s.how === 'track' && WHEN[goal] !== 'always' ? null : s.how })
            }
            label={t('welcome.goal.title')}
            itemClass="choice"
            options={GOALS.map((g) => ({ value: g.id }))}
            render={(o) => (
              <>
                <Icon name={GOALS.find((g) => g.id === o.value)!.icon} />
                <span class="stack stack-xs">
                  <strong>{t(`welcome.goal.${o.value}`)}</strong>
                  <span class="small muted">{t(`welcome.goal.${o.value}.desc`)}</span>
                </span>
              </>
            )}
          />
        )}

        {s.screen === 'sites' && (
          <>
            <div class="field">
              <span class="label" id="onb-lists">
                {t('wizard.sites.templates')}
              </span>
              <div class="template-grid" role="group" aria-labelledby="onb-lists">
                {TEMPLATES.map((tpl) => {
                  const on = s.templates.includes(tpl.id);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      class="choice compact template-tile"
                      aria-pressed={on}
                      onClick={() =>
                        update({
                          templates: on ? s.templates.filter((x) => x !== tpl.id) : [...s.templates, tpl.id],
                        })
                      }
                    >
                      <GroupTile color={tpl.color} icon={tpl.icon} size={36} />
                      <span class="stack stack-xs" style={{ minWidth: 0 }}>
                        <strong>{t(tpl.nameKey)}</strong>
                        <span class="tiny muted ellipsis">
                          {tpl.sensitive
                            ? t('welcome.sitesHidden', { count: tpl.sites.length })
                            : `${tpl.sites.slice(0, 3).join(', ')}…`}
                        </span>
                      </span>
                      <span class="tile-check" aria-hidden="true">
                        <Icon name="check" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div class="field">
              <span class="label">{t('welcome.customSites')}</span>
              <TargetsEditor
                targets={s.custom}
                onChange={(custom) => update({ custom })}
                advanced={false}
                exceptions={false}
              />
            </div>
            <section class="selection" aria-labelledby="onb-selection" aria-live="polite">
              <h2 id="onb-selection" class="label">
                {t('welcome.selection')}
              </h2>
              {groups.length ? (
                <>
                  <ul class="plain stack stack-sm">
                    {chosen.map((tpl) => (
                      <li key={tpl.id} class="row nowrap">
                        <GroupTile color={tpl.color} icon={tpl.icon} size={28} />
                        <span class="grow">{t(tpl.nameKey)}</span>
                        <span class="small text-2 num">{t('groups.sites', { count: tpl.sites.length })}</span>
                      </li>
                    ))}
                    {ownSites > 0 && (
                      <li class="row nowrap">
                        <GroupTile color={GROUP_COLORS[0]} icon="circle" size={28} />
                        <span class="grow">{t('welcome.mySites')}</span>
                        <span class="small text-2 num">{t('groups.sites', { count: ownSites })}</span>
                      </li>
                    )}
                  </ul>
                  <p class="small strong">
                    {t('welcome.selectionTotal', { rules: groups.length, sites: totalSites })}
                  </p>
                </>
              ) : (
                <p class="help">{t('welcome.sitesNone')}</p>
              )}
            </section>
          </>
        )}

        {s.screen === 'details' && (
          <div class="onb-split">
            <div class="stack stack-lg">
              {s.goal === 'limit' && (
                <Segmented
                  value={s.minutes}
                  onChange={(minutes) => update({ minutes })}
                  label={t('welcome.details.limit')}
                  options={MINUTES.map((m) => ({ value: m, label: t('common.minutes', { n: m }) }))}
                />
              )}
              {s.goal === 'schedule' && (
                <WindowsEditor windows={s.windows} onChange={(windows) => update({ windows })} />
              )}
              <div class="field">
                {detailsKind !== 'friction' && (
                  <span class="label">{t(`welcome.details.${detailsKind}.then`)}</span>
                )}
                <HowPicker
                  value={how}
                  onChange={(h) => update({ how: h })}
                  label={
                    detailsKind === 'friction'
                      ? t('welcome.details.friction')
                      : t(`welcome.details.${detailsKind}.then`)
                  }
                  disabled={when === 'always' ? [] : ['track']}
                  disabledHint={t('wizard.how.trackOnlyAlways')}
                  redirectUrl={s.redirectUrl}
                  onRedirectUrl={(redirectUrl) => update({ redirectUrl })}
                />
              </div>
            </div>
            <MiniPreview how={how} host={sampleSite(groups) ?? 'example.com'} />
          </div>
        )}

        {s.screen === 'plan' && how && (
          <>
            <div class={`plan tone-${toneOf(quickIntervention(how).type)}`}>
              <ToneIcon
                tone={toneOf(quickIntervention(how).type)}
                icon={statusIcon(quickIntervention(how).type)}
                size={44}
              />
              <p class="plan-text">
                {planSentence(
                  when,
                  how,
                  chosen.length
                    ? t('welcome.plan.sites', {
                        names: namesPhrase([
                          ...chosen.map((x) => t(x.nameKey)),
                          ...(ownSites ? [t('welcome.plan.yourSites')] : []),
                        ]),
                      })
                    : t('welcome.plan.yourSites'),
                  s.windows,
                  s.minutes,
                  s.redirectUrl,
                )}
              </p>
            </div>
            <div class="field">
              <span class="label">{t('welcome.plan.rules', { count: groups.length })}</span>
              <ul class="plain stack stack-sm">
                {groups.map((g) => {
                  const i = g.policies[0].intervention;
                  return (
                    <li key={g.id} class="row nowrap">
                      <GroupTile color={g.color} icon={g.icon} size={32} />
                      <span class="grow" style={{ minWidth: 0 }}>
                        <strong>{g.name}</strong>{' '}
                        <span class="small muted">{t('groups.sites', { count: g.targets.length })}</span>
                      </span>
                      <StatusPill small tone={toneOf(i.type)} icon={statusIcon(i.type)}>
                        {statusName(i)}
                      </StatusPill>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div class="field">
              <label class="label" for="onb-note">
                {t('welcome.note')}
              </label>
              <textarea
                id="onb-note"
                class="textarea"
                rows={2}
                maxLength={500}
                aria-describedby="onb-note-help"
                value={s.note}
                placeholder={t('editor.notePlaceholder')}
                onInput={(e) => update({ note: (e.target as HTMLTextAreaElement).value })}
              />
              <span class="help" id="onb-note-help">
                {t('welcome.noteHelp')}
              </span>
            </div>
            {canSetLevel && (
              <div class="field">
                <span class="label">{t('welcome.firmness')}</span>
                <RadioCards<ProtectionLevel>
                  value={s.level}
                  onChange={(level) => update({ level })}
                  label={t('welcome.firmness')}
                  class="level-grid three"
                  itemClass="choice"
                  options={LEVELS.map((l) => ({ value: l }))}
                  render={(o) => (
                    <>
                      <Icon name={levelIcon(o.value)} />
                      <span class="stack stack-xs">
                        <strong>{t(`level.${o.value}`)}</strong>
                        <span class="small text-2">
                          {t(`welcome.level.${o.value}`, {
                            seconds: settings.protection.balancedDelaySeconds,
                            hours: settings.protection.coolingOffHours,
                          })}
                        </span>
                      </span>
                    </>
                  )}
                />
                <span class="help">
                  {t('welcome.firmnessHelp', { hours: settings.protection.emergencyHours })}
                </span>
              </div>
            )}
            {hostAccess === false && (
              <div class="option-panel row nowrap top" style={{ gap: '12px' }}>
                <Icon name="globe" />
                <div class="stack stack-sm grow">
                  <strong>{t('welcome.perm.title')}</strong>
                  <span class="small text-2">{t('welcome.perm.body')}</span>
                  <Button
                    size="small"
                    variant="primary"
                    onClick={async () => {
                      const ok = await api.permissions
                        .request({ origins: ['<all_urls>'] })
                        .catch(() => false);
                      await call('permissions.changed', {});
                      setHostAccess(ok);
                    }}
                  >
                    {t('welcome.perm.grant')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <div class="row between onb-nav">
        <Button variant="ghost" icon="chevron-left" onClick={back}>
          {t('welcome.back')}
        </Button>
        {s.screen === 'plan' ? (
          <Button
            variant="primary"
            size="large"
            icon="check"
            disabled={!groups.length || !how || busy}
            onClick={finish}
          >
            {t('welcome.start')}
          </Button>
        ) : (
          <Button variant="primary" disabled={!canNext} onClick={next}>
            {t('welcome.nextTo', { step: stepLabel(steps[stepIndex + 1]) })}
            <Icon name="chevron-right" />
          </Button>
        )}
      </div>
      {flow.element}
    </div>
  );
}
