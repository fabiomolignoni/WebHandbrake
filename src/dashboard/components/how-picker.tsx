/**
 * "What should happen?" in the rule wizard and in first run: every intervention, gentlest first,
 * in the tones of the friction ladder, with the description of the chosen one. Nothing is
 * pre-selected: the right answer depends on the person (active choice). Once one
 * is chosen, its main settings can be changed here (#14): the filter, the length of the wait, the
 * kind of challenge, the longest time after the question and the redirect address; the others
 * keep their defaults and are in the full editor.
 */

import { type QuickHow, quickIntervention } from '../../engine/defaults';
import type { ChallengeKind, FilterKind, Intervention } from '../../engine/types';
import { isRedirectUrl } from '../../engine/validate';
import { t } from '../../i18n/i18n';
import { DurationInput, NumberInput, RadioCards, Select } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { interventionIcon, LADDER, toneOf } from '../../ui/status';

const FILTERS: FilterKind[] = ['grayscale', 'blur', 'fade', 'invert', 'sepia'];

/** Whether the chosen intervention can be used as it is (a redirect needs an address, a phrase its text). */
export function quickInterventionReady(i: Intervention | null): boolean {
  if (!i) return false;
  if (i.type === 'redirect') return isRedirectUrl(i.url);
  if (i.type === 'challenge' && i.kind === 'phrase') return Boolean(i.phrase?.trim());
  return true;
}

/** What was set for each intervention, so that switching to another one and back keeps it. */
export type KeptInterventions = Partial<Record<QuickHow, Intervention>>;

/** The intervention chosen, with what was set for it before or its defaults. */
export function pickIntervention(how: QuickHow, kept: KeptInterventions = {}): Intervention {
  // A redirect has no default address: the field starts empty.
  return kept[how] ?? (how === 'redirect' ? { type: 'redirect', url: '' } : quickIntervention(how));
}

export function HowPicker({
  value,
  onChange,
  label,
  kept = {},
}: {
  value: Intervention | null;
  /** The new intervention, and what is now kept for every intervention. */
  onChange: (i: Intervention, kept: KeptInterventions) => void;
  label: string;
  kept?: KeptInterventions;
}) {
  const how = (value?.type ?? null) as QuickHow | null;
  const set = (i: Intervention) => onChange(i, { ...kept, [i.type]: i });
  return (
    <div class="stack">
      <RadioCards<QuickHow>
        value={how ?? ('' as QuickHow)}
        onChange={(x) => set(pickIntervention(x, kept))}
        label={label}
        class="friction-picker how-grid"
        itemClass="friction-option"
        options={(LADDER as QuickHow[]).map((x) => ({ value: x, tone: toneOf(x) }))}
        render={(o) => (
          <>
            <Icon name={interventionIcon(o.value)} />
            <span>{t(`intervention.short.${o.value}`)}</span>
          </>
        )}
      />
      {value && how && (
        <div class={`option-panel tone-${toneOf(how)} stack stack-sm`} aria-live="polite">
          <p class="small">
            <strong>{t(`intervention.${how}`)}</strong> —{' '}
            {/* The full help of a redirect describes address placeholders: too much for a first choice. */}
            {how === 'redirect' ? t('wizard.how.redirectDesc') : t(`intervention.help.${how}`)}
          </p>
          <QuickOptions value={value} onChange={set} />
          <span class="tiny muted">{t('wizard.how.later')}</span>
        </div>
      )}
    </div>
  );
}

function QuickOptions({ value: v, onChange }: { value: Intervention; onChange: (i: Intervention) => void }) {
  switch (v.type) {
    case 'filter':
      return (
        <div class="row">
          <Select<FilterKind>
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
              <label class="label small" for="how-phrase">
                {t('challenge.phrase')}
              </label>
              <input
                id="how-phrase"
                class="input"
                value={v.phrase ?? ''}
                maxLength={300}
                aria-describedby="how-phrase-help"
                onInput={(e) => onChange({ ...v, phrase: (e.target as HTMLInputElement).value })}
              />
              <span class="help" id="how-phrase-help">
                {t('challenge.phraseHelp')}
              </span>
            </div>
          )}
        </div>
      );
    case 'redirect':
      return (
        <div class="field">
          <label class="label small" for="how-redirect">
            {t('redirect.url')}
          </label>
          <input
            id="how-redirect"
            class="input mono"
            type="url"
            inputMode="url"
            value={v.url}
            placeholder="https://"
            aria-invalid={v.url !== '' && !isRedirectUrl(v.url)}
            aria-describedby="how-redirect-help"
            onInput={(e) => onChange({ ...v, url: (e.target as HTMLInputElement).value })}
          />
          <span class="help" id="how-redirect-help">
            {t('wizard.how.redirectHelp')}
          </span>
        </div>
      );
    default:
      return null;
  }
}
