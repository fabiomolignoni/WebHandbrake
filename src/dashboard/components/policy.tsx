/**
 * When the condition of a rule applies (`ConditionEditor`): every time, at certain times, after
 * some time or after some visits, each with its settings in view.
 */

import { useId } from 'preact/hooks';
import { periodMinutes, SCHEDULE_PRESETS } from '../../engine/defaults';
import { clone } from '../../engine/json';
import type { Budget, Policy, Schedule, TimeBudget, TimeWindow, VisitBudget } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { formatDuration, formatMinutesOfDay } from '../../shared/format';
import { NumberInput, RadioCards, Toggle } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { type WhenKind, whenKind } from '../rule-form';
import { DailyMinutes } from './daily-minutes';
import { PeriodPicker } from './period-picker';
import { WindowsEditor } from './schedule';

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
  saved,
  severalSites,
  memo,
  onMemo,
}: {
  policy: Policy;
  onChange: (p: Policy) => void;
  /** The limit as saved, for a rule that exists. */
  saved?: Budget;
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
              <span class="small muted">
                {t(WHEN_CARD[o.value].desc, {
                  start: formatMinutesOfDay(9 * 60),
                  end: formatMinutesOfDay(17 * 60),
                })}
              </span>
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
                  suffix={t('budget.visitsUnit', { n: budget.count })}
                  describedBy={`${id}-visit-help`}
                  onChange={(count) => setBudget({ ...budget, count })}
                />
              </div>
              <span class="help" id={`${id}-visit-help`}>
                {t('budget.visitHelp')}
              </span>
            </div>
          )}
          <PeriodPicker
            period={budget.period}
            saved={saved?.period}
            error={neverReached(budget) ? t('wizard.when.tooLong') : undefined}
            onChange={(period) => setBudget({ ...budget, period })}
          />
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
