/**
 * Today (docs/design.md): status first — what is happening now, what comes next,
 * a focus session in one tap and today's numbers. Real problems are banners; setup steps are a
 * quiet card.
 */

import { t } from '../../i18n/i18n';
import { api } from '../../platform/api';
import { formatDate, formatDateTime, formatDuration, formatWhen } from '../../shared/format';
import type { GroupStatus, Overview, UpcomingChange, Warning } from '../../shared/models';
import { call } from '../../shared/rpc';
import { describeIntervention } from '../../shared/summary';
import { Banner, Button, Empty, GroupTile, Progress, Spinner, StatusPill, toast } from '../../ui/components';
import { budgetText } from '../../ui/explain';
import { useModel, useNow } from '../../ui/hooks';
import { Icon } from '../../ui/icons';
import { groupStatus, interventionIcon, toneOf } from '../../ui/status';
import { useDashboard } from '../context';
import { navigate } from '../router';
import { QuickSession } from './focus';
import { levelIcon } from './group-editor';

/** Setup steps rather than problems: shown as a quiet card, not as an alert. */
const SETUP_WARNINGS: Warning['kind'][] = ['incognito'];

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

function GroupRow({ g, now }: { g: GroupStatus; now: number }) {
  const s = groupStatus(g, now);
  const budget = g.budgets.find((b) => !b.exhausted && b.type !== 'session');
  const restricted = s.tone === 'protected' || s.tone === 'friction';
  return (
    <div class="group-status">
      <GroupTile color={g.color} icon={g.icon} size={36} />
      <div class="stack stack-xs" style={{ minWidth: 0 }}>
        <a class="name ellipsis" href={`#/groups/${g.id}`}>
          {g.name}
        </a>
        {g.nextChange && (
          <span class="tiny muted">
            {t('today.next', {
              when: formatWhen(g.nextChange.at, now),
              what: describeIntervention(g.nextChange.intervention),
            })}
          </span>
        )}
      </div>
      <StatusPill tone={s.tone} icon={s.icon}>
        {s.label}
      </StatusPill>
      {budget && !restricted && (
        <div class={`detail stack stack-xs tone-${s.tone}`}>
          <Progress value={budget.used} max={budget.limit} label={budgetText(budget)} />
          <span class="tiny text-2">
            {budgetText(budget)}
            {budget.type !== 'visits' &&
              ` · ${t('today.left', { duration: formatDuration(budget.remaining) })}`}
          </span>
        </div>
      )}
    </div>
  );
}

function upcomingText(u: UpcomingChange, o: Overview) {
  const g = o.groups.find((x) => x.id === u.groupId);
  if (u.label === 'session-start') return t('today.sessionStarts');
  if (u.label === 'session-end') return t('today.sessionEnds');
  return t(u.label === 'starts' ? 'today.changeStarts' : 'today.changeEnds', {
    group: g?.name ?? '',
    what: u.intervention ? describeIntervention(u.intervention) : '',
  });
}

function Timeline({ o, now }: { o: Overview; now: number }) {
  if (!o.upcoming.length) return <p class="muted small">{t('today.noUpcoming')}</p>;
  return (
    <ol class="timeline">
      {o.upcoming.map((u, i) => {
        const g = o.groups.find((x) => x.id === u.groupId);
        const icon = u.label.startsWith('session')
          ? 'target'
          : u.intervention && u.label === 'starts'
            ? interventionIcon(u.intervention.type)
            : 'check-circle';
        const tone = u.label.startsWith('session')
          ? 'protected'
          : u.intervention && u.label === 'starts'
            ? toneOf(u.intervention.type)
            : 'free';
        return (
          <li key={i}>
            <span class="when">{formatWhen(u.at, now)}</span>
            <span class="mark" style={g ? { background: g.color } : undefined} aria-hidden="true" />
            <span class={`row nowrap tone-${tone}`} style={{ gap: '6px', alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--tone)', display: 'inline-flex', marginTop: '3px' }}>
                <Icon name={icon} />
              </span>
              <span>{upcomingText(u, o)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Numbers({ o }: { o: Overview }) {
  const rows: { value: string; zero: boolean; caption: string; href?: string }[] = [
    {
      value: formatDuration(o.today.seconds),
      zero: o.today.seconds === 0,
      caption: t('today.timeOnLimited'),
    },
    {
      value: String(o.today.impulses),
      zero: !o.today.impulses,
      caption: t('today.impulses', { count: o.today.impulses }),
    },
    {
      value: String(o.today.pauses),
      zero: !o.today.pauses,
      caption: t('today.pauses', { count: o.today.pauses }),
    },
  ];
  if (o.pending.length)
    rows.push({
      value: String(o.pending.length),
      zero: false,
      caption: t('today.pending', { count: o.pending.length }),
      href: '#/protection',
    });
  if (o.laterCount)
    rows.push({
      value: String(o.laterCount),
      zero: false,
      caption: t('today.later', { count: o.laterCount }),
      href: '#/later',
    });
  return (
    <div class="kpi-list">
      {rows.map((r) =>
        r.href ? (
          <a key={r.caption} href={r.href}>
            <span class="caption">{r.caption}</span>
            <span class="value">{r.value}</span>
          </a>
        ) : (
          <div key={r.caption}>
            <span class="caption">{r.caption}</span>
            <span class={`value${r.zero ? ' zero' : ''}`}>{r.value}</span>
          </div>
        ),
      )}
    </div>
  );
}

export function TodayPage() {
  const { model } = useDashboard();
  const { data: o, reload } = useModel('overview.get', {}, [], 30_000);
  const now = useNow(30_000);
  if (!o) return <Spinner />;
  const groups = o.groups.filter((g) => g.enabled && !g.archived);
  const statuses = groups.map((g) => groupStatus(g, now));
  const restricted = statuses.filter((s) => s.tone === 'protected' || s.tone === 'friction').length;
  const summary = [
    t('today.summary.groups', { count: groups.length }),
    groups.length ? t('today.summary.restricted', { count: restricted }) : '',
    o.upcoming[0] ? t('today.summary.next', { when: formatWhen(o.upcoming[0].at, now) }) : '',
  ].filter(Boolean);
  const warnings = o.warnings.filter((w) => !SETUP_WARNINGS.includes(w.kind));
  const setup = o.warnings.filter((w) => SETUP_WARNINGS.includes(w.kind));
  const levelTone = o.level === 'soft' ? 'neutral' : o.level === 'balanced' ? 'calm' : 'protected';
  return (
    <div class="stack stack-xl">
      <header class="page-head">
        <div>
          <p class="overline">{formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{t('nav.today')}</h1>
          <p class="status-line">{summary.join(' · ')}</p>
        </div>
        <a href="#/protection" class={`pill tone-${levelTone}`} style={{ textDecoration: 'none' }}>
          <Icon name={levelIcon(o.level)} />
          <span>
            {t('today.protection', { level: t(`level.${o.level}`) })}
            {o.lockedUntil &&
              o.level === 'locked' &&
              ` · ${t('today.lockedUntil', { when: formatDateTime(o.lockedUntil) })}`}
          </span>
        </a>
      </header>
      {warnings.map((w) => (
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
      <div class="today-grid">
        <div class="stack stack-lg">
          <section class="card" aria-labelledby="now-title">
            <div class="card-head">
              <h2 id="now-title">{t('today.now')}</h2>
              <a href="#/groups" class="quiet small">
                {t('today.allGroups')}
              </a>
            </div>
            {groups.length === 0 ? (
              <Empty icon="layers" title={t('today.noGroups')}>
                <Button variant="primary" icon="plus" onClick={() => navigate('/groups/new')}>
                  {t('groups.new')}
                </Button>
              </Empty>
            ) : (
              <div>
                {groups.map((g) => (
                  <GroupRow key={g.id} g={g} now={now} />
                ))}
              </div>
            )}
          </section>
          <section class="card" aria-labelledby="next-title">
            <div class="card-head">
              <h2 id="next-title">{t('today.upcoming')}</h2>
            </div>
            <Timeline o={o} now={now} />
          </section>
        </div>
        <div class="stack stack-lg">
          {o.pauses.length > 0 && (
            <section class="card tone-calm" aria-labelledby="pauses-title">
              <div class="card-head">
                <h2 id="pauses-title">{t('today.activePauses')}</h2>
              </div>
              <div class="stack stack-sm">
                {o.pauses.map((p) => (
                  <div key={p.id} class="row between nowrap">
                    <StatusPill tone="calm" icon="pause">
                      {p.until
                        ? t('popup.pausedUntil', { when: formatWhen(p.until, now) })
                        : t('popup.pausedLeft', { duration: formatDuration(p.remaining ?? 0) })}
                    </StatusPill>
                    <Button
                      size="small"
                      variant="ghost"
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
            </section>
          )}
          <section class="card" aria-labelledby="focus-title">
            <div class="card-head">
              <h2 id="focus-title">{t('today.focus')}</h2>
              <a href="#/focus" class="quiet small">
                {t('focus.moreOptions')}
              </a>
            </div>
            <QuickSession compact sessions={o.sessions} groups={model.config.groups} onChange={reload} />
          </section>
          <section class="card" aria-labelledby="numbers-title">
            <div class="card-head">
              <h2 id="numbers-title">{t('today.numbers')}</h2>
              <a href="#/insights" class="quiet small">
                {t('nav.insights')}
              </a>
            </div>
            <Numbers o={o} />
          </section>
          {setup.length > 0 && (
            <section class="card" aria-labelledby="setup-title">
              <div class="setup-card">
                <Icon name="sparkle" />
                <div class="stack stack-sm grow">
                  <h2 id="setup-title" style={{ fontSize: '1rem' }}>
                    {t('today.setup')}
                  </h2>
                  {setup.map((w) => (
                    <p key={w.kind} class="small text-2">
                      {t(`warning.${w.kind}`, { detail: w.detail ?? '', when: '' })}
                    </p>
                  ))}
                  <a href="#/protection" class="quiet small">
                    {t('today.setupAction')} →
                  </a>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
