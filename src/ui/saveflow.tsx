/**
 * Presents the outcome of a configuration change (PRO-02, PRO-03): applied at once, waiting for a
 * cost, queued for cooling-off, or refused while locked — always with a plain explanation (§8.5).
 */

import { useState } from 'preact/hooks';
import { t } from '../i18n/i18n';
import { formatDateTime, formatDuration } from '../shared/format';
import type { SaveResult, TicketView } from '../shared/models';
import { describeUnit } from '../shared/summary';
import { Banner, Button, Dialog, toast } from './components';
import { TicketDialog } from './ticket';

export function useSaveFlow() {
  const [ticket, setTicket] = useState<{ view: TicketView; title: string } | null>(null);
  const [info, setInfo] = useState<SaveResult | null>(null);
  const [resolve, setResolve] = useState<((ok: boolean) => void) | null>(null);

  /** Runs a save and handles its outcome. Resolves to true when everything was applied. */
  const run = async (p: Promise<SaveResult>): Promise<boolean> => {
    const r = await p;
    if (r.errors?.length) toast(r.errors.slice(0, 3).join(' · '));
    if (r.applied.length && !r.ticket && !r.pending && !r.refused) {
      toast(
        r.applied.length === 1 ? describeUnit(r.applied[0]) : t('save.applied', { count: r.applied.length }),
      );
      return true;
    }
    if (!r.applied.length && !r.ticket && !r.pending && !r.refused) {
      if (!r.errors?.length) toast(t('save.nothing'));
      return true;
    }
    return new Promise<boolean>((res) => {
      setResolve(() => res);
      if (r.ticket) setTicket({ view: r.ticket, title: t('save.costTitle') });
      if (r.pending || r.refused || r.applied.length) setInfo(r);
    });
  };

  const finish = (ok: boolean) => {
    resolve?.(ok);
    setResolve(null);
  };

  const element = (
    <>
      {ticket && (
        <TicketDialog
          ticket={ticket.view}
          title={ticket.title}
          intro={<p>{t('save.costIntro')}</p>}
          onDone={() => {
            setTicket(null);
            toast(t('save.appliedAfterCost'));
            if (!info) finish(true);
          }}
          onCancel={() => {
            setTicket(null);
            toast(t('save.kept'));
            if (!info) finish(false);
          }}
        />
      )}
      {info && !ticket && (
        <Dialog
          open
          onClose={() => {
            setInfo(null);
            finish(!info.pending && !info.refused);
          }}
          title={info.refused && !info.pending ? t('save.refusedTitle') : t('save.resultTitle')}
          actions={
            <Button
              variant="primary"
              onClick={() => {
                setInfo(null);
                finish(!info.pending && !info.refused);
              }}
            >
              {t('common.ok')}
            </Button>
          }
        >
          <div class="stack">
            {info.applied.length > 0 && (
              <Banner kind="ok">
                <strong>{t('save.appliedNow', { count: info.applied.length })}</strong>
                <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
                  {info.applied.slice(0, 8).map((u, i) => (
                    <li key={i}>{describeUnit(u)}</li>
                  ))}
                </ul>
              </Banner>
            )}
            {info.pending && (
              <Banner kind="info" icon="hourglass">
                <strong>{t('save.pendingTitle')}</strong>
                <span>
                  {t('save.pendingBody', {
                    wait: formatDuration((info.pending.readyAt - info.pending.createdAt) / 1000),
                    when: formatDateTime(info.pending.readyAt),
                  })}
                </span>
                <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
                  {info.pending.units.slice(0, 8).map((u, i) => (
                    <li key={i}>{describeUnit(u)}</li>
                  ))}
                </ul>
              </Banner>
            )}
            {info.refused && (
              <Banner kind="warning" icon="lock">
                <strong>
                  {info.refused.reason === 'locked' && info.refused.until
                    ? t('save.refused.lockedUntil', { until: formatDateTime(info.refused.until) })
                    : t(`save.refused.${info.refused.reason}`)}
                </strong>
                <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
                  {info.refused.units.slice(0, 8).map((u, i) => (
                    <li key={i}>{describeUnit(u)}</li>
                  ))}
                </ul>
                <span class="small">{t('save.refusedHelp')}</span>
              </Banner>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
  return { run, element };
}
