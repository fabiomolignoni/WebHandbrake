/** Pause rules of a group (BRK-01…BRK-08). */

import type { Cost, PausePolicy, PauseScope } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { Field, NumberInput, Select, Toggle } from '../../ui/components';
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

export function PauseEditor({
  value,
  onChange,
  hasPassword,
}: {
  value: PausePolicy;
  onChange: (p: PausePolicy) => void;
  hasPassword: boolean;
}) {
  const p = value;
  const set = (patch: Partial<PausePolicy>) => onChange({ ...p, ...patch });
  const toggleScope = (s: PauseScope) =>
    set({ scopes: p.scopes.includes(s) ? p.scopes.filter((x) => x !== s) : [...p.scopes, s] });
  return (
    <div class="stack">
      <Toggle
        checked={p.allowed}
        onChange={(allowed) => set({ allowed })}
        label={t('pauseRules.allowed')}
        help={t('pauseRules.allowedHelp')}
      />
      {p.allowed && (
        <>
          <Toggle
            checked={p.duringSessions}
            onChange={(duringSessions) => set({ duringSessions })}
            label={t('pauseRules.duringSessions')}
          />
          <fieldset class="stack stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend class="label small">{t('pauseRules.scopes')}</legend>
            <div class="row">
              {(['page', 'site', 'group', 'all'] as PauseScope[]).map((s) => (
                <label key={s} class="check small">
                  <input type="checkbox" checked={p.scopes.includes(s)} onChange={() => toggleScope(s)} />
                  {t(`pause.scope.${s}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div class="stack stack-sm">
            <span class="label small">{t('pauseRules.duration')}</span>
            <div class="row">
              <Select<PausePolicy['duration']['mode']>
                value={p.duration.mode}
                label={t('pauseRules.durationMode')}
                onChange={(mode) =>
                  set({
                    duration: {
                      ...p.duration,
                      mode,
                      ...(mode === 'choices' && !p.duration.choices?.length ? { choices: [5, 10, 15] } : {}),
                    },
                  })
                }
                options={[
                  { value: 'fixed', label: t('pauseRules.mode.fixed') },
                  { value: 'upTo', label: t('pauseRules.mode.upTo') },
                  { value: 'choices', label: t('pauseRules.mode.choices') },
                ]}
              />
              {p.duration.mode === 'choices' ? (
                <input
                  class="input inline mono"
                  style={{ width: '10em' }}
                  aria-label={t('pauseRules.choices')}
                  value={(p.duration.choices ?? []).join(', ')}
                  onChange={(e) => {
                    const choices = (e.target as HTMLInputElement).value
                      .split(/[,\s]+/)
                      .map(Number)
                      .filter((n) => n > 0 && n <= 1440)
                      .slice(0, 6);
                    if (choices.length)
                      set({ duration: { ...p.duration, choices, minutes: Math.max(...choices) } });
                  }}
                />
              ) : (
                <NumberInput
                  value={p.duration.minutes}
                  min={1}
                  max={1440}
                  label={t('pauseRules.minutes')}
                  suffix={t('common.minutesUnit')}
                  onChange={(minutes) => set({ duration: { ...p.duration, minutes } })}
                />
              )}
            </div>
          </div>
          <div class="stack stack-sm">
            <span class="label small">{t('pauseRules.limit')}</span>
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
                <NumberInput
                  value={p.limit.minutes}
                  min={0}
                  max={10000}
                  label={t('pauseRules.limitMinutes')}
                  suffix={t('common.minutesUnit')}
                  onChange={(minutes) => set({ limit: { ...p.limit, minutes } })}
                />
              )}
            </div>
            <PeriodSelect
              period={p.limit.period}
              onChange={(period) => set({ limit: { ...p.limit, period } })}
              allowRolling={false}
            />
          </div>
          <Field
            label={t('pauseRules.cost')}
            help={
              costKind(p.cost) === 'password' && !hasPassword
                ? t('pauseRules.noPassword')
                : t('pauseRules.costHelp')
            }
          >
            {(id, d) => (
              <div class="row">
                <Select<CostKind>
                  id={id}
                  describedBy={d}
                  value={costKind(p.cost)}
                  onChange={(k) => set({ cost: costFrom(k, p.cost) })}
                  options={(
                    ['none', 'confirm', 'delay', 'random', 'phrase', 'math', 'password'] as CostKind[]
                  ).map((k) => ({ value: k, label: t(`pauseRules.costKind.${k}`) }))}
                />
                {p.cost.type === 'delay' && (
                  <NumberInput
                    value={p.cost.seconds}
                    min={1}
                    max={3600}
                    label={t('delay.seconds')}
                    suffix={t('common.secondsUnit')}
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
            )}
          </Field>
          <Field label={t('pauseRules.reason')}>
            {(id) => (
              <Select<PausePolicy['reason']>
                id={id}
                value={p.reason}
                onChange={(reason) => set({ reason })}
                options={[
                  { value: 'none', label: t('pauseRules.reason.none') },
                  { value: 'optional', label: t('pauseRules.reason.optional') },
                  { value: 'required', label: t('pauseRules.reason.required') },
                ]}
              />
            )}
          </Field>
          <Toggle
            checked={p.metered}
            onChange={(metered) => set({ metered })}
            label={t('pauseRules.metered')}
            help={t('pauseRules.meteredHelp')}
          />
        </>
      )}
    </div>
  );
}
