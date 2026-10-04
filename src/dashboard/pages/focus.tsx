/** Focus sessions and lockdown (FOC-01…FOC-05, FOC-09, ONB-07). */

import { useState } from 'preact/hooks';
import type { FocusSession, Group, Target } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { formatDuration, formatWhen } from '../../shared/format';
import type { TicketView } from '../../shared/models';
import { call } from '../../shared/rpc';
import { Banner, Button, Chips, Dialog, Field, NumberInput, Toggle, toast } from '../../ui/components';
import { useModel, useNow } from '../../ui/hooks';
import { TicketDialog } from '../../ui/ticket';
import { TargetsEditor } from '../components/targets';
import { useDashboard } from '../context';

function SessionRow({ s, groups, onChange }: { s: FocusSession; groups: Group[]; onChange: () => void }) {
  const now = useNow(1000);
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const started = s.startAt <= now;
  const names =
    s.kind === 'allowlist'
      ? t('focus.allowlistMode')
      : groups
          .filter((g) => s.groups.includes(g.id))
          .map((g) => g.name)
          .join(', ');
  return (
    <div class="card tight stack stack-sm">
      <div class="row between">
        <strong>
          {started
            ? t('focus.activeUntil', { when: formatWhen(s.endAt, now) })
            : t('focus.startsAt', { when: formatWhen(s.startAt, now) })}
        </strong>
        {s.locked && <span class="tag">{t('focus.locked')}</span>}
      </div>
      <p class="small text-2">{names}</p>
      {started && (
        <p class="small muted">{t('focus.left', { duration: formatDuration((s.endAt - now) / 1000) })}</p>
      )}
      <div class="row">
        {[15, 30, 60].map((m) => (
          <Button
            key={m}
            size="small"
            onClick={async () => {
              await call('session.extend', { id: s.id, minutes: m });
              toast(t('focus.extended', { minutes: m }));
              onChange();
            }}
          >
            {t('focus.extend', { minutes: m })}
          </Button>
        ))}
        {!s.locked && (
          <Button
            size="small"
            variant="ghost"
            onClick={async () => {
              const r = await call('session.end', { id: s.id });
              if (r.refused) toast(t(r.refused));
              else if (r.ticket) setTicket(r.ticket);
            }}
          >
            {started ? t('focus.end') : t('focus.cancel')}
          </Button>
        )}
      </div>
      {s.locked && <p class="tiny muted">{t('focus.lockedHelp')}</p>}
      {ticket && (
        <TicketDialog
          ticket={ticket}
          title={t('focus.endTitle')}
          onDone={() => {
            setTicket(null);
            onChange();
          }}
          onCancel={() => setTicket(null)}
        />
      )}
    </div>
  );
}

export function QuickSession({
  compact,
  sessions,
  groups,
  onChange,
}: {
  compact?: boolean;
  sessions: FocusSession[];
  groups: Group[];
  onChange: () => void;
}) {
  const [minutes, setMinutes] = useState<number | 'until'>(25);
  const [untilTime, setUntilTime] = useState('17:00');
  const [mode, setMode] = useState<'groups' | 'allowlist'>('groups');
  const [selected, setSelected] = useState<string[]>(() =>
    groups.filter((g) => g.enabled && !g.archived && g.options.quickSession).map((g) => g.id),
  );
  const [allow, setAllow] = useState<Target[]>([]);
  const [delay, setDelay] = useState(0);
  const [locked, setLocked] = useState(false);
  const [noPauses, setNoPauses] = useState(true);
  const [preview, setPreview] = useState(false);
  const now = useNow(1000);
  const active = groups.filter((g) => g.enabled && !g.archived);

  const until = (): number | undefined => {
    if (minutes !== 'until') return undefined;
    const [h, m] = untilTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  };
  const start = async () => {
    setPreview(false);
    await call('session.start', {
      kind: mode,
      groups: mode === 'groups' ? selected : [],
      allow: mode === 'allowlist' ? allow : [],
      minutes: minutes === 'until' ? undefined : minutes,
      until: until(),
      startInMinutes: delay || undefined,
      locked,
      noPauses,
    });
    toast(t('focus.startedToast'));
    onChange();
  };
  const current = sessions.filter((s) => s.endAt > now);

  return (
    <div class="stack">
      {current.map((s) => (
        <SessionRow key={s.id} s={s} groups={groups} onChange={onChange} />
      ))}
      <Chips<number | 'until'>
        value={minutes}
        onChange={setMinutes}
        label={t('focus.duration')}
        options={[
          { value: 25, label: t('common.minutes', { n: 25 }) },
          { value: 50, label: t('common.minutes', { n: 50 }) },
          { value: 90, label: t('common.minutes', { n: 90 }) },
          { value: 180, label: t('common.hours', { n: 3 }) },
          { value: 'until', label: t('focus.until') },
        ]}
      />
      {minutes === 'until' && (
        <label class="row nowrap small">
          {t('focus.untilTime')}
          <input
            type="time"
            class="input inline"
            value={untilTime}
            onInput={(e) => setUntilTime((e.target as HTMLInputElement).value)}
          />
        </label>
      )}
      {!compact && (
        <>
          <Chips
            value={mode}
            onChange={setMode}
            label={t('focus.mode')}
            options={[
              { value: 'groups', label: t('focus.mode.groups') },
              { value: 'allowlist', label: t('focus.mode.allowlist') },
            ]}
          />
          {mode === 'groups' ? (
            <div class="row">
              {active.map((g) => (
                <label key={g.id} class="check">
                  <input
                    type="checkbox"
                    checked={selected.includes(g.id)}
                    onChange={() =>
                      setSelected(
                        selected.includes(g.id) ? selected.filter((x) => x !== g.id) : [...selected, g.id],
                      )
                    }
                  />
                  {g.name}
                </label>
              ))}
              {!active.length && <p class="muted small">{t('focus.noGroups')}</p>}
            </div>
          ) : (
            <div class="stack stack-sm">
              <p class="help">{t('focus.allowlistHelp')}</p>
              <TargetsEditor targets={allow} onChange={setAllow} advanced={false} exceptions={false} />
            </div>
          )}
          <div class="row">
            <span>{t('focus.startIn')}</span>
            <NumberInput
              value={delay}
              min={0}
              max={1440}
              label={t('focus.startIn')}
              suffix={t('common.minutesUnit')}
              onChange={setDelay}
            />
          </div>
          <Toggle
            checked={noPauses}
            onChange={setNoPauses}
            label={t('focus.noPauses')}
            help={t('focus.noPausesHelp')}
          />
          <Toggle
            checked={locked}
            onChange={setLocked}
            label={t('focus.lockedLabel')}
            help={t('focus.lockedLabelHelp')}
          />
        </>
      )}
      <Button
        variant="primary"
        icon="play"
        disabled={mode === 'groups' && !selected.length && !compact}
        onClick={() => (locked || mode === 'allowlist' ? setPreview(true) : void start())}
      >
        {t('focus.start')}
      </Button>
      {compact && (
        <a href="#/focus" class="small">
          {t('focus.moreOptions')}
        </a>
      )}
      {preview && (
        <Dialog
          open
          onClose={() => setPreview(false)}
          title={t('focus.previewTitle')}
          actions={
            <>
              <Button variant="primary" onClick={() => setPreview(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={start}>{t('focus.start')}</Button>
            </>
          }
        >
          <div class="stack">
            <p>
              {t('focus.previewBody', {
                end: until()
                  ? formatWhen(until()!)
                  : formatWhen(Date.now() + (delay + (typeof minutes === 'number' ? minutes : 0)) * 60_000),
              })}
            </p>
            {mode === 'allowlist' && (
              <Banner kind="info">{t('focus.previewAllowlist', { count: allow.length })}</Banner>
            )}
            {locked && (
              <Banner kind="warning" icon="lock">
                {t('focus.previewLocked')}
              </Banner>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function FocusPage() {
  const { model } = useDashboard();
  const { data: o, reload } = useModel('overview.get', {}, [], 30_000);
  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <h1>{t('focus.title')}</h1>
          <p>{t('focus.subtitle')}</p>
        </div>
      </div>
      <div class="card stack">
        <QuickSession sessions={o?.sessions ?? []} groups={model.config.groups} onChange={reload} />
      </div>
      <Field label={t('focus.shortcut')}>{() => <p class="small muted">{t('focus.shortcutHelp')}</p>}</Field>
    </div>
  );
}
