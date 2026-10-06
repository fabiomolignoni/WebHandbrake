/**
 * Protection centre (PRO-01, PRO-03…PRO-05, PRO-08, PRO-09, PRO-13, PRO-15, PRO-18, §8.4.8, §8.4.9).
 */

import { useState } from 'preact/hooks';
import type { PendingChange, ProtectionLevel, TamperEvent } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { api, browserName } from '../../platform/api';
import { formatDateTime, formatDuration, formatWhen } from '../../shared/format';
import type { TicketView } from '../../shared/models';
import { call } from '../../shared/rpc';
import { describeUnit, describeWindows } from '../../shared/summary';
import {
  Banner,
  Button,
  Dialog,
  Field,
  NumberInput,
  RadioCards,
  Select,
  Spinner,
  ToneIcon,
  toast,
} from '../../ui/components';
import { useModel, useNow } from '../../ui/hooks';
import { Icon } from '../../ui/icons';
import { useSaveFlow } from '../../ui/saveflow';
import { TicketDialog, TypingInput } from '../../ui/ticket';
import { WindowsEditor } from '../components/schedule';
import { clone, useDashboard } from '../context';
import { LockedPreview, levelIcon } from './group-editor';

const LEVELS: ProtectionLevel[] = ['soft', 'balanced', 'strict', 'locked'];

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

function Checklist() {
  const { data: diag } = useModel('diag.get', {});
  const { model } = useDashboard();
  if (!diag) return <Spinner />;
  const recentTamper = diag.tamper.filter((e) => Date.now() - e.at < 30 * 86_400_000);
  const clockIssues = recentTamper.filter((e) => e.kind === 'clock-backward' || e.kind === 'clock-skew');
  const internal = model.config.settings.protection.internalPages;
  const items: {
    ok: boolean | null;
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
      help: diag.permissions.incognito ? undefined : incognitoHelp(),
    },
    {
      ok: internal !== 'never',
      text:
        internal === 'never'
          ? t('checklist.internal.no')
          : internal === 'always'
            ? t('checklist.internal.always')
            : t('checklist.internal.auto'),
    },
    {
      ok: clockIssues.length === 0,
      text: clockIssues.length
        ? t('checklist.clock.no', { count: clockIssues.length })
        : t('checklist.clock.ok'),
    },
    {
      ok: !diag.rules.lastError && diag.rules.overflow.length === 0,
      text: diag.rules.lastError
        ? t('checklist.rules.error')
        : diag.rules.overflow.length
          ? t('checklist.rules.overflow', { count: diag.rules.overflow.length })
          : t('checklist.rules.ok'),
    },
    { ok: null, text: t('checklist.safeMode'), help: t('checklist.safeModeHelp') },
    { ok: null, text: t('checklist.otherBrowsers'), help: t('checklist.otherBrowsersHelp') },
    { ok: null, text: t('checklist.profiles'), help: t('checklist.profilesHelp') },
  ];
  const checks = items.filter((it) => it.ok !== null);
  const passed = checks.filter((it) => it.ok).length;
  return (
    <div class="stack">
      <div class="row nowrap">
        <ToneIcon
          tone={passed === checks.length ? 'free' : 'friction'}
          icon={passed === checks.length ? 'shield-check' : 'shield'}
          size={44}
        />
        <div class="stack stack-xs">
          <strong>{t('checklist.score', { passed, total: checks.length })}</strong>
          <span class="small text-2">
            {passed === checks.length ? t('checklist.allGood') : t('checklist.someToCheck')}
          </span>
        </div>
      </div>
      <ul class="list">
        {items.map((it, i) => (
          <li key={i} class="row nowrap top">
            <ToneIcon
              size={28}
              round
              tone={it.ok === true ? 'free' : it.ok === false ? 'friction' : 'neutral'}
              icon={it.ok === true ? 'check' : it.ok === false ? 'alert' : 'info'}
              label={
                it.ok === true
                  ? t('checklist.ok')
                  : it.ok === false
                    ? t('checklist.attention')
                    : t('checklist.info')
              }
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

function PasswordSection() {
  const { model } = useDashboard();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const flow = useSaveFlow();
  const set = async (value: string | null) => {
    setOpen(false);
    await flow.run(call('password.change', { password: value }));
    setPw('');
    setPw2('');
  };
  return (
    <div class="stack stack-sm">
      <p>{model.hasPassword ? t('access.passwordSet') : t('access.passwordNone')}</p>
      <div class="row">
        <Button size="small" onClick={() => setOpen(true)}>
          {model.hasPassword ? t('access.change') : t('access.set')}
        </Button>
        {model.hasPassword && (
          <Button size="small" variant="ghost" onClick={() => set(null)}>
            {t('access.remove')}
          </Button>
        )}
      </div>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={t('access.passwordTitle')}
          actions={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" disabled={pw.length < 4 || pw !== pw2} onClick={() => set(pw)}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div class="stack">
            <p class="small">{t('access.passwordHelp')}</p>
            <Field label={t('access.newPassword')}>
              {(id) => (
                <TypingInput id={id} password value={pw} onInput={setPw} label={t('access.newPassword')} />
              )}
            </Field>
            <Field label={t('access.repeat')} error={pw2 && pw !== pw2 ? t('access.mismatch') : null}>
              {(id) => (
                <TypingInput id={id} password value={pw2} onInput={setPw2} label={t('access.repeat')} />
              )}
            </Field>
          </div>
        </Dialog>
      )}
      {flow.element}
    </div>
  );
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

export function ProtectionPage() {
  const { model } = useDashboard();
  const cfg = model.config;
  const p = cfg.settings.protection;
  const { data: o, reload } = useModel('overview.get', {});
  const { data: diag } = useModel('diag.get', {});
  const flow = useSaveFlow();
  const [lockPreview, setLockPreview] = useState(false);
  const [windows, setWindows] = useState(p.access.lockWindows);
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
          <h2 id="level-title">{t('protection.level')}</h2>
          <p class="card-sub">{t('protection.levelHelp')}</p>
        </div>
        <RadioCards<ProtectionLevel>
          value={p.level}
          label={t('protection.level')}
          class="level-grid"
          itemClass="choice"
          options={LEVELS.map((l) => ({ value: l }))}
          onChange={(l) => {
            if (l === p.level) return;
            if (l === 'locked') setLockPreview(true);
            else
              void save((c) => {
                c.settings.protection.level = l;
                c.settings.protection.lockedUntil = null;
              });
          }}
          render={(o2) => (
            <>
              <Icon name={levelIcon(o2.value)} />
              <span class="stack stack-xs">
                <strong>{t(`level.${o2.value}`)}</strong>
                <span class="small text-2">{t(`level.${o2.value}.desc`)}</span>
              </span>
            </>
          )}
        />
        <div class="option-panel">
          <ul class="small bullets">
            <li>{t(`level.${p.level}.weaken`)}</li>
            <li>{t(`level.${p.level}.pauses`)}</li>
          </ul>
        </div>
        {p.level === 'locked' && p.lockedUntil && (
          <Banner kind="info" icon="lock">
            {t('protection.lockedUntil', { when: formatDateTime(p.lockedUntil) })}
          </Banner>
        )}
        <details class="disclosure">
          <summary>
            <Icon name="sliders" />
            {t('protection.fineTune')}
          </summary>
          <div class="body">
            <div class="grid" style={{ ['--min' as string]: '200px' }}>
              <Field label={t('protection.balancedDelay')} help={t('protection.balancedDelayHelp')}>
                {() => (
                  <NumberInput
                    commitOnBlur
                    value={p.balancedDelaySeconds}
                    min={5}
                    max={3600}
                    suffix={t('common.secondsUnit')}
                    label={t('protection.balancedDelay')}
                    onChange={(v) => void save((c) => (c.settings.protection.balancedDelaySeconds = v))}
                  />
                )}
              </Field>
              <Field label={t('protection.coolingOff')} help={t('protection.coolingOffHelp')}>
                {() => (
                  <NumberInput
                    commitOnBlur
                    value={p.coolingOffHours}
                    min={1}
                    max={168}
                    suffix={t('common.hoursUnit')}
                    label={t('protection.coolingOff')}
                    onChange={(v) => void save((c) => (c.settings.protection.coolingOffHours = v))}
                  />
                )}
              </Field>
              <Field label={t('protection.challengeLength')} help={t('protection.challengeLengthHelp')}>
                {() => (
                  <NumberInput
                    commitOnBlur
                    value={p.challengeLength}
                    min={8}
                    max={200}
                    label={t('protection.challengeLength')}
                    onChange={(v) => void save((c) => (c.settings.protection.challengeLength = v))}
                  />
                )}
              </Field>
            </div>
          </div>
        </details>
      </section>

      <section class="card stack" aria-labelledby="checklist-title">
        <h2 id="checklist-title">{t('protection.checklist')}</h2>
        <Checklist />
        <Field label={t('protection.internalPages')} help={t('protection.internalPagesHelp')}>
          {(id) => (
            <Select
              id={id}
              value={p.internalPages}
              onChange={(v) => void save((c) => (c.settings.protection.internalPages = v))}
              options={[
                { value: 'auto', label: t('protection.internal.auto') },
                { value: 'always', label: t('protection.internal.always') },
                { value: 'never', label: t('protection.internal.never') },
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
        <p class="small muted">{t('protection.hardeningNote')}</p>
      </section>

      <div class="card stack">
        <div>
          <h2>{t('protection.access')}</h2>
          <p class="card-sub">{t('protection.accessHelp')}</p>
        </div>
        <PasswordSection />
        <div class="row">
          <Field label={t('access.code')} help={t('access.codeHelp')}>
            {() => (
              <Select
                value={String(p.access.codeLength)}
                label={t('access.code')}
                onChange={(v) => void save((c) => (c.settings.protection.access.codeLength = Number(v)))}
                options={['0', '16', '32', '64', '128'].map((v) => ({
                  value: v,
                  label: v === '0' ? t('access.codeNone') : t('access.codeChars', { n: Number(v) }),
                }))}
              />
            )}
          </Field>
        </div>
        <details class="disclosure">
          <summary>{t('access.windows')}</summary>
          <div class="body stack">
            <p class="help">{t('access.windowsHelp')}</p>
            <WindowsEditor windows={windows} onChange={setWindows} />
            <div class="row">
              <Button
                size="small"
                variant="primary"
                disabled={JSON.stringify(windows) === JSON.stringify(p.access.lockWindows)}
                onClick={() => void save((c) => (c.settings.protection.access.lockWindows = windows))}
              >
                {t('common.save')}
              </Button>
              {p.access.lockWindows.length > 0 && (
                <span class="small muted">{describeWindows(p.access.lockWindows)}</span>
              )}
            </div>
          </div>
        </details>
      </div>

      <div class="card stack">
        <h2>{t('protection.emergency')}</h2>
        <EmergencySection />
        <Field label={t('protection.emergencyWait')}>
          {() => (
            <NumberInput
              commitOnBlur
              value={p.emergencyHours}
              min={4}
              max={168}
              suffix={t('common.hoursUnit')}
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
      {lockPreview && (
        <LockedPreview
          onCancel={() => setLockPreview(false)}
          onConfirm={(until) => {
            setLockPreview(false);
            void save((c) => {
              c.settings.protection.level = 'locked';
              c.settings.protection.lockedUntil = until;
            });
          }}
        />
      )}
      {flow.element}
    </div>
  );
}
