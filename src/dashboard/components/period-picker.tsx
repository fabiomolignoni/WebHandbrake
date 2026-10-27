/**
 * How often a limit starts again (`PeriodPicker`), for the limits of time and visits of a rule and
 * for the limits of breaks, with when it starts again next.
 */

import { useId, useState } from 'preact/hooks';
import { DAY_MINUTES, everyPeriod, periodMinutes } from '../../engine/defaults';
import { chosenPeriod, periodRange } from '../../engine/time';
import type { Period } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { whenParams } from '../../shared/format';
import { describePeriod } from '../../shared/summary';
import { DurationInput, Segmented } from '../../ui/components';
import { useDashboard } from '../context';

/** The periods that are choices of their own; any other is typed as a length ("Other"). */
const PERIODS = ['hour', 'day', 'week', 'month'] as const;
type PeriodChoice = (typeof PERIODS)[number] | 'other';
const usualPeriod = (p: Period) => (PERIODS as readonly string[]).includes(p.kind);

/**
 * Every hour, day, week or month (a week from the day weeks start on, a month from its first day),
 * or every so many minutes or hours from the start of the day, or days from the day they are chosen.
 */
export function PeriodPicker({
  period,
  onChange,
  saved,
  small,
  error,
  commitOnBlur,
}: {
  period: Period;
  onChange: (p: Period) => void;
  /** The period as saved: chosen again, it keeps its start. */
  saved?: Period;
  /** A small label, as among the limits of breaks. */
  small?: boolean;
  /** What is wrong with the period, in place of when it starts again. */
  error?: string;
  commitOnBlur?: boolean;
}) {
  const id = useId();
  const { model } = useDashboard();
  const { dayStart, weekStart } = model.config.settings;
  const cal = { dayStart, weekStart };
  const choose = (p: Period) => onChange(chosenPeriod(p, saved, Date.now(), cal));
  // "Other" is chosen, even when the length typed is a usual period (24 hours: a day).
  const [custom, setCustom] = useState(false);
  const choice: PeriodChoice = custom || !usualPeriod(period) ? 'other' : (period.kind as PeriodChoice);
  return (
    <div class="stack stack-xs period-picker">
      <span class={small ? 'label small' : 'label'} id={`${id}-every`}>
        {t('period.every')}
      </span>
      <div class="row">
        <Segmented<PeriodChoice>
          value={choice}
          labelledBy={`${id}-every`}
          onChange={(c) => {
            setCustom(c === 'other');
            if (c !== 'other') choose({ kind: c });
            // A week or a month becomes as many days: the field shows the period that applies.
            else if (period.kind === 'week' || period.kind === 'month')
              choose({ kind: 'days', n: period.kind === 'week' ? 7 : 30 });
          }}
          options={[...PERIODS, 'other' as const].map((c) => ({ value: c, label: t(`period.kind.${c}`) }))}
        />
        {choice === 'other' && (
          <DurationInput
            value={periodMinutes(period)}
            min={5}
            max={90 * DAY_MINUTES}
            unitMax={{ minutes: DAY_MINUTES, hours: DAY_MINUTES }}
            label={t('period.every')}
            describedBy={`${id}-next`}
            commitOnBlur={commitOnBlur}
            onChange={(minutes, unit) =>
              // A period of days counts whole days.
              choose(
                everyPeriod(
                  unit === 'days' ? Math.max(1, Math.round(minutes / DAY_MINUTES)) * DAY_MINUTES : minutes,
                ),
              )
            }
          />
        )}
      </div>
      {error ? (
        <span class="error-text" id={`${id}-next`}>
          {error}
        </span>
      ) : (
        <span class="help" id={`${id}-next`}>
          {/* A window that moves with the time does not start again: it has its own words. */}
          {period.kind === 'rolling'
            ? describePeriod(period)
            : t('period.next', whenParams(periodRange(period, Date.now(), cal).end))}
        </span>
      )}
    </div>
  );
}
