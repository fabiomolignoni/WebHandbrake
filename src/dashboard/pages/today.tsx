/**
 * Today: status first — what is happening now, what comes next,
 * a focus session in one tap and today's numbers. Real problems are banners; setup steps are a
 * quiet card.
 */

import { isGroupActive } from '../../engine/compile';
import type { InterventionType, Policy } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { api } from '../../platform/api';
import { formatDate, formatDateTime, formatDuration, formatWhen } from '../../shared/format';
import type { GroupStatus, Overview, UpcomingChange, Warning } from '../../shared/models';
import { call } from '../../shared/rpc';
import { describeIntervention } from '../../shared/summary';
import { Banner, Button, Empty, GroupTile, Progress, Spinner, TypePills, toast } from '../../ui/components';
import { budgetText } from '../../ui/explain';
import { useModel, useNow } from '../../ui/hooks';
import { Icon } from '../../ui/icons';
import { breakSubject } from '../../ui/pause';
import { groupTone, interventionIcon, ruleTypes, toneOf, typeName } from '../../ui/status';
import { useDashboard } from '../context';
import { navigate } from '../router';
import { QuickSession } from './focus';

/** Setup steps rather than problems: shown as a quiet card, not as an alert. */
const SETUP_WARNINGS: Warning['kind'][] = ['incognito'];

/** About something that happened rather than a lasting problem: can be dismissed. */
const DISMISSIBLE_WARNINGS: Warning['kind'][] = ['restored', 'tamper'];

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
  // Restored to the defaults: there is no backup to name.
  const text = w.kind === 'restored' && !w.at ? 'warning.restored.defaults' : `warning.${w.kind}`;
  return (
    <Banner
      kind={kind}
      onDismiss={
        DISMISSIBLE_WARNINGS.includes(w.kind)
          ? () => void call('warning.dismiss', { kind: w.kind })
          : undefined
      }
      action={
        a && (
          <Button size="small" onClick={a.run}>
            {a.label}
          </Button>
        )
      }
    >
      <span>{t(text, { detail: w.detail ?? '', when: w.at ? formatDateTime(w.at) : '' })}</span>
    </Banner>
  );
}

/** Whether a rule applies now and until when, or why not, and which of its types comes next. */
function nowLine(g: GroupStatus, types: InterventionType[], inEffect: InterventionType | null, now: number) {
  if (g.pause)
    return g.pause.until
      ? t('status.pausedUntil', { when: formatWhen(g.pause.until, now) })
      : t('status.paused');
  if (g.source === 'session')
    return g.until ? t('status.sessionUntil', { when: formatWhen(g.until, now) }) : t('status.session');
  const state = !inEffect
    ? t('today.applies.not')
    : g.until
      ? t('today.applies.until', { when: formatWhen(g.until, now) })
      : t('today.applies.now');
  const next = g.nextChange;
  if (!next || !types.includes(next.intervention.type)) return state;
  const from = t('today.applies.from', {
    what: typeName(next.intervention.type),
    when: formatWhen(next.at, now),
  });
  return `${state} · ${from}`;
}

/**
 * A rule right now: its type pills (what it does, as on Rules) with the one in effect highlighted,
 * and a line that says whether it applies now.
 */
function GroupRow({ g, policies, now }: { g: GroupStatus; policies: Policy[]; now: number }) {
  const tone = groupTone(g);
  const budget = g.budgets.find((b) => !b.exhausted && b.type !== 'session');
  const restricted = tone === 'protected' || tone === 'friction';
  const types = ruleTypes(policies);
  const current = g.intervention?.type;
  const inEffect = !g.pause && g.source !== 'session' && current && types.includes(current) ? current : null;
  return (
    <div class="group-status">
      <GroupTile color={g.color} icon={g.icon} size={36} />
      <div class="stack stack-xs" style={{ minWidth: 0 }}>
        <a class="name ellipsis" href={`#/groups/${g.id}`}>
          {g.name}
        </a>
        <span class="tiny muted">{nowLine(g, types, inEffect, now)}</span>
      </div>
      <TypePills types={types} inEffect={inEffect} />
      {budget && !restricted && (
        <div class={`detail stack stack-xs tone-${tone}`}>
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
  const groupName = (id: string) => model.config.groups.find((g) => g.id === id)?.name;
  const { data: o, reload } = useModel('overview.get', {}, [], 30_000);
  const now = useNow(30_000);
  if (!o) return <Spinner />;
  const groups = o.groups.filter(isGroupActive);
  const restricted = groups.map(groupTone).filter((x) => x === 'protected' || x === 'friction').length;
  const summary = [
    t('today.summary.groups', { count: groups.length }),
    groups.length ? t('today.summary.restricted', { count: restricted }) : '',
    o.upcoming[0] ? t('today.summary.next', { when: formatWhen(o.upcoming[0].at, now) }) : '',
  ].filter(Boolean);
  const warnings = o.warnings.filter((w) => !SETUP_WARNINGS.includes(w.kind));
  const setup = o.warnings.filter((w) => SETUP_WARNINGS.includes(w.kind));
  return (
    <div class="stack stack-xl">
      <header class="page-head">
        <div>
          <p class="overline">{formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{t('nav.today')}</h1>
          <p class="status-line">{summary.join(' · ')}</p>
        </div>
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
                  <GroupRow
                    key={g.id}
                    g={g}
                    policies={model.config.groups.find((x) => x.id === g.id)?.policies ?? []}
                    now={now}
                  />
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
                    <div class="stack stack-xs break-subject">
                      <strong>{breakSubject(p, groupName)}</strong>
                      <span class="small text-2">
                        {p.until
                          ? t('pause.leftUntil', { when: formatWhen(p.until, now) })
                          : t('pause.leftMetered', { duration: formatDuration(p.remaining ?? 0) })}
                      </span>
                    </div>
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
