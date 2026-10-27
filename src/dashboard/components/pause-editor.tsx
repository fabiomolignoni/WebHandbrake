/**
 * The breaks of a rule, under what happens: whether they are allowed, how long one can last, what
 * one has to do to take one and how many. A break covers the whole rule and can be ended before its
 * time is up.
 */

import { useId } from 'preact/hooks';
import type { Cost, PausePolicy, Period } from '../../engine/types';
import { parts, t } from '../../i18n/i18n';
import { formatDuration } from '../../shared/format';
import { DurationInput, Fields, NumberInput, Select, Toggle } from '../../ui/components';
import { costLabel } from '../../ui/pause';
import { PeriodPicker } from './period-picker';

type CostKind = 'none' | 'confirm' | 'delay' | 'random' | 'phrase' | 'math' | 'password';

function costKind(c: Cost): CostKind {
  if (c.type === 'challenge') return c.kind;
  return c.type;
}

function costFrom(kind: CostKind, prev: Cost): Cost {
  switch (kind) {
    case 'none':
    case 'confirm':
    case 'password':
      return { type: kind };
    case 'delay':
      return { type: 'delay', seconds: prev.type === 'delay' ? prev.seconds : 30 };
    case 'random':
      return {
        type: 'challenge',
        kind: 'random',
        length: prev.type === 'challenge' && prev.length ? prev.length : 24,
      };
    case 'phrase':
      return {
        type: 'challenge',
        kind: 'phrase',
        phrase: prev.type === 'challenge' ? (prev.phrase ?? '') : '',
      };
    case 'math':
      return { type: 'challenge', kind: 'math' };
  }
}

/** The breaks of a rule in a line: "Breaks: up to 15 min each. Cost: a 30 s wait." */
export function pauseRulesSummary(p: PausePolicy): string {
  if (!p.allowed) return t('pauseRules.summary.off');
  const duration = formatDuration(p.maxMinutes * 60);
  return p.cost.type === 'none'
    ? t('pauseRules.summary.free', { duration })
    : t('pauseRules.summary.on', { duration, cost: costLabel(p.cost) });
}

export function PauseEditor({
  value,
  onChange,
  hasPassword,
  saved,
}: {
  value: PausePolicy;
  onChange: (p: PausePolicy) => void;
  /** A break can cost the rule's password only when the rule has one. */
  hasPassword: boolean;
  /** The breaks as saved, for a rule that exists. */
  saved?: PausePolicy;
}) {
  const p = value;
  const id = useId();
  // Without a password, a break that costs one asks for random characters instead.
  const noPassword = costKind(p.cost) === 'password' && !hasPassword;
  const set = (patch: Partial<PausePolicy>) => onChange({ ...p, ...patch });
  return (
    <div class="stack stack-lg">
      <Toggle
        checked={p.allowed}
        onChange={(allowed) => set({ allowed })}
        label={t('pauseRules.allowed')}
        help={t('pauseRules.allowedHelp')}
      />
      {p.allowed && (
        <>
          <div class="question">
            <h3>{t('pauseRules.q.duration')}</h3>
            <div class="row">
              <Fields>
                {parts('pauseRules.minutesFields', {
                  duration: (
                    <DurationInput
                      units={['minutes', 'hours']}
                      value={p.maxMinutes}
                      min={1}
                      max={1440}
                      label={t('pauseRules.minutes')}
                      describedBy={`${id}-duration-help`}
                      onChange={(maxMinutes) => set({ maxMinutes })}
                    />
                  ),
                })}
              </Fields>
            </div>
            <span class="help" id={`${id}-duration-help`}>
              {t('pauseRules.durationHelp')}
            </span>
          </div>
          <div class="question">
            <h3 id={`${id}-cost`}>{t('pauseRules.q.cost')}</h3>
            <div class="row">
              <Select<CostKind>
                label={t('pauseRules.q.cost')}
                describedBy={noPassword ? `${id}-cost-help` : undefined}
                value={costKind(p.cost)}
                onChange={(k) => set({ cost: costFrom(k, p.cost) })}
                options={(['none', 'confirm', 'delay', 'random', 'phrase', 'math', 'password'] as CostKind[])
                  .filter((k) => k !== 'password' || hasPassword || costKind(p.cost) === 'password')
                  .map((k) => ({ value: k, label: t(`pauseRules.costKind.${k}`) }))}
              />
              {p.cost.type === 'delay' && (
                <DurationInput
                  base="seconds"
                  units={['seconds', 'minutes']}
                  value={p.cost.seconds}
                  min={1}
                  max={3600}
                  label={t('delay.seconds')}
                  onChange={(seconds) => set({ cost: { type: 'delay', seconds } })}
                />
              )}
              {p.cost.type === 'challenge' && p.cost.kind === 'random' && (
                <NumberInput
                  value={p.cost.length ?? 24}
                  min={4}
                  max={500}
                  label={t('challenge.length')}
                  suffix={t('challenge.chars', { n: p.cost.length ?? 24 })}
                  onChange={(length) => set({ cost: { type: 'challenge', kind: 'random', length } })}
                />
              )}
              {p.cost.type === 'challenge' && p.cost.kind === 'phrase' && (
                <input
                  class="input"
                  style={{ minWidth: '16em' }}
                  aria-label={t('challenge.phrase')}
                  value={p.cost.phrase ?? ''}
                  onInput={(e) =>
                    set({
                      cost: {
                        type: 'challenge',
                        kind: 'phrase',
                        phrase: (e.target as HTMLInputElement).value,
                      },
                    })
                  }
                />
              )}
            </div>
            {noPassword && (
              <span class="help" id={`${id}-cost-help`}>
                {t('pauseRules.noPassword')}
              </span>
            )}
          </div>
          <div class="question">
            <h3>{t('pauseRules.q.limit')}</h3>
            <BreakLimits
              value={p.limit}
              onChange={(limit) => set({ limit })}
              defaults={{ count: 3, minutes: 30 }}
              savedPeriod={saved?.limit.period}
            />
          </div>
        </>
      )}
    </div>
  );
}

type BreakLimit = PausePolicy['limit'];

/**
 * How many breaks, and how much time in breaks, at most (each one optional), and how often these
 * limits start again. For the breaks of a rule and for those of all the rules together.
 */
export function BreakLimits({
  value: limit,
  onChange,
  defaults,
  commitOnBlur,
  savedPeriod,
}: {
  value: BreakLimit;
  onChange: (l: BreakLimit) => void;
  /** What a limit starts from when it is turned on. */
  defaults: { count: number; minutes: number };
  commitOnBlur?: boolean;
  /** How often the limits start again, as saved. */
  savedPeriod?: Period;
}) {
  return (
    <div class="stack stack-sm">
      <div class="row">
        <label class="check small">
          <input
            type="checkbox"
            checked={limit.count !== undefined}
            onChange={(e) =>
              onChange({
                ...limit,
                count: (e.target as HTMLInputElement).checked ? defaults.count : undefined,
              })
            }
          />
          {t('pauseRules.limitCount')}
        </label>
        {limit.count !== undefined && (
          <NumberInput
            commitOnBlur={commitOnBlur}
            value={limit.count}
            min={0}
            max={100}
            label={t('pauseRules.limitCount')}
            onChange={(count) => onChange({ ...limit, count })}
          />
        )}
      </div>
      <div class="row">
        <label class="check small">
          <input
            type="checkbox"
            checked={limit.minutes !== undefined}
            onChange={(e) =>
              onChange({
                ...limit,
                minutes: (e.target as HTMLInputElement).checked ? defaults.minutes : undefined,
              })
            }
          />
          {t('pauseRules.limitMinutes')}
        </label>
        {limit.minutes !== undefined && (
          <DurationInput
            units={['minutes', 'hours']}
            commitOnBlur={commitOnBlur}
            value={limit.minutes}
            min={0}
            max={10000}
            label={t('pauseRules.limitMinutes')}
            onChange={(minutes) => onChange({ ...limit, minutes })}
          />
        )}
      </div>
      {(limit.count !== undefined || limit.minutes !== undefined) && (
        <PeriodPicker
          small
          commitOnBlur={commitOnBlur}
          period={limit.period}
          saved={savedPeriod}
          onChange={(period) => onChange({ ...limit, period })}
        />
      )}
    </div>
  );
}
