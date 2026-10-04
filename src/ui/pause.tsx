/** Pause dialog (§8.4.7, BRK-02…BRK-06). The cost is shown before starting. */

import { useState } from 'preact/hooks';
import type { Cost, PauseScope } from '../engine/types';
import { t } from '../i18n/i18n';
import type { PauseOptions, TicketView } from '../shared/models';
import { call } from '../shared/rpc';
import { Banner, Button, Chips, Dialog, NumberInput, toast } from './components';
import { TicketDialog } from './ticket';

export function costLabel(c: Cost): string {
  switch (c.type) {
    case 'none':
      return t('cost.none');
    case 'confirm':
      return t('cost.confirm');
    case 'delay':
      return t('cost.delay', { seconds: c.seconds });
    case 'challenge':
      return c.kind === 'phrase'
        ? t('cost.phrase')
        : c.kind === 'math'
          ? t('cost.math')
          : t('cost.random', { length: c.length ?? 24 });
    case 'password':
      return t('cost.password');
  }
}

export function pauseBudgetLabel(o: PauseOptions): string | null {
  const parts: string[] = [];
  if (o.remainingCount !== null) parts.push(t('pause.left.count', { count: o.remainingCount }));
  if (o.remainingMinutes !== null)
    parts.push(t('pause.left.minutes', { minutes: Math.round(o.remainingMinutes) }));
  return parts.length ? parts.join(' · ') : null;
}

export function PauseDialog({
  options,
  url,
  onClose,
  onStarted,
}: {
  options: PauseOptions;
  url?: string;
  onClose: () => void;
  onStarted?: () => void;
}) {
  const [scope, setScope] = useState<PauseScope>(
    options.scopes.includes('site') ? 'site' : options.scopes[0],
  );
  const d = options.duration;
  const [minutes, setMinutes] = useState<number>(
    d.mode === 'choices' ? (d.choices?.[0] ?? d.minutes) : d.minutes,
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketView | null>(null);

  const start = async () => {
    setError(null);
    if (options.reasonMode === 'required' && !reason.trim()) {
      setError(t('ticket.error.reasonRequired'));
      return;
    }
    const r = await call('pause.start', {
      url: url ?? options.url ?? undefined,
      groupId: !url && options.groups.length === 1 ? options.groups[0].id : undefined,
      scope,
      minutes,
      incognito: options.incognito,
      reason: options.reasonMode === 'none' ? undefined : reason,
    });
    if (r.error) setError(t(r.error));
    else if (r.ticket) setTicket(r.ticket);
    else done();
  };
  const done = () => {
    toast(t('pause.started', { minutes }));
    onStarted?.();
    onClose();
  };

  if (ticket) {
    return (
      <TicketDialog ticket={ticket} title={t('pause.title')} onDone={done} onCancel={() => setTicket(null)} />
    );
  }
  const scopeLabel: Record<PauseScope, string> = {
    page: t('pause.scope.page'),
    site: options.site ? t('pause.scope.siteNamed', { site: options.site }) : t('pause.scope.site'),
    group:
      options.groups.length === 1
        ? t('pause.scope.groupNamed', { group: options.groups[0].name })
        : t('pause.scope.group'),
    all: t('pause.scope.all'),
  };
  const budget = pauseBudgetLabel(options);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('pause.title')}
      actions={
        <>
          <Button variant="primary" onClick={onClose}>
            {t('pause.cancel')}
          </Button>
          <Button onClick={start}>{t('pause.start')}</Button>
        </>
      }
    >
      <div class="stack">
        <div class="field">
          <span class="label">{t('pause.for')}</span>
          <Chips
            value={scope}
            onChange={setScope}
            label={t('pause.for')}
            options={options.scopes.map((s) => ({ value: s, label: scopeLabel[s] }))}
          />
        </div>
        <div class="field">
          <span class="label">{t('pause.duration')}</span>
          {d.mode === 'fixed' && <p>{t('common.minutes', { n: d.minutes })}</p>}
          {d.mode === 'choices' && (
            <Chips
              value={minutes}
              onChange={setMinutes}
              label={t('pause.duration')}
              options={(d.choices?.length ? d.choices : [d.minutes]).map((m) => ({
                value: m,
                label: t('common.minutes', { n: m }),
              }))}
            />
          )}
          {d.mode === 'upTo' && (
            <div class="row">
              <NumberInput
                value={minutes}
                onChange={setMinutes}
                min={1}
                max={d.minutes}
                label={t('pause.duration')}
                suffix={t('common.minutesUnit')}
              />
              <span class="help">{t('pause.max', { minutes: d.minutes })}</span>
            </div>
          )}
          {options.metered && <span class="help">{t('pause.metered')}</span>}
        </div>
        {options.reasonMode !== 'none' && (
          <div class="field">
            <label for="pause-reason">
              {options.reasonMode === 'required' ? t('pause.reasonRequired') : t('pause.reasonOptional')}
            </label>
            <input
              id="pause-reason"
              class="input"
              value={reason}
              maxLength={300}
              onInput={(e) => setReason((e.target as HTMLInputElement).value)}
            />
          </div>
        )}
        <p class="small">
          <strong>{t('pause.cost')}:</strong> {costLabel(options.cost)}
          {budget && <> · {budget}</>}
        </p>
        {error && <Banner kind="danger">{error}</Banner>}
      </div>
    </Dialog>
  );
}
