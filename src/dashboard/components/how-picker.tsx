/**
 * "What should happen?": every intervention, gentlest first, in the tones of the friction ladder,
 * with the description of the chosen one and all its settings, always in view (no advanced
 * options): the filter, the length of the wait and how it behaves, the kind of challenge, what a
 * wait or a challenge opens once through, the longest time and the shortest reason after the
 * question, the redirect address. In a new rule nothing is pre-selected: the right answer depends
 * on the person (active choice).
 */

import { useId } from 'preact/hooks';
import { defaultIntervention } from '../../engine/defaults';
import type {
  ChallengeKind,
  FilterKind,
  GrantSpec,
  Intervention,
  InterventionType,
} from '../../engine/types';
import { isRedirectUrl } from '../../engine/validate';
import { t } from '../../i18n/i18n';
import { formatDuration } from '../../shared/format';
import { DurationInput, NumberInput, RadioCards, RadioList, Segmented, Toggle } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { interventionIcon, LADDER, toneOf } from '../../ui/status';

const FILTERS: FilterKind[] = ['grayscale', 'blur', 'fade', 'invert', 'sepia'];

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
}: {
  /** Null while nothing is chosen (a new rule). */
  value: Intervention | null;
  /** The new intervention, and what is now kept for every intervention. */
  onChange: (i: Intervention, kept: KeptInterventions) => void;
  kept?: KeptInterventions;
}) {
  const type = value?.type ?? null;
  const set = (i: Intervention) => onChange(i, { ...kept, [i.type]: i });
  return (
    <div class="stack">
      <RadioCards<InterventionType>
        value={type ?? ('' as InterventionType)}
        onChange={(x) => set(pickIntervention(x, kept))}
        label={t('intervention.label')}
        class="friction-picker how-grid"
        itemClass="friction-option"
        options={LADDER.map((x) => ({ value: x, tone: toneOf(x) }))}
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
            <strong>{t(`intervention.${type}`)}</strong> — {t(`intervention.help.${type}`)}
          </p>
          <Options value={value} onChange={set} />
        </div>
      )}
    </div>
  );
}

type DelayIntervention = Extract<Intervention, { type: 'delay' }>;

/** How long a wait lasts: always the same, random within a range, or longer each time one goes in. */
type WaitLength = 'fixed' | 'random' | 'growing';

const waitLength = (v: DelayIntervention): WaitLength =>
  v.randomTo !== undefined ? 'random' : v.increase !== undefined ? 'growing' : 'fixed';

/** A wait to the second: "1 min 5 s", where formatDuration says "1 min". */
const waitText = (s: number) =>
  s < 60 || s % 60 === 0
    ? formatDuration(s)
    : `${formatDuration(s - (s % 60))} ${t('duration.s', { s: s % 60 })}`;

/** The settings of the choice. */
function Options({ value: v, onChange }: { value: Intervention; onChange: (i: Intervention) => void }) {
  const id = useId();
  switch (v.type) {
    case 'filter':
      return (
        <div class="stack stack-sm">
          <Segmented<FilterKind>
            value={v.filter}
            label={t('filter.label')}
            onChange={(filter) => onChange({ ...v, filter })}
            options={FILTERS.map((f) => ({ value: f, label: t(`filter.${f}`) }))}
          />
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
        </div>
      );
    case 'ask':
      return (
        <div class="stack stack-sm">
          <div class="row nowrap small">
            <span aria-hidden="true">{t('wizard.how.askMax')}</span>
            <DurationInput
              units={['minutes', 'hours']}
              value={v.maxMinutes}
              min={1}
              max={1440}
              label={t('wizard.how.askMax')}
              onChange={(maxMinutes) => onChange({ ...v, maxMinutes })}
            />
          </div>
          <div class="row nowrap small">
            <span aria-hidden="true">{t('ask.minReason')}</span>
            <NumberInput
              value={v.minReasonLength}
              min={1}
              max={300}
              label={t('ask.minReason')}
              suffix={t('ask.minReasonUnit', { n: v.minReasonLength })}
              onChange={(minReasonLength) => onChange({ ...v, minReasonLength: Math.round(minReasonLength) })}
            />
          </div>
        </div>
      );
    case 'delay':
      return (
        <div class="stack">
          <WaitLengthOptions value={v} onChange={onChange} />
          <GrantEditor grant={v.grant} onChange={(grant) => onChange({ ...v, grant })} />
          <WaitBehaviour value={v} onChange={onChange} />
        </div>
      );
    case 'challenge':
      return (
        <div class="stack">
          <div class="stack stack-sm">
            <Segmented<ChallengeKind>
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
              <span>
                <NumberInput
                  value={v.length ?? 24}
                  min={4}
                  max={500}
                  label={t('challenge.length')}
                  suffix={t('challenge.chars')}
                  onChange={(length) => onChange({ ...v, length })}
                />
              </span>
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
          <GrantEditor grant={v.grant} onChange={(grant) => onChange({ ...v, grant })} />
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

/**
 * The length of a wait, one way at a time: always the same, random between two lengths, or longer
 * each time one goes in that day.
 */
function WaitLengthOptions({
  value: v,
  onChange,
}: {
  value: DelayIntervention;
  onChange: (i: Intervention) => void;
}) {
  const id = useId();
  const kind = waitLength(v);
  // The same wait, neither random nor longer each time.
  const fixed: DelayIntervention = { ...v };
  delete fixed.randomTo;
  delete fixed.increase;
  const seconds = (label: string, value: number, set: (n: number) => void, min = 1) => (
    <DurationInput
      base="seconds"
      units={['seconds', 'minutes']}
      value={value}
      min={min}
      max={3600}
      label={label}
      onChange={set}
    />
  );
  const step = v.increase ?? 0;
  return (
    <div class="stack stack-sm">
      <span class="label small" id={`${id}-length`}>
        {t('delay.length')}
      </span>
      <Segmented<WaitLength>
        value={kind}
        labelledBy={`${id}-length`}
        onChange={(k) => {
          if (k === kind) return;
          if (k === 'random') onChange({ ...fixed, randomTo: Math.min(3600, v.seconds * 2) });
          else if (k === 'growing') onChange({ ...fixed, increase: 10 });
          else onChange(fixed);
        }}
        options={(['fixed', 'random', 'growing'] as WaitLength[]).map((k) => ({
          value: k,
          label: t(`delay.length.${k}`),
        }))}
      />
      {kind === 'fixed' && (
        <div class="row nowrap small">
          <span aria-hidden="true">{t('delay.seconds')}</span>
          {seconds(t('delay.seconds'), v.seconds, (s) => onChange({ ...v, seconds: s }))}
        </div>
      )}
      {kind === 'random' && (
        <div class="row small">
          <span aria-hidden="true">{t('delay.between')}</span>
          {seconds(t('delay.shortest'), v.seconds, (s) => onChange({ ...v, seconds: s }))}
          <span aria-hidden="true">{t('delay.and')}</span>
          {seconds(t('delay.longest'), v.randomTo ?? v.seconds, (s) => onChange({ ...v, randomTo: s }), 2)}
        </div>
      )}
      {kind === 'growing' && (
        <>
          <div class="row small">
            <span aria-hidden="true">{t('delay.seconds')}</span>
            {seconds(t('delay.seconds'), v.seconds, (s) => onChange({ ...v, seconds: s }))}
            <span aria-hidden="true">{t('delay.plus')}</span>
            {seconds(t('delay.increase'), step, (s) => onChange({ ...v, increase: s }))}
            <span aria-hidden="true">{t('delay.eachTime')}</span>
          </div>
          <span class="help">
            {t('delay.growingHelp', {
              first: waitText(v.seconds),
              second: waitText(v.seconds + step),
              third: waitText(v.seconds + 2 * step),
            })}
          </span>
        </>
      )}
    </div>
  );
}

/** How a wait behaves: when one leaves the page, the countdown, the end of the wait. */
function WaitBehaviour({
  value: v,
  onChange,
}: {
  value: DelayIntervention;
  onChange: (i: Intervention) => void;
}) {
  const id = useId();
  return (
    <>
      <div class="stack stack-sm">
        <span class="label small" id={`${id}-blur`}>
          {t('delay.onBlur')}
        </span>
        <RadioList<'pause' | 'restart' | 'ignore'>
          labelledBy={`${id}-blur`}
          value={v.onBlur ?? 'pause'}
          onChange={(onBlur) => onChange({ ...v, onBlur })}
          options={[
            { value: 'pause', label: t('delay.onBlur.pause') },
            { value: 'restart', label: t('delay.onBlur.restart') },
            { value: 'ignore', label: t('delay.onBlur.ignore') },
          ]}
        />
      </div>
      <Toggle
        checked={!v.hideCountdown}
        onChange={(shown) => onChange({ ...v, hideCountdown: !shown })}
        label={t('delay.countdown')}
        help={t('delay.countdownHelp')}
      />
      <Toggle
        checked={Boolean(v.autoContinue)}
        onChange={(autoContinue) => onChange({ ...v, autoContinue })}
        label={t('delay.auto')}
        help={t('delay.autoHelp')}
      />
    </>
  );
}

/** Once through a wait or a challenge: what opens, and for how long. */
function GrantEditor({ grant, onChange }: { grant: GrantSpec; onChange: (g: GrantSpec) => void }) {
  const id = useId();
  return (
    <div class="stack stack-sm">
      <span class="label small" id={`${id}-scope`}>
        {t('grant.label')}
      </span>
      <Segmented<GrantSpec['scope']>
        value={grant.scope}
        labelledBy={`${id}-scope`}
        onChange={(scope) => onChange({ ...grant, scope })}
        options={[
          { value: 'page', label: t('grant.scope.page') },
          { value: 'site', label: t('grant.scope.site') },
          { value: 'group', label: t('grant.scope.group') },
        ]}
      />
      <span class="label small" id={`${id}-mode`}>
        {t('grant.mode')}
      </span>
      <div class="row">
        <Segmented<GrantSpec['mode']>
          value={grant.mode}
          labelledBy={`${id}-mode`}
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
