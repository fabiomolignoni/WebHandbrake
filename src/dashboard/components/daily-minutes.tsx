/**
 * "How much time?" in the rule wizard and in first run: the usual amounts, and any other amount
 * the person types, in minutes or hours (#13).
 */

import { t } from '../../i18n/i18n';
import { formatDuration } from '../../shared/format';
import { DurationInput, Segmented } from '../../ui/components';

export const DAILY_MINUTES = [15, 30, 45, 60, 90, 120];
/** The value of the "Other" choice in the segmented control. */
const OTHER = -1;
/** As much as a time limit allows: 90 days. */
const MAX_MINUTES = 90 * 24 * 60;

export function DailyMinutes({
  minutes,
  custom,
  onChange,
  label,
  labelledBy,
}: {
  minutes: number;
  /** "Other" is chosen, even when the amount typed equals one of the usual ones. */
  custom: boolean;
  onChange: (minutes: number, custom: boolean) => void;
  label?: string;
  labelledBy?: string;
}) {
  const other = custom || !DAILY_MINUTES.includes(minutes);
  return (
    <div class="stack stack-sm">
      <Segmented<number>
        value={other ? OTHER : minutes}
        onChange={(v) => (v === OTHER ? onChange(minutes, true) : onChange(v, false))}
        label={label}
        labelledBy={labelledBy}
        options={[
          ...DAILY_MINUTES.map((m) => ({ value: m, label: formatDuration(m * 60) })),
          { value: OTHER, label: t('dailyMinutes.other') },
        ]}
      />
      {other && (
        <DurationInput
          value={minutes}
          units={['minutes', 'hours']}
          min={1}
          max={MAX_MINUTES}
          label={t('dailyMinutes.custom')}
          onChange={(m) => onChange(m, true)}
        />
      )}
    </div>
  );
}
