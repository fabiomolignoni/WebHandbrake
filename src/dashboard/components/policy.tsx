/**
 * Policy editors: condition (schedule + budget) → intervention. As in the
 * wizard, the rule editor asks when a condition applies and what happens in two parts: an open
 * condition shows the questions of its part, each answered with cards.
 */

import { useState } from 'preact/hooks';
import { DAY_MINUTES, defaultIntervention, periodMinutes } from '../../engine/defaults';
import type {
  Budget,
  ChallengeKind,
  Charset,
  FilterKind,
  GrantSpec,
  Intervention,
  InterventionType,
  Period,
  Policy,
} from '../../engine/types';
import { t } from '../../i18n/i18n';
import { describeCondition, describeIntervention, describePeriod } from '../../shared/summary';
import {
  Button,
  DurationInput,
  Field,
  Menu,
  NumberInput,
  RadioCards,
  Select,
  StatusPill,
  Toggle,
} from '../../ui/components';
import { Icon } from '../../ui/icons';
import { interventionIcon, LADDER, toneOf } from '../../ui/status';

/** The editor also offers "Don't count", for the times a rule should leave alone. */
const EDITOR_LADDER: InterventionType[] = ['allow', ...LADDER];

import { ScheduleEditor } from './schedule';

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

type BudgetChoice = 'none' | Budget['type'];
const BUDGET_CHOICES: BudgetChoice[] = ['none', 'time', 'visits', 'session'];
const BUDGET_CHOICE: Record<BudgetChoice, { icon: string; label: string; desc: string }> = {
  none: { icon: 'arrow-right', label: 'budget.choice.none', desc: 'budget.choice.none.desc' },
  time: { icon: 'hourglass', label: 'budget.choice.time', desc: 'budget.choice.time.desc' },
  visits: { icon: 'door', label: 'budget.choice.visits', desc: 'budget.choice.visits.desc' },
  session: { icon: 'timer', label: 'budget.choice.session', desc: 'budget.choice.session.desc' },
};

/** "Right away, or after a limit?": the limit of a condition as cards, its settings below. */
export function BudgetEditor({
  budget,
  onChange,
  advanced,
}: {
  budget: Budget | undefined;
  onChange: (b: Budget | undefined) => void;
  advanced: boolean;
}) {
  const type = budget?.type ?? 'none';
  return (
    <div class="stack">
      <RadioCards<BudgetChoice>
        value={type}
        label={t('budget.label')}
        class="choice-grid two"
        itemClass="choice compact"
        onChange={(v) => {
          if (v === type) return;
          if (v === 'none') onChange(undefined);
          else if (v === 'time') onChange({ type: 'time', minutes: 30, period: { kind: 'day' } });
          else if (v === 'visits') onChange({ type: 'visits', count: 3, period: { kind: 'day' } });
          else onChange({ type: 'session', maxMinutes: 15, cooldownMinutes: 60 });
        }}
        options={BUDGET_CHOICES.map((value) => ({ value }))}
        render={(o) => (
          <>
            <Icon name={BUDGET_CHOICE[o.value].icon} />
            <span>
              <strong>{t(BUDGET_CHOICE[o.value].label)}</strong>
              <span class="small muted">{t(BUDGET_CHOICE[o.value].desc)}</span>
            </span>
          </>
        )}
      />
      {budget && (
        <div class="option-panel">
          {budget?.type === 'time' && (
            <div class="stack stack-sm">
              <div class="row">
                <span>{t('budget.after')}</span>
                <DurationInput
                  value={budget.minutes}
                  units={['minutes', 'hours']}
                  min={0.5}
                  max={129600}
                  step={0.5}
                  label={t('budget.minutes')}
                  onChange={(minutes) => onChange({ ...budget, minutes })}
                />
              </div>
              <PeriodSelect
                period={budget.period}
                onChange={(period) => onChange({ ...budget, period })}
                allowRolling={advanced}
              />
              {budget.minutes >= periodMinutes(budget.period) && (
                <span class="error-text">{t('budget.neverReached')}</span>
              )}
            </div>
          )}
          {budget?.type === 'visits' && (
            <div class="stack stack-sm">
              <div class="row">
                <span>{t('budget.afterVisits')}</span>
                <NumberInput
                  value={budget.count}
                  min={0}
                  max={1000}
                  label={t('budget.visitsLabel')}
                  suffix={t('budget.visitsUnit')}
                  onChange={(count) => onChange({ ...budget, count })}
                />
              </div>
              <PeriodSelect
                period={budget.period}
                onChange={(period) => onChange({ ...budget, period })}
                allowRolling={advanced}
              />
              <div class="row">
                <label class="check small">
                  <input
                    type="checkbox"
                    checked={Boolean(budget.maxVisitMinutes)}
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
          {budget?.type === 'session' && (
            <div class="row">
              <span>{t('budget.sessionMax')}</span>
              <DurationInput
                value={budget.maxMinutes}
                units={['minutes', 'hours']}
                min={0.5}
                max={1440}
                step={0.5}
                label={t('budget.sessionMax')}
                onChange={(maxMinutes) => onChange({ ...budget, maxMinutes })}
              />
              <span>{t('budget.sessionCooldown')}</span>
              <DurationInput
                value={budget.cooldownMinutes}
                min={1}
                max={10080}
                label={t('budget.sessionCooldown')}
                onChange={(cooldownMinutes) => onChange({ ...budget, cooldownMinutes })}
              />
            </div>
          )}
          {budget && advanced && (
            <Toggle
              checked={Boolean(budget.perSite)}
              onChange={(perSite) => onChange({ ...budget, perSite } as Budget)}
              label={t('budget.perSite')}
              help={t('budget.perSiteHelp')}
            />
          )}
        </div>
      )}
    </div>
  );
}

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

export function InterventionEditor({
  value,
  onChange,
  advanced,
}: {
  value: Intervention;
  onChange: (i: Intervention) => void;
  advanced: boolean;
}) {
  const v = value;
  return (
    <div class="stack">
      <div>
        <div class="friction-scale" aria-hidden="true">
          <span>← {t('policy.gentler')}</span>
          <span>{t('policy.stronger')} →</span>
        </div>
        <RadioCards<InterventionType>
          value={v.type}
          onChange={(type) => onChange(defaultIntervention(type))}
          label={t('intervention.label')}
          class="friction-picker"
          itemClass="friction-option"
          options={EDITOR_LADDER.map((x) => ({ value: x, tone: toneOf(x) }))}
          render={(o) => (
            <>
              <Icon name={interventionIcon(o.value)} />
              <span>{t(`intervention.short.${o.value}`)}</span>
            </>
          )}
        />
      </div>
      <div class={`option-panel tone-${toneOf(v.type)}`}>
        <p class="small">
          <strong>{t(`intervention.${v.type}`)}</strong> — {t(`intervention.help.${v.type}`)}
        </p>
        {v.type === 'filter' && (
          <div class="stack stack-sm">
            <div class="row">
              <Select<FilterKind>
                value={v.filter}
                label={t('filter.label')}
                onChange={(filter) => onChange({ ...v, filter })}
                options={(
                  [
                    'grayscale',
                    'blur',
                    'fade',
                    'invert',
                    'sepia',
                    'none',
                    ...(advanced ? (['custom'] as const) : []),
                  ] as FilterKind[]
                ).map((f) => ({ value: f, label: t(`filter.${f}`) }))}
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
                    onInput={(e) =>
                      onChange({ ...v, intensity: Number((e.target as HTMLInputElement).value) })
                    }
                  />
                  <span class="num">{v.intensity ?? 100}%</span>
                </label>
              )}
            </div>
            {v.filter === 'custom' && (
              <Field label={t('filter.custom')} help={t('filter.customHelp')}>
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    class="input mono"
                    value={v.css ?? ''}
                    maxLength={200}
                    onInput={(e) => onChange({ ...v, css: (e.target as HTMLInputElement).value })}
                  />
                )}
              </Field>
            )}
            <Toggle
              checked={Boolean(v.mute)}
              onChange={(mute) => onChange({ ...v, mute })}
              label={t('filter.mute')}
            />
          </div>
        )}
        {v.type === 'ask' && (
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
              <span>{t('ask.max')}</span>
              <DurationInput
                units={['minutes', 'hours']}
                value={v.maxMinutes}
                min={1}
                max={1440}
                label={t('ask.max')}
                onChange={(maxMinutes) => onChange({ ...v, maxMinutes })}
              />
            </div>
            <p class="help">{t('ask.help')}</p>
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
          </div>
        )}
        {v.type === 'delay' && (
          <div class="stack stack-sm">
            <div class="row">
              <span>{t('delay.seconds')}</span>
              <DurationInput
                base="seconds"
                units={['seconds', 'minutes']}
                value={v.seconds}
                min={1}
                max={3600}
                label={t('delay.seconds')}
                onChange={(seconds) => onChange({ ...v, seconds })}
              />
              {advanced && (
                <>
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
                </>
              )}
            </div>
            {advanced && (
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
            )}
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
          </div>
        )}
        {v.type === 'challenge' && (
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
                <>
                  <NumberInput
                    value={v.length ?? 24}
                    min={4}
                    max={500}
                    label={t('challenge.length')}
                    suffix={t('challenge.chars')}
                    onChange={(length) => onChange({ ...v, length })}
                  />
                  {advanced && (
                    <Select<Charset>
                      value={v.charset ?? 'alnum'}
                      label={t('challenge.charset')}
                      onChange={(charset) => onChange({ ...v, charset })}
                      options={(['alnum', 'letters', 'digits', 'symbols'] as Charset[]).map((c) => ({
                        value: c,
                        label: t(`challenge.charset.${c}`),
                      }))}
                    />
                  )}
                </>
              )}
            </div>
            {v.kind === 'phrase' && (
              <Field label={t('challenge.phrase')} help={t('challenge.phraseHelp')}>
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    class="input"
                    value={v.phrase ?? ''}
                    maxLength={300}
                    onInput={(e) => onChange({ ...v, phrase: (e.target as HTMLInputElement).value })}
                  />
                )}
              </Field>
            )}
            <GrantEditor grant={v.grant} onChange={(grant) => onChange({ ...v, grant })} />
          </div>
        )}
        {v.type === 'redirect' && (
          <Field label={t('redirect.url')} help={t('redirect.help')}>
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                class="input mono"
                value={v.url}
                maxLength={2000}
                onInput={(e) => onChange({ ...v, url: (e.target as HTMLInputElement).value })}
              />
            )}
          </Field>
        )}
      </div>
    </div>
  );
}

export function PolicyCard({
  policy,
  index,
  count,
  part,
  onChange,
  onMove,
  onRemove,
  advanced,
  open: initialOpen,
}: {
  policy: Policy;
  index: number;
  count: number;
  /** The part of the rule editor: when the condition applies, or what happens then. */
  part: 'when' | 'how';
  onChange: (p: Policy) => void;
  /** Conditions are ordered and removed where they are defined, in the "when" part. */
  onMove?: (dir: -1 | 1) => void;
  onRemove?: () => void;
  advanced: boolean;
  open?: boolean;
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
          {part === 'when' ? (
            <>
              <div class="question">
                <h3>{t('policy.q.times')}</h3>
                <ScheduleEditor
                  schedule={policy.schedule}
                  onChange={(schedule) => onChange({ ...policy, schedule })}
                />
              </div>
              <div class="question">
                <h3>{t('policy.q.limit')}</h3>
                <BudgetEditor
                  budget={policy.budget}
                  advanced={advanced}
                  onChange={(budget) => onChange({ ...policy, budget })}
                />
              </div>
            </>
          ) : (
            <InterventionEditor
              value={policy.intervention}
              advanced={advanced}
              onChange={(intervention) => onChange({ ...policy, intervention })}
            />
          )}
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
