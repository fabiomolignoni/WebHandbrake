/**
 * The conditions of a rule: when one applies (`ConditionEditor`) and the card that holds each
 * condition of a rule that has several (`PolicyCard`). A condition asks the first question of a
 * new rule ("When should it apply?": every time, at certain times, after some time); the rest
 * (outside certain times, visits, continuous use, other periods, a limit only at certain times)
 * is in its advanced options.
 */

import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { DAY_MINUTES, everyPeriod, periodMinutes, SCHEDULE_PRESETS } from '../../engine/defaults';
import { clone } from '../../engine/json';
import type { Budget, Period, Policy, Schedule, TimeWindow } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { formatDuration } from '../../shared/format';
import { describeCondition, describeIntervention, describePeriod } from '../../shared/summary';
import {
  Button,
  DurationInput,
  Menu,
  NumberInput,
  RadioCards,
  Segmented,
  Select,
  StatusPill,
  Toggle,
} from '../../ui/components';
import { Icon } from '../../ui/icons';
import { interventionIcon, toneOf } from '../../ui/status';
import { conditionAdvanced, everyKind, type WhenKind, whenKind } from '../rule-form';
import { AdvancedOptions } from './advanced';
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

const WHEN_KINDS: WhenKind[] = ['always', 'schedule', 'limit'];
const WHEN_CARD: Record<WhenKind, { icon: string; label: string; desc: string }> = {
  always: { icon: 'zap', label: 'wizard.when.always', desc: 'wizard.when.always.desc' },
  schedule: { icon: 'calendar', label: 'wizard.when.schedule', desc: 'wizard.when.schedule.desc' },
  limit: { icon: 'hourglass', label: 'wizard.when.daily', desc: 'wizard.when.daily.desc' },
};

/** A limit as long as its period would never be reached. */
export const neverReached = (b: Budget | undefined): boolean =>
  b?.type === 'time' && b.minutes >= periodMinutes(b.period);

/** What a condition had before another answer was chosen, to give it back when chosen again. */
export interface ConditionMemo {
  windows?: TimeWindow[];
  budget?: Budget;
  /** "Other" is chosen for the time allowed, even when the amount typed is one of the usual ones. */
  custom?: boolean;
}

/**
 * When a condition applies: the cards of the first question with their settings, then the advanced
 * options. `more` goes at the end of the advanced options (adding conditions, when the rule has one).
 */
export function ConditionEditor({
  policy,
  onChange,
  severalSites,
  memo,
  onMemo,
  more,
}: {
  policy: Policy;
  onChange: (p: Policy) => void;
  /** The rule has several sites: a time limit is shared by them unless each gets its own. */
  severalSites: boolean;
  memo: ConditionMemo;
  onMemo: (m: ConditionMemo) => void;
  more?: ComponentChildren;
}) {
  const id = useId();
  const kind = whenKind(policy);
  const { schedule, budget } = policy;
  const setBudget = (b: Budget) => onChange({ ...policy, budget: b });
  const setSchedule = (s: Schedule) => onChange({ ...policy, schedule: s });
  const windowsOr = () =>
    schedule.windows.length ? schedule.windows : (memo.windows ?? clone(SCHEDULE_PRESETS.office));

  const choose = (k: WhenKind) => {
    if (k === kind) return;
    // What the condition had stays at hand for when it is chosen again.
    onMemo({
      ...memo,
      windows: schedule.windows.length ? schedule.windows : memo.windows,
      budget: budget ?? memo.budget,
    });
    if (k === 'always') onChange({ ...policy, schedule: { mode: 'always', windows: [] }, budget: undefined });
    else if (k === 'schedule')
      onChange({
        ...policy,
        schedule: { mode: schedule.mode === 'outside' ? 'outside' : 'during', windows: windowsOr() },
        budget: undefined,
      });
    else
      onChange({
        ...policy,
        schedule: { mode: 'always', windows: [] },
        budget: memo.budget ?? { type: 'time', minutes: 30, period: { kind: 'day' } },
      });
  };

  const advanced =
    kind === 'schedule' ? (
      <ScheduleMode schedule={schedule} onChange={setSchedule} />
    ) : kind === 'limit' && budget ? (
      <LimitAdvanced
        budget={budget}
        onChange={setBudget}
        schedule={schedule}
        onSchedule={setSchedule}
        windows={windowsOr}
      />
    ) : null;

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
            onChange={(windows) => setSchedule({ ...schedule, windows })}
          />
        </div>
      )}
      {kind === 'limit' && budget && (
        <div class="option-panel">
          {budget.type === 'time' && (
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
          )}
          {budget.type === 'visits' && (
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
                onChange={(count) => setBudget({ ...budget, count })}
              />
            </div>
          )}
          {budget.type === 'session' && (
            <div class="row">
              <span>{t('budget.sessionMax')}</span>
              <DurationInput
                value={budget.maxMinutes}
                units={['minutes', 'hours']}
                min={0.5}
                max={1440}
                step={0.5}
                label={t('budget.sessionMax')}
                onChange={(maxMinutes) => setBudget({ ...budget, maxMinutes })}
              />
              <span>{t('budget.sessionCooldown')}</span>
              <DurationInput
                value={budget.cooldownMinutes}
                min={1}
                max={10080}
                label={t('budget.sessionCooldown')}
                onChange={(cooldownMinutes) => setBudget({ ...budget, cooldownMinutes })}
              />
            </div>
          )}
          {budget.type !== 'session' && everyKind(budget.period) && (
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
                describedBy={`${id}-every-help`}
                onChange={(every, unit) =>
                  // A period of days counts whole days.
                  setBudget({
                    ...budget,
                    period: withOffset(
                      everyPeriod(
                        unit === 'days' ? Math.max(1, Math.round(every / DAY_MINUTES)) * DAY_MINUTES : every,
                      ),
                      budget.period,
                    ),
                  })
                }
              />
            </div>
          )}
          {neverReached(budget) ? (
            <span class="error-text" id={`${id}-every-help`}>
              {t('wizard.when.tooLong')}
            </span>
          ) : (
            budget.type === 'time' &&
            everyKind(budget.period) && (
              <span class="help" id={`${id}-every-help`}>
                {t('wizard.when.everyHelp')}
              </span>
            )
          )}
          {(severalSites || budget.perSite) && (
            <Toggle
              checked={Boolean(budget.perSite)}
              onChange={(perSite) => setBudget({ ...budget, perSite } as Budget)}
              label={t('budget.perSite')}
              help={
                budget.type === 'time'
                  ? t(budget.perSite ? 'wizard.when.perSiteOn' : 'wizard.when.perSiteOff', {
                      duration: formatDuration(budget.minutes * 60),
                    })
                  : t('budget.perSiteHelp')
              }
            />
          )}
        </div>
      )}
      {(advanced || more) && (
        <AdvancedOptions open={conditionAdvanced(policy)}>
          {advanced}
          {more}
        </AdvancedOptions>
      )}
    </div>
  );
}

/** The offset of a period, kept when the new period has the same unit and still contains it. */
function withOffset(next: Period, prev: Period): Period {
  const offset = prev.offset;
  return offset && next.kind === prev.kind && offset < (next.n ?? 1) ? { ...next, offset } : next;
}

/** At certain times: during them, or at any time except them. */
function ScheduleMode({ schedule, onChange }: { schedule: Schedule; onChange: (s: Schedule) => void }) {
  const id = useId();
  return (
    <div class="stack stack-sm">
      <span class="label" id={`${id}-mode`}>
        {t('schedule.when')}
      </span>
      <Segmented<'during' | 'outside'>
        value={schedule.mode === 'outside' ? 'outside' : 'during'}
        onChange={(mode) => onChange({ ...schedule, mode })}
        labelledBy={`${id}-mode`}
        options={[
          { value: 'during', label: t('schedule.mode.during') },
          { value: 'outside', label: t('schedule.mode.outside') },
        ]}
      />
      <span class="help">
        {t(schedule.mode === 'outside' ? 'schedule.mode.outside.desc' : 'schedule.mode.during.desc')}
      </span>
    </div>
  );
}

const COUNTS_HELP: Record<Budget['type'], string> = {
  time: 'budget.choice.time.desc',
  visits: 'budget.choice.visits.desc',
  session: 'budget.choice.session.desc',
};

type PeriodStyle = 'every' | 'week' | 'month' | 'rolling';
const styleOf = (p: Period): PeriodStyle =>
  p.kind === 'week' || p.kind === 'month' || p.kind === 'rolling' ? p.kind : 'every';

/**
 * The advanced options of a limit: what it counts (time, visits, time in a row), when it starts
 * again other than every so often, how long a visit can be, and only at certain times.
 */
function LimitAdvanced({
  budget,
  onChange,
  schedule,
  onSchedule,
  windows,
}: {
  budget: Budget;
  onChange: (b: Budget) => void;
  schedule: Schedule;
  onSchedule: (s: Schedule) => void;
  windows: () => TimeWindow[];
}) {
  const id = useId();
  const keep = { ...(budget.perSite ? { perSite: true } : {}) };
  const period: Period = budget.type === 'session' ? { kind: 'day' } : budget.period;
  const setPeriod = (p: Period) => budget.type !== 'session' && onChange({ ...budget, period: p });
  return (
    <div class="stack">
      <div class="stack stack-sm">
        <span class="label" id={`${id}-type`}>
          {t('budget.counts')}
        </span>
        <Segmented<Budget['type']>
          value={budget.type}
          labelledBy={`${id}-type`}
          onChange={(type) => {
            if (type === budget.type) return;
            if (type === 'time') onChange({ type, minutes: 30, period, ...keep });
            else if (type === 'visits') onChange({ type, count: 3, period, ...keep });
            else onChange({ type, maxMinutes: 15, cooldownMinutes: 60, ...keep });
          }}
          options={[
            { value: 'time', label: t('budget.kind.time') },
            { value: 'visits', label: t('budget.kind.visits') },
            { value: 'session', label: t('budget.kind.session') },
          ]}
        />
        <span class="help">{t(COUNTS_HELP[budget.type])}</span>
      </div>
      {budget.type !== 'session' && (
        <div class="stack stack-sm">
          <div class="row">
            <span style={{ minWidth: '160px' }}>
              <Select<PeriodStyle>
                value={styleOf(budget.period)}
                label={t('period.label')}
                onChange={(style) => {
                  if (style === styleOf(budget.period)) return;
                  if (style === 'every') setPeriod({ kind: 'day' });
                  else if (style === 'rolling') setPeriod({ kind: 'rolling', n: 120 });
                  else setPeriod({ kind: style });
                }}
                options={(['every', 'week', 'month', 'rolling'] as PeriodStyle[]).map((s) => ({
                  value: s,
                  label: t(`period.style.${s}`),
                }))}
              />
            </span>
            {budget.period.kind === 'rolling' && (
              <DurationInput
                value={budget.period.n ?? 120}
                units={['minutes', 'hours']}
                min={5}
                max={DAY_MINUTES}
                label={t('period.rollingLength')}
                onChange={(n) => setPeriod({ kind: 'rolling', n })}
              />
            )}
            {(budget.period.kind === 'minutes' || budget.period.kind === 'days') && (
              <>
                <span class="small">{t('period.offset')}</span>
                <NumberInput
                  value={budget.period.offset ?? 0}
                  min={0}
                  max={Math.max(0, (budget.period.n ?? 1) - 1)}
                  label={t('period.offset')}
                  suffix={budget.period.kind === 'minutes' ? t('common.minutesUnit') : t('common.daysUnit')}
                  onChange={(offset) => setPeriod({ ...budget.period, offset: offset || undefined })}
                />
              </>
            )}
          </div>
          {budget.period.kind === 'rolling' && <span class="help">{describePeriod(budget.period)}</span>}
        </div>
      )}
      {budget.type === 'visits' && (
        <div class="stack stack-sm">
          <div class="row">
            <label class="check small">
              <input
                type="checkbox"
                checked={budget.maxVisitMinutes !== undefined}
                onChange={(e) =>
                  onChange({
                    ...budget,
                    maxVisitMinutes: (e.target as HTMLInputElement).checked ? 10 : undefined,
                  })
                }
              />
              {t('budget.visitMaxLabel')}
            </label>
            {budget.maxVisitMinutes !== undefined && (
              <DurationInput
                value={budget.maxVisitMinutes}
                units={['minutes', 'hours']}
                min={0.5}
                max={1440}
                step={0.5}
                label={t('budget.visitMaxLabel')}
                onChange={(m) => onChange({ ...budget, maxVisitMinutes: m })}
              />
            )}
          </div>
          <span class="help">{t('budget.visitHelp')}</span>
        </div>
      )}
      <div class="stack stack-sm">
        <label class="check">
          <input
            type="checkbox"
            checked={schedule.mode !== 'always'}
            onChange={(e) =>
              onSchedule(
                (e.target as HTMLInputElement).checked
                  ? { mode: 'during', windows: windows() }
                  : { mode: 'always', windows: [] },
              )
            }
          />
          {t('budget.onlyAt')}
        </label>
        {schedule.mode !== 'always' && (
          <div class="option-panel">
            <ScheduleMode schedule={schedule} onChange={onSchedule} />
            <WindowsEditor
              windows={schedule.windows}
              onChange={(w) => onSchedule({ ...schedule, windows: w })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One condition of a rule that has several: its sentence ("Mon–Fri 9:00–17:00 → Block") opens the
 * part being edited; in When, a menu moves and removes it.
 */
export function PolicyCard({
  policy,
  index,
  count,
  onMove,
  onRemove,
  open: initialOpen,
  children,
}: {
  policy: Policy;
  index: number;
  count: number;
  /** Conditions are ordered and removed where they are defined, in When. */
  onMove?: (dir: -1 | 1) => void;
  onRemove?: () => void;
  open?: boolean;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(Boolean(initialOpen));
  return (
    <div class={`policy${open ? ' open' : ''}`}>
      <div class="policy-head">
        <span class="policy-index" aria-hidden="true">
          {index + 1}
        </span>
        <button type="button" class="policy-sentence" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span class="sr-only">{t('policy.number', { n: index + 1 })} </span>
          <span class="cond">{describeCondition(policy)}</span>
          <span class="arrow" aria-hidden="true">
            →
          </span>
          <StatusPill
            small
            tone={toneOf(policy.intervention.type)}
            icon={interventionIcon(policy.intervention.type)}
          >
            {describeIntervention(policy.intervention)}
          </StatusPill>
        </button>
        {onMove && onRemove && (
          <Menu
            label={t('policy.actions', { n: index + 1 })}
            items={[
              { label: t('policy.edit'), icon: 'edit', onSelect: () => setOpen(true) },
              'separator',
              {
                label: t('policy.up'),
                icon: 'chevron-up',
                disabled: index === 0,
                onSelect: () => onMove(-1),
              },
              {
                label: t('policy.down'),
                icon: 'chevron-down',
                disabled: index === count - 1,
                onSelect: () => onMove(1),
              },
              'separator',
              { label: t('policy.remove'), icon: 'trash', danger: true, onSelect: onRemove },
            ]}
          />
        )}
      </div>
      {open && (
        <div class="policy-body">
          {children}
          <div class="row end">
            <Button size="small" icon="check" onClick={() => setOpen(false)}>
              {t('common.done')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
