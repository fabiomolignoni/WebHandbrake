/**
 * Protection centre.
 */

import { useState } from 'preact/hooks';
import { isGroupActive } from '../../engine/compile';
import { clone } from '../../engine/json';
import { WAIT_IN_DIALOG_SECONDS } from '../../engine/limits';
import type { Group, PendingChange, Protection, TamperEvent } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { api, browserName } from '../../platform/api';
import { formatDateTime, formatDuration, formatWhen } from '../../shared/format';
import type { TicketView } from '../../shared/models';
import { call } from '../../shared/rpc';
import { describeUnit } from '../../shared/summary';
import {
  Banner,
  Button,
  Dialog,
  DurationInput,
  Field,
  GroupTile,
  RadioList,
  Spinner,
  ToneIcon,
  toast,
} from '../../ui/components';
import { useModel, useNow } from '../../ui/hooks';
import { Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { TicketDialog } from '../../ui/ticket';
import { PROTECTION_KINDS, protectionIcon, protectionLabel } from '../components/protection-picker';
import { useDashboard } from '../context';

function PendingItem({ p, onChange }: { p: PendingChange; onChange: () => void }) {
  const now = useNow(30_000);
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const ready = p.readyAt <= now;
  return (
    <li class="stack stack-sm">
      <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
        {p.units.map((u, i) => (
          <li key={i}>{describeUnit(u)}</li>
        ))}
      </ul>
      <p class="tiny muted">
        {t('pending.requested', { when: formatDateTime(p.createdAt) })} ·{' '}
        {ready
          ? t('pending.readyUntil', { when: formatWhen(p.expiresAt, now) })
          : t('pending.readyIn', { duration: formatDuration((p.readyAt - now) / 1000) })}
        {p.emergency && <> · {t('pending.emergencyNote')}</>}
      </p>
      <div class="row">
        <Button
          size="small"
          variant="primary"
          onClick={async () => {
            await call('pending.cancel', { id: p.id });
            toast(t('pending.cancelled'));
            onChange();
          }}
        >
          {t('pending.cancel')}
        </Button>
        {ready && (
          <Button
            size="small"
            onClick={async () => {
              const r = await call('pending.confirm', { id: p.id });
              if (r.error) toast(t(r.error));
              else if (r.ticket) setTicket(r.ticket);
            }}
          >
            {t('pending.confirm')}
          </Button>
        )}
      </div>
      {ticket && (
        <TicketDialog
          ticket={ticket}
          title={t('pending.confirmTitle')}
          onDone={() => {
            setTicket(null);
            toast(t('pending.applied'));
            onChange();
          }}
          onCancel={() => setTicket(null)}
        />
      )}
    </li>
  );
}

function incognitoHelp(): string {
  const b = browserName();
  return t(
    b === 'chrome' || b === 'edge'
      ? 'checklist.incognito.chrome'
      : b === 'firefox-android'
        ? 'checklist.incognito.android'
        : 'checklist.incognito.firefox',
  );
}

/** The checklist reports the clock changes of this many recent days. */
const RECENT_EVENT_DAYS = 30;

function Checklist() {
  const { data: diag } = useModel('diag.get', {});
  const { model } = useDashboard();
  if (!diag) return <Spinner />;
  const recentTamper = diag.tamper.filter((e) => Date.now() - e.at < RECENT_EVENT_DAYS * 86_400_000);
  const clockIssues = recentTamper.filter((e) => e.kind === 'clock-backward' || e.kind === 'clock-skew');
  const internal = model.config.settings.protection.internalPages;
  const items: {
    ok: boolean;
    text: string;
    help?: string;
    action?: { label: string; run: () => void };
  }[] = [
    {
      ok: diag.permissions.hostAccess,
      text: diag.permissions.hostAccess ? t('checklist.host.ok') : t('checklist.host.no'),
      action: diag.permissions.hostAccess
        ? undefined
        : {
            label: t('warning.fix'),
            run: async () => {
              if (await api.permissions.request({ origins: ['<all_urls>'] }).catch(() => false))
                await call('permissions.changed', {});
            },
          },
    },
    {
      ok: diag.permissions.incognito,
      text: diag.permissions.incognito ? t('checklist.incognito.ok') : t('checklist.incognito.no'),
      help: diag.permissions.incognito
        ? undefined
        : model.browserPagesBlocked
          ? `${incognitoHelp()} ${t('checklist.incognito.blockedNow')}`
          : incognitoHelp(),
    },
    {
      ok: internal !== 'never',
      text:
        internal === 'never'
          ? t('checklist.internal.no')
          : internal === 'always'
            ? t('checklist.internal.always')
            : t('checklist.internal.auto'),
      help:
        internal === 'auto'
          ? t(model.browserPagesBlocked ? 'checklist.internal.blockedNow' : 'checklist.internal.openNow')
          : undefined,
    },
    {
      ok: clockIssues.length === 0,
      text: clockIssues.length
        ? t('checklist.clock.no', { count: clockIssues.length, days: RECENT_EVENT_DAYS })
        : t('checklist.clock.ok', { days: RECENT_EVENT_DAYS }),
    },
    {
      ok: !diag.rules.lastError && diag.rules.overflow.length === 0,
      text: diag.rules.lastError
        ? t('checklist.rules.error')
        : diag.rules.overflow.length
          ? t('checklist.rules.overflow', { count: diag.rules.overflow.length })
          : t('checklist.rules.ok'),
    },
  ];
  const passed = items.filter((it) => it.ok).length;
  return (
    <div class="stack">
      <div class="row nowrap">
        <ToneIcon
          tone={passed === items.length ? 'free' : 'friction'}
          icon={passed === items.length ? 'shield-check' : 'shield'}
          size={44}
        />
        <div class="stack stack-xs">
          <strong>{t('checklist.score', { passed, total: items.length })}</strong>
          <span class="small text-2">
            {passed === items.length ? t('checklist.allGood') : t('checklist.someToCheck')}
          </span>
        </div>
      </div>
      <ul class="list">
        {items.map((it, i) => (
          <li key={i} class="row nowrap top">
            <ToneIcon
              size={28}
              round
              tone={it.ok ? 'free' : 'friction'}
              icon={it.ok ? 'check' : 'alert'}
              label={it.ok ? t('checklist.ok') : t('checklist.attention')}
            />
            <div class="stack grow" style={{ gap: '2px' }}>
              <span>{it.text}</span>
              {it.help && <span class="small muted">{it.help}</span>}
            </div>
            {it.action && (
              <Button size="small" onClick={it.action.run}>
                {it.action.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function tamperText(e: TamperEvent) {
  return t(`tamper.${e.kind}`, { detail: e.detail ?? '' });
}

function EmergencySection() {
  const { data: o, reload } = useModel('overview.get', {});
  const { model } = useDashboard();
  const now = useNow(30_000);
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const [confirmReq, setConfirmReq] = useState(false);
  if (!o) return null;
  const e = o.emergency;
  return (
    <div class="stack stack-sm">
      <p class="small">
        {t('emergency.description', { hours: model.config.settings.protection.emergencyHours })}
      </p>
      {!e && (
        <Button variant="danger" icon="door" onClick={() => setConfirmReq(true)}>
          {t('emergency.request')}
        </Button>
      )}
      {e && e.readyAt > now && (
        <Banner
          kind="info"
          icon="hourglass"
          action={
            <Button
              size="small"
              variant="primary"
              onClick={async () => {
                await call('emergency.cancel', {});
                void reload();
              }}
            >
              {t('emergency.cancel')}
            </Button>
          }
        >
          {t('emergency.waiting', {
            when: formatDateTime(e.readyAt),
            left: formatDuration((e.readyAt - now) / 1000),
          })}
        </Banner>
      )}
      {e && e.readyAt <= now && (
        <Banner
          kind="warning"
          action={
            <div class="row">
              <Button
                size="small"
                variant="primary"
                onClick={async () => {
                  await call('emergency.cancel', {});
                  void reload();
                }}
              >
                {t('emergency.cancel')}
              </Button>
              <Button
                size="small"
                variant="danger"
                onClick={async () => {
                  const r = await call('emergency.start', {});
                  if (r.error) toast(t(r.error));
                  else if (r.ticket) setTicket(r.ticket);
                }}
              >
                {t('emergency.complete')}
              </Button>
            </div>
          }
        >
          {t('emergency.ready')}
        </Banner>
      )}
      {confirmReq && (
        <Dialog
          open
          onClose={() => setConfirmReq(false)}
          title={t('emergency.title')}
          actions={
            <>
              <Button variant="primary" onClick={() => setConfirmReq(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  setConfirmReq(false);
                  await call('emergency.request', {});
                  void reload();
                }}
              >
                {t('emergency.request')}
              </Button>
            </>
          }
        >
          <p>{t('emergency.confirmBody', { hours: model.config.settings.protection.emergencyHours })}</p>
        </Dialog>
      )}
      {ticket && (
        <TicketDialog
          ticket={ticket}
          title={t('emergency.title')}
          onDone={() => {
            setTicket(null);
            toast(t('emergency.done'));
            void reload();
          }}
          onCancel={() => setTicket(null)}
        />
      )}
    </div>
  );
}

/**
 * #12: every rule has its own protection, chosen when it is created and changed in its
 * editor. Rules that are off or archived restrict nothing and are left out.
 */
function RuleProtections({ groups, now }: { groups: Group[]; now: Map<string, Protection> }) {
  const active = groups.filter(isGroupActive);
  if (!active.length) return <p class="muted small">{t('protection.noRules')}</p>;
  return (
    <ul class="list compact" aria-label={t('protection.levels')}>
      {active.map((g) => {
        const p = now.get(g.id) ?? g.protection;
        return (
          <li key={g.id} class="row nowrap">
            <GroupTile color={g.color} icon={g.icon} size={28} />
            {/* The protection goes under the name when both do not fit (phone-sized screens). */}
            <span class="rule-protection grow">
              <strong>{g.name}</strong>
              <span class="tag">
                <Icon name={protectionIcon(p.kind)} /> {protectionLabel(p)}
              </span>
            </span>
            <a
              href={`#/groups/${g.id}?step=protection`}
              class="small"
              aria-label={t('protection.changeLevel', { name: g.name })}
            >
              {t('protection.change')}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function ProtectionPage() {
  const { model } = useDashboard();
  const cfg = model.config;
  const p = cfg.settings.protection;
  const { data: o, reload } = useModel('overview.get', {});
  const { data: diag } = useModel('diag.get', {});
  const flow = useSaveFlow();
  const protections = new Map((o?.groups ?? []).map((g) => [g.id, g.protection]));
  const save = (mutate: (c: typeof cfg) => void) => {
    const next = clone(cfg);
    mutate(next);
    return flow.run(call('config.save', { config: next }));
  };
  return (
    <div class="stack stack-xl">
      <div class="page-head">
        <div>
          <h1>{t('protection.title')}</h1>
          <p>{t('protection.subtitle')}</p>
        </div>
      </div>

      {o && o.pending.length > 0 && (
        <section class="card stack tone-friction" aria-labelledby="pending-title">
          <div class="row nowrap">
            <ToneIcon tone="friction" icon="hourglass" />
            <div>
              <h2 id="pending-title">{t('protection.pending')}</h2>
              <p class="card-sub">{t('protection.pendingHelp')}</p>
            </div>
          </div>
          <ul class="list">
            {o.pending.map((x) => (
              <PendingItem key={x.id} p={x} onChange={reload} />
            ))}
          </ul>
        </section>
      )}

      <section class="card stack" aria-labelledby="level-title">
        <div>
          <h2 id="level-title">{t('protection.levels')}</h2>
          <p class="card-sub">{t('protection.levelsHelp')}</p>
        </div>
        <RuleProtections groups={cfg.groups} now={protections} />
        <details class="disclosure">
          <summary>
            <Icon name="help" />
            {t('protection.levelsExplained')}
          </summary>
          <div class="body">
            <ul class="plain stack">
              {PROTECTION_KINDS.map((l) => (
                <li key={l} class="row nowrap top">
                  <Icon name={protectionIcon(l)} />
                  <span class="stack stack-xs">
                    <strong>{t(`level.${l}`)}</strong>
                    <span class="small text-2">{t(`level.${l}.weaken`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </section>

      <section class="card stack" aria-labelledby="checklist-title">
        <h2 id="checklist-title">{t('protection.checklist')}</h2>
        <Checklist />
        <Field
          label={t('protection.internalPages')}
          help={t('protection.internalPagesHelp', { minutes: WAIT_IN_DIALOG_SECONDS / 60 })}
        >
          {(id, d) => (
            <RadioList
              labelledBy={`${id}-label`}
              describedBy={d}
              value={p.internalPages}
              onChange={(v) => void save((c) => (c.settings.protection.internalPages = v))}
              options={[
                { value: 'never', label: t('protection.internal.never') },
                { value: 'auto', label: t('protection.internal.auto') },
                { value: 'always', label: t('protection.internal.always') },
              ]}
            />
          )}
        </Field>
        <label class="check small">
          <input
            type="checkbox"
            checked={p.internalPagesFollowPause}
            onChange={(e) =>
              void save(
                (c) =>
                  (c.settings.protection.internalPagesFollowPause = (e.target as HTMLInputElement).checked),
              )
            }
          />
          {t('protection.internalFollowPause')}
        </label>
        <p class="small muted">{t('protection.guardNote', { hours: p.emergencyHours })}</p>
        <p class="small muted">{t('protection.hardeningNote')}</p>
      </section>

      <div class="card stack">
        <h2>{t('protection.emergency')}</h2>
        <EmergencySection />
        <Field
          label={t('protection.emergencyWait')}
          help={t('protection.emergencyWaitHelp', { hours: p.emergencyHours })}
        >
          {() => (
            <DurationInput
              base="hours"
              units={['hours', 'days']}
              commitOnBlur
              value={p.emergencyHours}
              min={4}
              max={168}
              label={t('protection.emergencyWait')}
              onChange={(v) => void save((c) => (c.settings.protection.emergencyHours = v))}
            />
          )}
        </Field>
      </div>

      <div class="card stack">
        <h2>{t('protection.tamper')}</h2>
        {!diag ? (
          <Spinner />
        ) : diag.tamper.length === 0 ? (
          <p class="muted">{t('protection.noTamper')}</p>
        ) : (
          <ul class="list compact small">
            {diag.tamper.map((e, i) => (
              <li key={i}>
                <strong>{formatDateTime(e.at)}</strong> · {tamperText(e)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {flow.element}
    </div>
  );
}
