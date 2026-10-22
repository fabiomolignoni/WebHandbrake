/** Pause dialog. The cost is shown before starting. */

import { useState } from 'preact/hooks';
import type { Cost, PauseScope, Period } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatDuration, formatList } from '../shared/format';
import type { PauseOptions, TicketView } from '../shared/models';
import { call } from '../shared/rpc';
import { Banner, Button, Dialog, toast } from './components';
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
  return [cost, pauseBudgetLabel(o)].filter(Boolean).join(' · ');
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

/**
 * Taking a break: it covers the rules of the page whole, lasts the longest they allow and can be
 * ended before (popup, Today).
 */
export function PauseDialog({
  options: o,
  url,
  onClose,
  onStarted,
}: {
  options: PauseOptions;
  url?: string;
  onClose: () => void;
  onStarted?: () => void;
}) {
  // A break lasts as long as it can; it is ended sooner from the popup or Today.
  const minutes = o.maxMinutes;
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const title = t('pause.title');

  const start = async () => {
    setError(null);
    const r = await call('pause.start', {
      url: url ?? o.url ?? undefined,
      groupId: !url && o.groups.length === 1 ? o.groups[0].id : undefined,
      minutes,
      incognito: o.incognito,
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
    return <TicketDialog ticket={ticket} title={title} onDone={done} onCancel={() => setTicket(null)} />;
  }
  const budget = pauseBudgetLabel(o);
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
          <Button onClick={start}>{t('pause.start')}</Button>
        </>
      }
    >
      <div class="stack">
        <p>
          {t('pause.covers', {
            rules: formatList(o.groups.map((g) => g.name)),
            duration: formatDuration(minutes * 60),
          })}
        </p>
        <p class="small">
          <strong>{t('pause.cost')}:</strong> {costsLabel(o.costs)}
          {budget && <> · {budget}</>}
        </p>
        {error && <Banner kind="danger">{error}</Banner>}
      </div>
    </Dialog>
  );
}
