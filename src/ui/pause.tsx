/** Pause dialog. The cost is shown before starting. */

import { useState } from 'preact/hooks';
import type { Cost, PauseScope, Period } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatDuration, formatList } from '../shared/format';
import type { PauseOptions, TicketView } from '../shared/models';
import { call } from '../shared/rpc';
import { Banner, Button, Chips, Dialog, DurationInput, toast } from './components';
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

/** Every cost to pay, e.g. "Wait 30 s + Type a code". */
export function costsLabel(costs: Cost[]): string {
  return costs.length ? costs.map(costLabel).join(' + ') : t('cost.none');
}

/** "today", "this week"…: the period that the breaks left belong to. */
function periodLeft(p: Period | null): string {
  switch (p?.kind) {
    case 'hour':
      return t('pause.period.hour');
    case 'day':
      return t('pause.period.day');
    case 'week':
      return t('pause.period.week');
    case 'month':
      return t('pause.period.month');
    default:
      return t('pause.period.other');
  }
}

/** The breaks still available, with their period: "3 breaks left today, 30 min in total". */
export function pauseBudgetLabel(o: PauseOptions): string | null {
  const count = o.remainingCount;
  const minutes = o.remainingMinutes === null ? null : Math.round(o.remainingMinutes);
  if (count !== null && minutes !== null && JSON.stringify(o.countPeriod) === JSON.stringify(o.minutesPeriod))
    return t('pause.left.both', { count, minutes, period: periodLeft(o.countPeriod) });
  const parts: string[] = [];
  if (count !== null) parts.push(t('pause.left.count', { count, period: periodLeft(o.countPeriod) }));
  if (minutes !== null) parts.push(t('pause.left.minutes', { minutes, period: periodLeft(o.minutesPeriod) }));
  return parts.length ? parts.join(' · ') : null;
}

/** The line next to "Take a break": what a break costs and how many are left. */
export function pauseSummary(o: PauseOptions): string {
  const cost = o.costs.length
    ? t('pause.summary.cost', { cost: costsLabel(o.costs) })
    : t('pause.summary.free');
  // Extending: how much longer the break can last.
  const more = o.extend ? t('pause.summary.more', { minutes: o.duration.minutes }) : null;
  return [cost, more, pauseBudgetLabel(o)].filter(Boolean).join(' · ');
}

/** What a break covers: "youtube.com · Social", "Social", "All rules". */
export function breakSubject(
  b: { groups: string[] | '*'; scope: PauseScope; site?: string; url?: string },
  nameOf: (id: string) => string | undefined,
): string {
  if (b.groups === '*' || b.groups.includes('*')) return t('pause.subject.all');
  const rules = formatList(b.groups.map((id) => nameOf(id) || t('insights.deletedGroup')));
  if (b.scope === 'page' && b.url)
    return t('pause.subject.page', { page: b.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''), rules });
  if (b.scope === 'site' && b.site) return t('pause.subject.site', { site: b.site, rules });
  return rules;
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
  // A break already running is extended: it keeps what it covers.
  const extend = options.extend;
  const [scope, setScope] = useState<PauseScope>(
    extend?.scope ?? (options.scopes.includes('site') ? 'site' : options.scopes[0]),
  );
  // A pause of everything has its own rules (the strictest of every group).
  const o = scope === 'all' && options.all ? options.all : options;
  const d = o.duration;
  const [chosen, setMinutes] = useState<number>(
    d.mode === 'choices' ? (d.choices?.[0] ?? d.minutes) : d.minutes,
  );
  const minutes = Math.min(chosen, d.minutes);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const title = extend ? t('pause.extend') : t('pause.title');

  const start = async () => {
    setError(null);
    if (o.reasonMode === 'required' && !reason.trim()) {
      setError(t('ticket.error.reasonRequired'));
      return;
    }
    const r = await call('pause.start', {
      url: url ?? options.url ?? undefined,
      groupId: !url && options.groups.length === 1 ? options.groups[0].id : undefined,
      scope,
      minutes,
      incognito: options.incognito,
      reason: o.reasonMode === 'none' ? undefined : reason,
      extend: extend?.grantId,
    });
    if (r.error) setError(t(r.error));
    else if (r.ticket) setTicket(r.ticket);
    else done();
  };
  const done = () => {
    toast(extend ? t('pause.extended', { minutes }) : t('pause.started', { minutes }));
    onStarted?.();
    onClose();
  };

  if (ticket) {
    return <TicketDialog ticket={ticket} title={title} onDone={done} onCancel={() => setTicket(null)} />;
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
  const budget = pauseBudgetLabel(o);
  const durationLabel = extend ? t('pause.extendBy') : t('pause.duration');
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      actions={
        <>
          <Button variant="primary" onClick={onClose}>
            {t('pause.cancel')}
          </Button>
          <Button onClick={start}>{extend ? t('pause.extend') : t('pause.start')}</Button>
        </>
      }
    >
      <div class="stack">
        {extend ? (
          <p>{t('pause.extendHelp', { scope: scopeLabel[extend.scope], minutes: extend.minutes })}</p>
        ) : (
          <div class="field">
            <span class="label">{t('pause.for')}</span>
            <Chips
              value={scope}
              onChange={setScope}
              label={t('pause.for')}
              options={options.scopes.map((s) => ({ value: s, label: scopeLabel[s] }))}
            />
          </div>
        )}
        <div class="field">
          <span class="label">{durationLabel}</span>
          {d.mode === 'fixed' && <p>{t('common.minutes', { n: d.minutes })}</p>}
          {d.mode === 'choices' && (
            <Chips
              value={minutes}
              onChange={setMinutes}
              label={durationLabel}
              options={(d.choices?.length ? d.choices : [d.minutes]).map((m) => ({
                value: m,
                label: t('common.minutes', { n: m }),
              }))}
            />
          )}
          {d.mode === 'upTo' && (
            <div class="row">
              <DurationInput
                units={['minutes', 'hours']}
                value={minutes}
                onChange={setMinutes}
                min={1}
                max={d.minutes}
                label={durationLabel}
              />
              <span class="help">{t('pause.max', { duration: formatDuration(d.minutes * 60) })}</span>
            </div>
          )}
          {o.metered && <span class="help">{t('pause.metered')}</span>}
        </div>
        {o.reasonMode !== 'none' && (
          <div class="field">
            <label for="pause-reason">
              {o.reasonMode === 'required' ? t('pause.reasonRequired') : t('pause.reasonOptional')}
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
          <strong>{t('pause.cost')}:</strong> {costsLabel(o.costs)}
          {budget && <> · {budget}</>}
        </p>
        {error && <Banner kind="danger">{error}</Banner>}
      </div>
    </Dialog>
  );
}
