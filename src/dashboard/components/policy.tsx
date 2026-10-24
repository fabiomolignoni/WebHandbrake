/**
 * When the condition of a rule applies (`ConditionEditor`): every time, at certain times, after
 * some time or after some visits, each with its settings in view. Also the period of the limits of
 * breaks (`PeriodSelect`).
 */

import { useId } from 'preact/hooks';
import { DAY_MINUTES, everyPeriod, periodMinutes, SCHEDULE_PRESETS } from '../../engine/defaults';
import { clone } from '../../engine/json';
import type {
  Budget,
  Period,
  Policy,
  Schedule,
  TimeBudget,
  TimeWindow,
  VisitBudget,
} from '../../engine/types';
import { t } from '../../i18n/i18n';
import { formatDuration } from '../../shared/format';
import { describePeriod } from '../../shared/summary';
import { DurationInput, NumberInput, RadioCards, Select, Toggle } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { type WhenKind, whenKind } from '../rule-form';
import { DailyMinutes } from './daily-minutes';
import { WindowsEditor } from './schedule';

/** "every 2 hours" and "every 3 days" are one choice in the list, with a number and a unit. */
type PeriodChoice = 'hour' | 'day' | 'week' | 'month' | 'every' | 'rolling';
const choiceOf = (p: Period): PeriodChoice => (p.kind === 'minutes' || p.kind === 'days' ? 'every' : p.kind);

export function PeriodSelect({
  period,
  onChange,
  allowRolling = true,
}: {
  period: Period;
  onChange: (p: Period) => void;
  allowRolling?: boolean;
}) {
  const offsetAllowed = allowRolling;
  const choices: PeriodChoice[] = [
    'hour',
    'day',
    'week',
    'month',
    'every',
    ...(allowRolling ? (['rolling'] as const) : []),
  ];
  const choice = choiceOf(period);
  return (
    <div class="row">
      <span style={{ minWidth: '160px' }}>
        <Select<PeriodChoice>
          value={choice}
          label={t('period.label')}
          onChange={(c) => {
            if (c === choice) return;
            if (c === 'every') onChange({ kind: 'minutes', n: 120 });
            else if (c === 'rolling')
              onChange({ kind: 'rolling', n: period.kind === 'minutes' ? (period.n ?? 120) : 120 });
            else onChange({ kind: c });
          }}
          options={choices.map((c) => ({ value: c, label: t(`period.kind.${c}`) }))}
        />
      </span>
      {choice === 'every' && (
        <DurationInput
          value={period.kind === 'days' ? (period.n ?? 1) * DAY_MINUTES : (period.n ?? 120)}
          min={5}
          max={90 * DAY_MINUTES}
          unitMax={{ minutes: DAY_MINUTES, hours: DAY_MINUTES }}
          label={t('period.every')}
          onChange={(minutes, unit) => {
            const kind = unit === 'days' ? 'days' : 'minutes';
            const n = kind === 'days' ? Math.max(1, Math.round(minutes / DAY_MINUTES)) : minutes;
            // An offset in minutes means nothing for a period of days, and the other way round.
            onChange({
              kind,
              n,
              ...(kind === period.kind && period.offset ? { offset: period.offset } : {}),
            });
          }}
        />
      )}
      {period.kind === 'rolling' && (
        <DurationInput
          value={period.n ?? 120}
          units={['minutes', 'hours']}
          min={5}
          max={DAY_MINUTES}
          label={t('period.rollingLength')}
          onChange={(n) => onChange({ ...period, n })}
        />
      )}
      {(period.kind === 'minutes' || period.kind === 'days') && offsetAllowed && (
        <>
          <span class="small">{t('period.offset')}</span>
          <NumberInput
            value={period.offset ?? 0}
            min={0}
            max={
              period.kind === 'minutes' ? Math.max(0, (period.n ?? 60) - 1) : Math.max(0, (period.n ?? 1) - 1)
            }
            label={t('period.offset')}
            suffix={period.kind === 'minutes' ? t('common.minutesUnit') : t('common.daysUnit')}
            onChange={(offset) => onChange({ ...period, offset: offset || undefined })}
          />
        </>
      )}
      {/* "per day" would only repeat the choice: the sentence helps only with a length. */}
      {(period.kind === 'minutes' || period.kind === 'days' || period.kind === 'rolling') && (
        <span class="help">{describePeriod(period)}</span>
      )}
    </div>
  );
}

const WHEN_KINDS: WhenKind[] = ['always', 'schedule', 'limit', 'visits'];
const WHEN_CARD: Record<WhenKind, { icon: string; label: string; desc: string }> = {
  always: { icon: 'zap', label: 'wizard.when.always', desc: 'wizard.when.always.desc' },
  schedule: { icon: 'calendar', label: 'wizard.when.schedule', desc: 'wizard.when.schedule.desc' },
  limit: { icon: 'hourglass', label: 'wizard.when.daily', desc: 'wizard.when.daily.desc' },
  visits: { icon: 'door', label: 'wizard.when.visits', desc: 'wizard.when.visits.desc' },
};

/** A limit as long as its period would never be reached. */
export const neverReached = (b: Budget | undefined): boolean =>
  b?.type === 'time' && b.minutes >= periodMinutes(b.period);

/** What a condition had before another answer was chosen, to give it back when chosen again. */
export interface ConditionMemo {
  windows?: TimeWindow[];
  time?: TimeBudget;
  visits?: VisitBudget;
  /** "Other" is chosen for the time allowed, even when the amount typed is one of the usual ones. */
  custom?: boolean;
}

/** When the condition of a rule applies: the answers, with the settings of the one chosen. */
export function ConditionEditor({
  policy,
  onChange,
  severalSites,
  memo,
  onMemo,
}: {
  policy: Policy;
  onChange: (p: Policy) => void;
  /** The rule has several sites: a limit is shared by them unless each gets its own. */
  severalSites: boolean;
  memo: ConditionMemo;
  onMemo: (m: ConditionMemo) => void;
}) {
  const id = useId();
  const kind = whenKind(policy);
  const { schedule, budget } = policy;
  const setBudget = (b: Budget) => onChange({ ...policy, budget: b });
  const always: Schedule = { mode: 'always', windows: [] };

  const choose = (k: WhenKind) => {
    if (k === kind) return;
    // What the condition had stays at hand for when it is chosen again.
    onMemo({
      ...memo,
      windows: schedule.windows.length ? schedule.windows : memo.windows,
      ...(budget ? { [budget.type]: budget } : {}),
    });
    if (k === 'always') onChange({ ...policy, schedule: always, budget: undefined });
    else if (k === 'schedule')
      onChange({
        ...policy,
        schedule: { mode: 'during', windows: memo.windows ?? clone(SCHEDULE_PRESETS.office) },
        budget: undefined,
      });
    else if (k === 'limit')
      onChange({
        ...policy,
        schedule: always,
        budget: memo.time ?? { type: 'time', minutes: 30, period: { kind: 'day' } },
      });
    else
      onChange({
        ...policy,
        schedule: always,
        budget: memo.visits ?? { type: 'visits', count: 3, period: { kind: 'day' } },
      });
  };

  return (
    <div class="stack">
      <RadioCards<WhenKind>
        value={kind}
        onChange={choose}
        label={t('wizard.when.title')}
        itemClass="choice"
        options={WHEN_KINDS.map((value) => ({ value }))}
        render={(o) => (
          <>
            <Icon name={WHEN_CARD[o.value].icon} />
            <span>
              <strong>{t(WHEN_CARD[o.value].label)}</strong>
              <span class="small muted">{t(WHEN_CARD[o.value].desc)}</span>
            </span>
          </>
        )}
      />
      {kind === 'schedule' && (
        <div class="option-panel">
          <WindowsEditor
            windows={schedule.windows}
            onChange={(windows) => onChange({ ...policy, schedule: { ...schedule, windows } })}
          />
        </div>
      )}
      {budget && (
        <div class="option-panel">
          {budget.type === 'time' ? (
            <>
              <span class="label" id={`${id}-minutes`}>
                {t('wizard.when.minutes')}
              </span>
              <DailyMinutes
                minutes={budget.minutes}
                custom={Boolean(memo.custom)}
                onChange={(minutes, custom) => {
                  onMemo({ ...memo, custom });
                  setBudget({ ...budget, minutes });
                }}
                labelledBy={`${id}-minutes`}
              />
            </>
          ) : (
            <div class="stack stack-sm">
              <div class="row">
                <span class="label" aria-hidden="true">
                  {t('budget.visitsQuestion')}
                </span>
                <NumberInput
                  value={budget.count}
                  min={0}
                  max={1000}
                  label={t('budget.visitsQuestion')}
                  suffix={t('budget.visitsUnit')}
                  describedBy={`${id}-visit-help`}
                  onChange={(count) => setBudget({ ...budget, count })}
                />
              </div>
              <span class="help" id={`${id}-visit-help`}>
                {t('budget.visitHelp')}
              </span>
            </div>
          )}
          <div class="row">
            <span class="label" aria-hidden="true">
              {t('wizard.when.every')}
            </span>
            <DurationInput
              value={periodMinutes(budget.period)}
              min={5}
              max={90 * DAY_MINUTES}
              unitMax={{ minutes: DAY_MINUTES, hours: DAY_MINUTES }}
              label={t('wizard.when.every')}
              describedBy={budget.type === 'time' ? `${id}-every-help` : undefined}
              onChange={(every, unit) =>
                // A period of days counts whole days.
                setBudget({
                  ...budget,
                  period: everyPeriod(
                    unit === 'days' ? Math.max(1, Math.round(every / DAY_MINUTES)) * DAY_MINUTES : every,
                  ),
                })
              }
            />
          </div>
          {neverReached(budget) ? (
            <span class="error-text" id={`${id}-every-help`}>
              {t('wizard.when.tooLong')}
            </span>
          ) : (
            budget.type === 'time' && (
              <span class="help" id={`${id}-every-help`}>
                {t('wizard.when.everyHelp')}
              </span>
            )
          )}
          {(severalSites || budget.perSite) && (
            <Toggle
              checked={Boolean(budget.perSite)}
              onChange={(perSite) => setBudget({ ...budget, perSite })}
              label={t('budget.perSite')}
              help={
                budget.type === 'time'
                  ? t(budget.perSite ? 'wizard.when.perSiteOn' : 'wizard.when.perSiteOff', {
                      duration: formatDuration(budget.minutes * 60),
                    })
                  : t(budget.perSite ? 'wizard.when.visitsPerSiteOn' : 'wizard.when.visitsPerSiteOff', {
                      count: budget.count,
                    })
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
