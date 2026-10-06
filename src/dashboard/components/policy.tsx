/** Policy editors: condition (schedule + budget) → intervention (SCH-04, LIM, INT). */

import { useState } from 'preact/hooks';
import { defaultIntervention } from '../../engine/defaults';
import type {
  Budget,
  ChallengeKind,
  Charset,
  FilterKind,
  GrantSpec,
  Intervention,
  InterventionType,
  Period,
  PeriodKind,
  Policy,
} from '../../engine/types';
import { t } from '../../i18n/i18n';
import { describeCondition, describeIntervention, describePeriod } from '../../shared/summary';
import {
  Button,
  Field,
  Menu,
  NumberInput,
  RadioCards,
  Segmented,
  Select,
  StatusPill,
  Toggle,
} from '../../ui/components';
import { Icon } from '../../ui/icons';
import { interventionIcon, LADDER, toneOf } from '../../ui/status';
import { ScheduleEditor } from './schedule';

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
  const kinds: PeriodKind[] = [
    'hour',
    'day',
    'week',
    'month',
    'minutes',
    'days',
    ...(allowRolling ? (['rolling'] as const) : []),
  ];
  return (
    <div class="row">
      <span style={{ minWidth: '190px' }}>
        <Select<PeriodKind>
          value={period.kind}
          label={t('period.label')}
          onChange={(kind) =>
            onChange({
              kind,
              ...(kind === 'minutes' || kind === 'rolling'
                ? { n: period.n && period.n <= 1440 ? period.n : 120 }
                : kind === 'days'
                  ? { n: Math.min(90, period.n ?? 2) }
                  : {}),
            })
          }
          options={kinds.map((k) => ({ value: k, label: t(`period.kind.${k}`) }))}
        />
      </span>
      {(period.kind === 'minutes' || period.kind === 'rolling') && (
        <NumberInput
          value={period.n ?? 120}
          min={5}
          max={1440}
          step={5}
          label={t('period.minutes')}
          suffix={t('common.minutesUnit')}
          onChange={(n) => onChange({ ...period, n })}
        />
      )}
      {period.kind === 'days' && (
        <NumberInput
          value={period.n ?? 2}
          min={1}
          max={90}
          label={t('period.days')}
          suffix={t('common.daysUnit')}
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
      <span class="help">{describePeriod(period)}</span>
    </div>
  );
}

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
      <Segmented<'none' | Budget['type']>
        value={type}
        label={t('budget.label')}
        onChange={(v) => {
          if (v === 'none') onChange(undefined);
          else if (v === 'time') onChange({ type: 'time', minutes: 30, period: { kind: 'day' } });
          else if (v === 'visits') onChange({ type: 'visits', count: 3, period: { kind: 'day' } });
          else onChange({ type: 'session', maxMinutes: 15, cooldownMinutes: 60 });
        }}
        options={[
          { value: 'none', label: t('budget.none') },
          { value: 'time', label: t('budget.kind.time') },
          { value: 'visits', label: t('budget.kind.visits') },
          { value: 'session', label: t('budget.kind.session') },
        ]}
      />
      {budget?.type === 'time' && (
        <div class="stack stack-sm">
          <div class="row">
            <span>{t('budget.after')}</span>
            <NumberInput
              value={budget.minutes}
              min={0.5}
              max={129600}
              step={0.5}
              label={t('budget.minutes')}
              suffix={t('common.minutesUnit')}
              onChange={(minutes) => onChange({ ...budget, minutes })}
            />
          </div>
          <PeriodSelect
            period={budget.period}
            onChange={(period) => onChange({ ...budget, period })}
            allowRolling={advanced}
          />
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
              <NumberInput
                value={budget.maxVisitMinutes}
                min={0.5}
                max={1440}
                label={t('budget.visitMaxLabel')}
                suffix={t('common.minutesUnit')}
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
          <NumberInput
            value={budget.maxMinutes}
            min={0.5}
            max={1440}
            label={t('budget.sessionMax')}
            suffix={t('common.minutesUnit')}
            onChange={(maxMinutes) => onChange({ ...budget, maxMinutes })}
          />
          <span>{t('budget.sessionCooldown')}</span>
          <NumberInput
            value={budget.cooldownMinutes}
            min={1}
            max={10080}
            label={t('budget.sessionCooldown')}
            suffix={t('common.minutesUnit')}
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
          <NumberInput
            value={grant.minutes ?? 10}
            min={1}
            max={1440}
            label={t('grant.minutes')}
            suffix={t('common.minutesUnit')}
            onChange={(minutes) => onChange({ ...grant, minutes })}
          />
        )}
      </div>
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
          options={LADDER.map((x) => ({ value: x, tone: toneOf(x) }))}
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
        {v.type === 'remind' && (
          <Field label={t('intervention.remind.message')}>
            {(id) => (
              <input
                id={id}
                class="input"
                value={v.message ?? ''}
                maxLength={300}
                onInput={(e) => onChange({ ...v, message: (e.target as HTMLInputElement).value })}
              />
            )}
          </Field>
        )}
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
              <NumberInput
                value={v.maxMinutes}
                min={1}
                max={1440}
                label={t('ask.max')}
                suffix={t('common.minutesUnit')}
                onChange={(maxMinutes) => onChange({ ...v, maxMinutes })}
              />
            </div>
            <div class="row">
              <span>{t('ask.wait')}</span>
              <NumberInput
                value={v.seconds ?? 0}
                min={0}
                max={600}
                label={t('ask.wait')}
                suffix={t('common.secondsUnit')}
                onChange={(seconds) => onChange({ ...v, seconds })}
              />
            </div>
            <Toggle
              checked={Boolean(v.requireIntention)}
              onChange={(requireIntention) => onChange({ ...v, requireIntention })}
              label={t('ask.require')}
            />
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
                <NumberInput
                  value={v.cooldownMinutes}
                  min={1}
                  max={1440}
                  label={t('ask.cooldown')}
                  suffix={t('common.minutesUnit')}
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
              <NumberInput
                value={v.seconds}
                min={1}
                max={3600}
                label={t('delay.seconds')}
                suffix={t('common.secondsUnit')}
                onChange={(seconds) => onChange({ ...v, seconds })}
              />
              {advanced && (
                <>
                  <span>{t('delay.randomTo')}</span>
                  <NumberInput
                    value={v.randomTo ?? 0}
                    min={0}
                    max={3600}
                    label={t('delay.randomTo')}
                    suffix={t('common.secondsUnit')}
                    onChange={(randomTo) => onChange({ ...v, randomTo: randomTo || undefined })}
                  />
                </>
              )}
            </div>
            {advanced && (
              <div class="row">
                <span>{t('delay.increase')}</span>
                <NumberInput
                  value={v.increase ?? 0}
                  min={0}
                  max={600}
                  label={t('delay.increase')}
                  suffix={t('common.secondsUnit')}
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
  onChange,
  onMove,
  onRemove,
  advanced,
  open: initialOpen,
}: {
  policy: Policy;
  index: number;
  count: number;
  onChange: (p: Policy) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
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
        <Menu
          label={t('policy.actions', { n: index + 1 })}
          items={[
            { label: t('policy.edit'), icon: 'edit', onSelect: () => setOpen(true) },
            'separator',
            { label: t('policy.up'), icon: 'chevron-up', disabled: index === 0, onSelect: () => onMove(-1) },
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
      </div>
      {open && (
        <div class="policy-body">
          <div class="policy-block">
            <span class="kw">{t('policy.kw.when')}</span>
            <ScheduleEditor
              schedule={policy.schedule}
              onChange={(schedule) => onChange({ ...policy, schedule })}
            />
          </div>
          <div class="policy-block">
            <span class="kw">{t('policy.kw.limit')}</span>
            <div class="stack stack-sm">
              <BudgetEditor
                budget={policy.budget}
                advanced={advanced}
                onChange={(budget) => onChange({ ...policy, budget })}
              />
              <p class="help">{t('policy.budgetHelp')}</p>
            </div>
          </div>
          <div class="policy-block">
            <span class="kw">{t('policy.kw.then')}</span>
            <InterventionEditor
              value={policy.intervention}
              advanced={advanced}
              onChange={(intervention) => onChange({ ...policy, intervention })}
            />
          </div>
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
