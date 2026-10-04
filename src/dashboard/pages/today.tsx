/** Today (§8.4.2): current state, quick focus session, upcoming changes, today's numbers. */

import { t } from '../../i18n/i18n';
import { api } from '../../platform/api';
import { formatDateTime, formatDuration, formatWhen } from '../../shared/format';
import type { Overview, Warning } from '../../shared/models';
import { call } from '../../shared/rpc';
import { interventionName } from '../../shared/summary';
import { Banner, Button, ColorDot, Empty, Progress, Spinner, toast } from '../../ui/components';
import { budgetText } from '../../ui/explain';
import { useModel, useNow } from '../../ui/hooks';
import { Icon } from '../../ui/icons';
import { useDashboard } from '../context';
import { navigate } from '../router';
import { QuickSession } from './focus';

export function WarningBanner({ w }: { w: Warning }) {
  const actions: Partial<Record<Warning['kind'], { label: string; run: () => void }>> = {
    'host-permission': {
      label: t('warning.fix'),
      run: async () => {
        const ok = await api.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
        if (ok) await call('permissions.changed', {});
      },
    },
    incognito: { label: t('warning.howTo'), run: () => navigate('/protection') },
    'pending-ready': { label: t('warning.review'), run: () => navigate('/protection') },
    tamper: { label: t('warning.review'), run: () => navigate('/protection') },
    'dnr-error': { label: t('warning.diagnostics'), run: () => navigate('/settings/diagnostics') },
    'dnr-overflow': { label: t('warning.diagnostics'), run: () => navigate('/settings/diagnostics') },
  };
  const a = actions[w.kind];
  const kind = w.kind === 'pending-ready' || w.kind === 'incognito' ? 'info' : 'warning';
  return (
    <Banner
      kind={kind}
      action={
        a && (
          <Button size="small" onClick={a.run}>
            {a.label}
          </Button>
        )
      }
    >
      <span>
        {t(`warning.${w.kind}`, { detail: w.detail ?? '', when: w.at ? formatDateTime(w.at) : '' })}
      </span>
    </Banner>
  );
}

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 5
    ? t('today.hello.night')
    : h < 12
      ? t('today.hello.morning')
      : h < 18
        ? t('today.hello.afternoon')
        : t('today.hello.evening');
}

function NowCard({ o }: { o: Overview }) {
  const now = useNow(15_000);
  const groups = o.groups.filter((g) => g.enabled && !g.archived);
  return (
    <div class="card stack">
      <div class="card-head">
        <h2>{t('today.now')}</h2>
        <a href="#/groups" class="small">
          {t('today.allGroups')}
        </a>
      </div>
      {groups.length === 0 ? (
        <Empty icon="layers" title={t('today.noGroups')}>
          <Button variant="primary" onClick={() => navigate('/groups/new')}>
            {t('groups.new')}
          </Button>
        </Empty>
      ) : (
        <ul class="list compact">
          {groups.map((g) => {
            const budget = g.budgets.find((b) => !b.exhausted && b.type !== 'session');
            const type = g.intervention?.type;
            const restricted = type && !['track', 'allow', 'remind', 'filter'].includes(type);
            return (
              <li key={g.id} class="stack stack-sm">
                <div class="row between">
                  <a
                    href={`#/groups/${g.id}`}
                    class="row nowrap"
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    <ColorDot color={g.color} />
                    <strong>{g.name}</strong>
                  </a>
                  <span class="small text-2">
                    {g.pause
                      ? t('today.pausedUntil', { when: g.pause.until ? formatWhen(g.pause.until, now) : '…' })
                      : restricted
                        ? g.until
                          ? t('today.restrictedUntil', {
                              what: interventionName(type!),
                              when: formatWhen(g.until, now),
                            })
                          : interventionName(type!)
                        : g.nextChange
                          ? t('today.allowedUntil', { when: formatWhen(g.nextChange.at, now) })
                          : t('today.allowed')}
                  </span>
                </div>
                {budget && !restricted && (
                  <div class="stack" style={{ gap: '2px' }}>
                    <Progress
                      value={budget.used}
                      max={budget.limit}
                      label={budgetText(budget)}
                      tone={budget.remaining < 300 ? 'warning' : undefined}
                    />
                    <span class="tiny muted">{budgetText(budget)}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function TodayPage() {
  const { model } = useDashboard();
  const { data: o, reload } = useModel('overview.get', {}, [], 30_000);
  const now = useNow(30_000);
  if (!o) return <Spinner />;
  const level = t(`level.${o.level}`);
  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <h1>{greeting(now)}</h1>
          <p class="row">
            <Icon name="shield" />
            {t('today.protection', { level })}
            {o.lockedUntil && o.level === 'locked' && (
              <span class="tag">{t('today.lockedUntil', { when: formatDateTime(o.lockedUntil) })}</span>
            )}
          </p>
        </div>
      </div>
      {o.warnings.map((w) => (
        <WarningBanner key={w.kind} w={w} />
      ))}
      {o.restorable > 0 && (
        <Banner
          kind="ok"
          action={
            <Button
              size="small"
              onClick={async () => {
                const r = await call('tabs.reopenBlocked', {});
                toast(t('popup.reopened', { count: r.reopened }));
                void reload();
              }}
            >
              {t('today.reopen')}
            </Button>
          }
        >
          {t('today.restorable', { count: o.restorable })}
        </Banner>
      )}
      <div class="grid" style={{ ['--min' as string]: '320px' }}>
        <NowCard o={o} />
        <div class="card stack">
          <h2>{t('today.focus')}</h2>
          <QuickSession compact sessions={o.sessions} groups={model.config.groups} onChange={reload} />
        </div>
      </div>
      <div class="card stack">
        <h2>{t('today.upcoming')}</h2>
        {o.upcoming.length === 0 ? (
          <p class="muted">{t('today.noUpcoming')}</p>
        ) : (
          <ul class="list compact">
            {o.upcoming.map((u, i) => {
              const g = o.groups.find((x) => x.id === u.groupId);
              return (
                <li key={i} class="row">
                  <span class="num" style={{ minWidth: '90px' }}>
                    {formatWhen(u.at, now)}
                  </span>
                  {g && <ColorDot color={g.color} />}
                  <span>
                    {u.label === 'session-start'
                      ? t('today.sessionStarts')
                      : u.label === 'session-end'
                        ? t('today.sessionEnds')
                        : t(u.label === 'starts' ? 'today.changeStarts' : 'today.changeEnds', {
                            group: g?.name ?? '',
                            what: u.intervention ? interventionName(u.intervention.type) : '',
                          })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div class="grid tiles" style={{ ['--min' as string]: '200px' }}>
        <div class="card tile">
          <span class="value">{formatDuration(o.today.seconds)}</span>
          <span class="caption">{t('today.timeOnLimited')}</span>
        </div>
        <div class="card tile">
          <span class="value">{o.today.impulses}</span>
          <span class="caption">{t('today.impulses', { count: o.today.impulses })}</span>
        </div>
        <div class="card tile">
          <span class="value">{o.today.pauses}</span>
          <span class="caption">{t('today.pauses', { count: o.today.pauses })}</span>
        </div>
        <a class="card tile" href="#/protection" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span class="value">{o.pending.length}</span>
          <span class="caption">{t('today.pending', { count: o.pending.length })}</span>
        </a>
      </div>
      {o.pauses.length > 0 && (
        <div class="card stack">
          <h2>{t('today.activePauses')}</h2>
          {o.pauses.map((p) => (
            <div key={p.id} class="row between">
              <span>
                {p.until
                  ? t('popup.pausedUntil', { when: formatWhen(p.until, now) })
                  : t('popup.pausedLeft', { duration: formatDuration(p.remaining ?? 0) })}
              </span>
              <Button
                size="small"
                onClick={async () => {
                  await call('pause.cancel', { grantId: p.id });
                  void reload();
                }}
              >
                {t('popup.endPause')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
