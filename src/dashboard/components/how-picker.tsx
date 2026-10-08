/**
 * "What should happen?" in the rule wizard and in onboarding: every intervention, gentlest first,
 * in the tones of the friction ladder, with the description of the chosen one. Nothing is
 * pre-selected: the right answer depends on the person (active choice, docs/design.md).
 * Every setting has a default except the redirect address, asked here.
 */

import type { QuickHow } from '../../engine/defaults';
import { isRedirectUrl } from '../../engine/validate';
import { t } from '../../i18n/i18n';
import { RadioCards } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { interventionIcon, LADDER, toneOf } from '../../ui/status';

export function HowPicker({
  value,
  onChange,
  label,
  disabled = [],
  disabledHint,
  redirectUrl,
  onRedirectUrl,
}: {
  value: QuickHow | null;
  onChange: (how: QuickHow) => void;
  label: string;
  disabled?: QuickHow[];
  disabledHint?: string;
  redirectUrl: string;
  onRedirectUrl: (url: string) => void;
}) {
  return (
    <div class="stack">
      <div>
        <div class="friction-scale" aria-hidden="true">
          <span>← {t('policy.gentler')}</span>
          <span>{t('policy.stronger')} →</span>
        </div>
        <RadioCards<QuickHow>
          value={value ?? ('' as QuickHow)}
          onChange={onChange}
          label={label}
          class="friction-picker how-grid"
          itemClass="friction-option"
          options={(LADDER as QuickHow[]).map((x) => ({
            value: x,
            tone: toneOf(x),
            disabled: disabled.includes(x),
          }))}
          render={(o) => (
            <>
              <Icon name={interventionIcon(o.value)} />
              <span>{t(`intervention.short.${o.value}`)}</span>
            </>
          )}
        />
      </div>
      {disabled.length > 0 && disabledHint && <p class="help">{disabledHint}</p>}
      {value && (
        <div class={`option-panel tone-${toneOf(value)}`} aria-live="polite">
          <p class="small">
            <strong>{t(`intervention.${value}`)}</strong> —{' '}
            {/* The full help of a redirect describes address placeholders: too much for a first choice. */}
            {value === 'redirect' ? t('wizard.how.redirectDesc') : t(`intervention.help.${value}`)}
          </p>
          {value === 'redirect' && (
            <div class="field">
              <label class="label small" for="how-redirect">
                {t('redirect.url')}
              </label>
              <input
                id="how-redirect"
                class="input mono"
                type="url"
                inputMode="url"
                value={redirectUrl}
                placeholder="https://"
                aria-invalid={redirectUrl !== '' && !isRedirectUrl(redirectUrl)}
                aria-describedby="how-redirect-help"
                onInput={(e) => onRedirectUrl((e.target as HTMLInputElement).value)}
              />
              <span class="help" id="how-redirect-help">
                {t('wizard.how.redirectHelp')}
              </span>
            </div>
          )}
          <span class="tiny muted">{t('wizard.how.later')}</span>
        </div>
      )}
    </div>
  );
}
