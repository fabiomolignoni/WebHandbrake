/**
 * The breaks of a rule, under what happens: whether they are allowed, how long one can last, what
 * it costs and how many; whether they are allowed during focus sessions is an advanced option. A
 * break covers the whole rule and can be ended before its time is up.
 */

import { useId } from 'preact/hooks';
import type { Cost, PausePolicy } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { formatDuration } from '../../shared/format';
import { DurationInput, NumberInput, Select, Toggle } from '../../ui/components';
import { costLabel } from '../../ui/pause';
import { pauseAdvanced } from '../rule-form';
import { AdvancedOptions } from './advanced';
import { PeriodSelect } from './policy';

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
}: {
  value: PausePolicy;
  onChange: (p: PausePolicy) => void;
  /** A break can cost the rule's password only when the rule has one. */
  hasPassword: boolean;
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
              <span class="label" aria-hidden="true">
                {t('pauseRules.minutes')}
              </span>
              <DurationInput
                units={['minutes', 'hours']}
                value={p.maxMinutes}
                min={1}
                max={1440}
                label={t('pauseRules.minutes')}
                describedBy={`${id}-duration-help`}
                onChange={(maxMinutes) => set({ maxMinutes })}
              />
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
                  suffix={t('challenge.chars')}
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
            <div class="row">
              <label class="check small">
                <input
                  type="checkbox"
                  checked={p.limit.count !== undefined}
                  onChange={(e) =>
                    set({
                      limit: { ...p.limit, count: (e.target as HTMLInputElement).checked ? 3 : undefined },
                    })
                  }
                />
                {t('pauseRules.limitCount')}
              </label>
              {p.limit.count !== undefined && (
                <NumberInput
                  value={p.limit.count}
                  min={0}
                  max={100}
                  label={t('pauseRules.limitCount')}
                  onChange={(count) => set({ limit: { ...p.limit, count } })}
                />
              )}
            </div>
            <div class="row">
              <label class="check small">
                <input
                  type="checkbox"
                  checked={p.limit.minutes !== undefined}
                  onChange={(e) =>
                    set({
                      limit: { ...p.limit, minutes: (e.target as HTMLInputElement).checked ? 30 : undefined },
                    })
                  }
                />
                {t('pauseRules.limitMinutes')}
              </label>
              {p.limit.minutes !== undefined && (
                <DurationInput
                  units={['minutes', 'hours']}
                  value={p.limit.minutes}
                  min={0}
                  max={10000}
                  label={t('pauseRules.limitMinutes')}
                  onChange={(minutes) => set({ limit: { ...p.limit, minutes } })}
                />
              )}
            </div>
            {(p.limit.count !== undefined || p.limit.minutes !== undefined) && (
              <PeriodSelect
                period={p.limit.period}
                onChange={(period) => set({ limit: { ...p.limit, period } })}
                allowRolling={false}
              />
            )}
          </div>
          <AdvancedOptions open={pauseAdvanced(p)}>
            <Toggle
              checked={p.duringSessions}
              onChange={(duringSessions) => set({ duringSessions })}
              label={t('pauseRules.duringSessions')}
            />
          </AdvancedOptions>
        </>
      )}
    </div>
  );
}
