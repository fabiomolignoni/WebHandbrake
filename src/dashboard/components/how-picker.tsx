/**
 * "What should happen?": every intervention, gentlest first, in the tones of the friction ladder,
 * with the description of the chosen one and its main settings: the filter, the length of the
 * wait, the kind of challenge, the longest time after the question and the redirect address. The
 * other settings are in its advanced options. In a new rule nothing is pre-selected: the right
 * answer depends on the person (active choice).
 */

import { useId } from 'preact/hooks';
import { defaultIntervention } from '../../engine/defaults';
import type {
  ChallengeKind,
  Charset,
  FilterKind,
  GrantSpec,
  Intervention,
  InterventionType,
} from '../../engine/types';
import { isRedirectUrl } from '../../engine/validate';
import { t } from '../../i18n/i18n';
import { DurationInput, Field, NumberInput, RadioCards, Select, Toggle } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { interventionIcon, LADDER, toneOf } from '../../ui/status';
import { hasAdvancedOptions, interventionAdvanced } from '../rule-form';
import { AdvancedOptions } from './advanced';

const FILTERS: FilterKind[] = ['grayscale', 'blur', 'fade', 'invert', 'sepia', 'none'];

/** What was set for each intervention, so that switching to another one and back keeps it. */
export type KeptInterventions = Partial<Record<InterventionType, Intervention>>;

/** The intervention chosen, with what was set for it before or its defaults. */
export function pickIntervention(type: InterventionType, kept: KeptInterventions = {}): Intervention {
  // A redirect has no default address: the field starts empty.
  return kept[type] ?? (type === 'redirect' ? { type: 'redirect', url: '' } : defaultIntervention(type));
}

export function InterventionPicker({
  value,
  onChange,
  kept = {},
  dontCount = false,
}: {
  /** Null while nothing is chosen (a new rule). */
  value: Intervention | null;
  /** The new intervention, and what is now kept for every intervention. */
  onChange: (i: Intervention, kept: KeptInterventions) => void;
  kept?: KeptInterventions;
  /** "Don't count" is offered too, for the times a rule with several conditions leaves alone. */
  dontCount?: boolean;
}) {
  const type = value?.type ?? null;
  const set = (i: Intervention) => onChange(i, { ...kept, [i.type]: i });
  const ladder: InterventionType[] = dontCount || type === 'allow' ? ['allow', ...LADDER] : LADDER;
  return (
    <div class="stack">
      <RadioCards<InterventionType>
        value={type ?? ('' as InterventionType)}
        onChange={(x) => set(pickIntervention(x, kept))}
        label={t('intervention.label')}
        class="friction-picker how-grid"
        itemClass="friction-option"
        options={ladder.map((x) => ({ value: x, tone: toneOf(x) }))}
        render={(o) => (
          <>
            <Icon name={interventionIcon(o.value)} />
            <span>{t(`intervention.short.${o.value}`)}</span>
          </>
        )}
      />
      {value && type && (
        <div class={`option-panel tone-${toneOf(type)} stack stack-sm`} aria-live="polite">
          <p class="small">
            <strong>{t(`intervention.${type}`)}</strong> —{' '}
            {/* The full help of a redirect describes address placeholders: they are advanced. */}
            {type === 'redirect' ? t('wizard.how.redirectDesc') : t(`intervention.help.${type}`)}
          </p>
          <MainOptions value={value} onChange={set} />
          {hasAdvancedOptions(type) && (
            <AdvancedOptions key={type} open={interventionAdvanced(value)}>
              <MoreOptions value={value} onChange={set} />
            </AdvancedOptions>
          )}
        </div>
      )}
    </div>
  );
}

/** The settings asked with the choice. */
function MainOptions({ value: v, onChange }: { value: Intervention; onChange: (i: Intervention) => void }) {
  const id = useId();
  switch (v.type) {
    case 'filter':
      return (
        <div class="row">
          <Select<FilterKind>
            value={v.filter}
            label={t('filter.label')}
            // A filter chosen here replaces a custom one.
            onChange={(filter) => onChange({ ...v, filter, css: undefined })}
            options={[...FILTERS, ...(v.filter === 'custom' ? (['custom'] as const) : [])].map((f) => ({
              value: f,
              label: t(`filter.${f}`),
            }))}
          />
          {v.filter !== 'none' && v.filter !== 'custom' && (
            <label class="row nowrap small">
              {t('filter.intensity')}
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={v.intensity ?? 100}
                onInput={(e) => onChange({ ...v, intensity: Number((e.target as HTMLInputElement).value) })}
              />
              <span class="num">{v.intensity ?? 100}%</span>
            </label>
          )}
        </div>
      );
    case 'ask':
      return (
        <div class="row nowrap small">
          <span aria-hidden="true">{t('wizard.how.askMax')}</span>
          <DurationInput
            units={['minutes', 'hours']}
            value={v.maxMinutes}
            min={1}
            max={1440}
            label={t('wizard.how.askMax')}
            onChange={(maxMinutes) =>
              // The durations offered never exceed the longest time.
              onChange({
                ...v,
                maxMinutes,
                choices: v.choices.some((c) => c <= maxMinutes)
                  ? v.choices.filter((c) => c <= maxMinutes)
                  : [maxMinutes],
              })
            }
          />
        </div>
      );
    case 'delay':
      return (
        <div class="row nowrap small">
          <span aria-hidden="true">{t('delay.seconds')}</span>
          <DurationInput
            base="seconds"
            units={['seconds', 'minutes']}
            value={v.seconds}
            min={1}
            max={3600}
            label={t('delay.seconds')}
            onChange={(seconds) => onChange({ ...v, seconds })}
          />
        </div>
      );
    case 'challenge':
      return (
        <div class="stack stack-sm">
          <div class="row">
            <Select<ChallengeKind>
              value={v.kind}
              label={t('challenge.kind')}
              onChange={(kind) => onChange({ ...v, kind })}
              options={[
                { value: 'random', label: t('challenge.kind.random') },
                { value: 'phrase', label: t('challenge.kind.phrase') },
                { value: 'math', label: t('challenge.kind.math') },
              ]}
            />
            {v.kind === 'random' && (
              <NumberInput
                value={v.length ?? 24}
                min={4}
                max={500}
                label={t('challenge.length')}
                suffix={t('challenge.chars')}
                onChange={(length) => onChange({ ...v, length })}
              />
            )}
          </div>
          {v.kind === 'phrase' && (
            <div class="field">
              <label class="label small" for={`${id}-phrase`}>
                {t('challenge.phrase')}
              </label>
              <input
                id={`${id}-phrase`}
                class="input"
                value={v.phrase ?? ''}
                maxLength={300}
                aria-describedby={`${id}-phrase-help`}
                onInput={(e) => onChange({ ...v, phrase: (e.target as HTMLInputElement).value })}
              />
              <span class="help" id={`${id}-phrase-help`}>
                {t('challenge.phraseHelp')}
              </span>
            </div>
          )}
        </div>
      );
    case 'redirect':
      return (
        <div class="field">
          <label class="label small" for={`${id}-redirect`}>
            {t('redirect.url')}
          </label>
          <input
            id={`${id}-redirect`}
            class="input mono"
            type="url"
            inputMode="url"
            value={v.url}
            maxLength={2000}
            placeholder="https://"
            aria-invalid={v.url !== '' && !isRedirectUrl(v.url)}
            aria-describedby={`${id}-redirect-help`}
            onInput={(e) => onChange({ ...v, url: (e.target as HTMLInputElement).value })}
          />
          <span class="help" id={`${id}-redirect-help`}>
            {t('wizard.how.redirectHelp')}
          </span>
        </div>
      );
    default:
      return null;
  }
}

/** The advanced options of what happens. */
function MoreOptions({ value: v, onChange }: { value: Intervention; onChange: (i: Intervention) => void }) {
  switch (v.type) {
    case 'filter':
      return (
        <>
          <Toggle
            checked={Boolean(v.mute)}
            onChange={(mute) => onChange({ ...v, mute })}
            label={t('filter.mute')}
          />
          <Field label={t('filter.custom')} help={t('filter.customHelp')}>
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                class="input mono"
                value={v.filter === 'custom' ? (v.css ?? '') : ''}
                maxLength={200}
                onInput={(e) => {
                  const css = (e.target as HTMLInputElement).value;
                  // An empty custom filter is the usual one again.
                  onChange(
                    css.trim()
                      ? { ...v, filter: 'custom', css }
                      : { ...v, filter: 'grayscale', css: undefined },
                  );
                }}
              />
            )}
          </Field>
        </>
      );
    case 'ask':
      return (
        <>
          <div class="stack stack-sm">
            <div class="row">
              <span>{t('ask.choices')}</span>
              <input
                class="input inline mono"
                style={{ width: '10em' }}
                value={v.choices.join(', ')}
                aria-label={t('ask.choices')}
                onChange={(e) => {
                  const choices = (e.target as HTMLInputElement).value
                    .split(/[,\s]+/)
                    .map(Number)
                    .filter((n) => n > 0 && n <= 1440)
                    .slice(0, 6);
                  if (choices.length) onChange({ ...v, choices });
                }}
              />
            </div>
            <p class="help">{t('ask.help')}</p>
          </div>
          <div class="row">
            <span>{t('ask.wait')}</span>
            <DurationInput
              base="seconds"
              units={['seconds', 'minutes']}
              value={v.seconds ?? 0}
              min={0}
              max={600}
              label={t('ask.wait')}
              onChange={(seconds) => onChange({ ...v, seconds })}
            />
          </div>
          <div class="row">
            <label class="check small">
              <input
                type="checkbox"
                checked={Boolean(v.cooldownMinutes)}
                onChange={(e) =>
                  onChange({
                    ...v,
                    cooldownMinutes: (e.target as HTMLInputElement).checked ? 30 : undefined,
                  })
                }
              />
              {t('ask.cooldown')}
            </label>
            {v.cooldownMinutes !== undefined && (
              <DurationInput
                units={['minutes', 'hours']}
                value={v.cooldownMinutes}
                min={1}
                max={1440}
                label={t('ask.cooldown')}
                onChange={(cooldownMinutes) => onChange({ ...v, cooldownMinutes })}
              />
            )}
          </div>
        </>
      );
    case 'delay':
      return (
        <>
          <div class="row">
            <span>{t('delay.randomTo')}</span>
            <DurationInput
              base="seconds"
              units={['seconds', 'minutes']}
              value={v.randomTo ?? 0}
              min={0}
              max={3600}
              label={t('delay.randomTo')}
              onChange={(randomTo) => onChange({ ...v, randomTo: randomTo || undefined })}
            />
          </div>
          <div class="row">
            <span>{t('delay.increase')}</span>
            <DurationInput
              base="seconds"
              units={['seconds', 'minutes']}
              value={v.increase ?? 0}
              min={0}
              max={600}
              label={t('delay.increase')}
              onChange={(increase) => onChange({ ...v, increase: increase || undefined })}
            />
          </div>
          <div class="row">
            <span>{t('delay.onBlur')}</span>
            <Select<'pause' | 'restart' | 'ignore'>
              value={v.onBlur ?? 'pause'}
              label={t('delay.onBlur')}
              onChange={(onBlur) => onChange({ ...v, onBlur })}
              options={[
                { value: 'pause', label: t('delay.onBlur.pause') },
                { value: 'restart', label: t('delay.onBlur.restart') },
                { value: 'ignore', label: t('delay.onBlur.ignore') },
              ]}
            />
          </div>
          <Toggle
            checked={Boolean(v.autoContinue)}
            onChange={(autoContinue) => onChange({ ...v, autoContinue })}
            label={t('delay.auto')}
          />
          <Toggle
            checked={Boolean(v.hideCountdown)}
            onChange={(hideCountdown) => onChange({ ...v, hideCountdown })}
            label={t('delay.hide')}
          />
          <GrantEditor grant={v.grant} onChange={(grant) => onChange({ ...v, grant })} />
        </>
      );
    case 'challenge':
      return (
        <>
          {v.kind === 'random' && (
            <div class="row">
              <span>{t('challenge.charset')}</span>
              <Select<Charset>
                value={v.charset ?? 'alnum'}
                label={t('challenge.charset')}
                onChange={(charset) => onChange({ ...v, charset })}
                options={(['alnum', 'letters', 'digits', 'symbols'] as Charset[]).map((c) => ({
                  value: c,
                  label: t(`challenge.charset.${c}`),
                }))}
              />
            </div>
          )}
          <GrantEditor grant={v.grant} onChange={(grant) => onChange({ ...v, grant })} />
        </>
      );
    case 'redirect':
      return <p class="help">{t('redirect.help')}</p>;
    default:
      return null;
  }
}

/** Once through a wait or a challenge: what opens, and for how long. */
function GrantEditor({ grant, onChange }: { grant: GrantSpec; onChange: (g: GrantSpec) => void }) {
  return (
    <div class="stack stack-sm">
      <span class="label small">{t('grant.label')}</span>
      <div class="row">
        <Select<GrantSpec['scope']>
          value={grant.scope}
          label={t('grant.scope')}
          onChange={(scope) => onChange({ ...grant, scope })}
          options={[
            { value: 'page', label: t('grant.scope.page') },
            { value: 'site', label: t('grant.scope.site') },
            { value: 'group', label: t('grant.scope.group') },
          ]}
        />
        <Select<GrantSpec['mode']>
          value={grant.mode}
          label={t('grant.mode')}
          onChange={(mode) =>
            onChange({ ...grant, mode, ...(mode === 'minutes' ? { minutes: grant.minutes ?? 10 } : {}) })
          }
          options={[
            { value: 'visit', label: t('grant.mode.visit') },
            { value: 'minutes', label: t('grant.mode.minutes') },
          ]}
        />
        {grant.mode === 'minutes' && (
          <DurationInput
            units={['minutes', 'hours']}
            value={grant.minutes ?? 10}
            min={1}
            max={1440}
            label={t('grant.minutes')}
            onChange={(minutes) => onChange({ ...grant, minutes })}
          />
        )}
      </div>
      {grant.mode === 'visit' && <p class="help">{t('grant.mode.visitHelp')}</p>}
    </div>
  );
}
