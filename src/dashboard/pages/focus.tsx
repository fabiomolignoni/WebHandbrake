/** Focus sessions and lockdown. */

import { useState } from 'preact/hooks';
import { isGroupActive } from '../../engine/compile';
import { DEFAULT_SESSION_MINUTES, MAX_SESSION_MS, QUICK_SESSION_MINUTES } from '../../engine/limits';
import type { FocusSession, Group, Target } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { formatDuration, formatWhen } from '../../shared/format';
import type { TicketView } from '../../shared/models';
import { call } from '../../shared/rpc';
import {
  Banner,
  Button,
  ColorDot,
  Dialog,
  DurationInput,
  RadioCards,
  Ring,
  Segmented,
  Toggle,
  toast,
} from '../../ui/components';
import { useModel, useNow } from '../../ui/hooks';
import { Icon } from '../../ui/icons';
import { TicketDialog } from '../../ui/ticket';
import { TargetsEditor } from '../components/targets';
import { useDashboard } from '../context';

function SessionCard({
  s,
  groups,
  onChange,
  compact,
}: {
  s: FocusSession;
  groups: Group[];
  onChange: () => void;
  compact?: boolean;
}) {
  const now = useNow(1000);
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const started = s.startAt <= now;
  const total = s.endAt - s.startAt;
  const left = Math.max(0, s.endAt - (started ? now : s.startAt));
  const names =
    s.kind === 'allowlist'
      ? t('focus.allowlistMode')
      : groups
          .filter((g) => s.groups.includes(g.id))
          .map((g) => g.name)
          .join(', ');
  return (
    <div class={`stack ${compact ? 'card flat tight' : 'card'} tone-protected`}>
      <div class={compact ? 'session-compact' : 'session-hero'}>
        <Ring value={total > 0 ? left / total : 0}>
          {started ? formatDuration(left / 1000) : <Icon name="clock" />}
        </Ring>
        <div class="stack stack-xs grow" style={{ minWidth: 0 }}>
          <strong>
            {started
              ? t('focus.activeUntil', { when: formatWhen(s.endAt, now) })
              : t('focus.startsAt', { when: formatWhen(s.startAt, now) })}
          </strong>
          <span class="small text-2">{names}</span>
          {s.locked && (
            <span class="tag" style={{ alignSelf: 'flex-start' }}>
              <Icon name="lock" /> {t('focus.locked')}
            </span>
          )}
        </div>
      </div>
      <div class="row">
        {(compact ? [15] : [15, 30, 60]).map((m) => (
          <Button
            key={m}
            size="small"
            icon="plus"
            onClick={async () => {
              await call('session.extend', { id: s.id, minutes: m });
              toast(t('focus.extended', { duration: formatDuration(m * 60) }));
              onChange();
            }}
          >
            {t('focus.extend', { duration: formatDuration(m * 60) })}
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
      {s.locked && !compact && <p class="tiny muted">{t('focus.lockedHelp')}</p>}
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

const DELAYS = [0, 5, 15, 30, 60];

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
  const [minutes, setMinutes] = useState<number | 'until' | 'custom'>(DEFAULT_SESSION_MINUTES);
  /** #18: a length of the person's choice, in minutes. */
  const [customMinutes, setCustomMinutes] = useState(120);
  const [untilTime, setUntilTime] = useState('17:00');
  const active = groups.filter(isGroupActive);
  /** The rules of a quick session, as the popup and the keyboard shortcut start it. */
  const quick = active.filter((g) => g.options.quickSession).map((g) => g.id);
  const [mode, setMode] = useState<'groups' | 'allowlist'>('groups');
  const [selected, setSelected] = useState<string[]>(() => quick);
  const [allow, setAllow] = useState<Target[]>([]);
  const [delay, setDelay] = useState(0);
  const [locked, setLocked] = useState(false);
  const [noPauses, setNoPauses] = useState(true);
  const [preview, setPreview] = useState(false);
  const now = useNow(1000);

  const until = (): number | undefined => {
    if (minutes !== 'until') return undefined;
    const [h, m] = untilTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  };
  /** The length chosen, in minutes; undefined when the session lasts until a time of day. */
  const length = minutes === 'until' ? undefined : minutes === 'custom' ? customMinutes : minutes;
  const start = async () => {
    setPreview(false);
    await call('session.start', {
      kind: mode,
      // The compact form has no choice of rules: those of quick sessions, as they are now.
      groups: mode === 'groups' ? (compact ? quick : selected) : [],
      allow: mode === 'allowlist' ? allow : [],
      minutes: length,
      until: until(),
      startInMinutes: delay || undefined,
      locked,
      noPauses,
    });
    toast(t('focus.startedToast'));
    onChange();
  };
  const current = sessions.filter((s) => s.endAt > now);
  const durations = (
    <Segmented<number | 'until' | 'custom'>
      value={minutes}
      onChange={setMinutes}
      labelledBy={compact ? undefined : 'focus-duration'}
      label={t('focus.duration')}
      options={[
        ...[...QUICK_SESSION_MINUTES, 180].map((n) => ({ value: n, label: formatDuration(n * 60) })),
        { value: 'until', label: t('focus.until') },
        { value: 'custom', label: t('focus.custom') },
      ]}
    />
  );
  const customField = minutes === 'custom' && (
    <div class="row nowrap small">
      <DurationInput
        units={['minutes', 'hours']}
        value={customMinutes}
        min={1}
        max={MAX_SESSION_MS / 60_000}
        label={t('focus.customMinutes')}
        onChange={setCustomMinutes}
      />
      <span class="muted" aria-live="polite">
        {formatDuration(customMinutes * 60)}
      </span>
    </div>
  );
  const untilField = minutes === 'until' && (
    <label class="row nowrap small">
      {t('focus.untilTime')}
      <input
        type="time"
        class="input inline"
        value={untilTime}
        onInput={(e) => setUntilTime((e.target as HTMLInputElement).value)}
      />
    </label>
  );

  return (
    <div class="stack stack-lg">
      {current.map((s) => (
        <SessionCard key={s.id} s={s} groups={groups} onChange={onChange} compact={compact} />
      ))}
      {compact ? (
        <div class="stack">
          {durations}
          {untilField}
          {customField}
          {/* Without a rule, a session would look active and block nothing. */}
          {!quick.length && <p class="small muted">{t('focus.noQuickRules')}</p>}
          <Button variant="primary" icon="play" disabled={!quick.length} onClick={() => void start()}>
            {t('focus.start')}
          </Button>
        </div>
      ) : (
        <section class="card stack stack-lg" aria-labelledby="new-session">
          <h2 id="new-session">{t('focus.newSession')}</h2>
          <div class="field">
            <span class="label" id="focus-duration">
              {t('focus.duration')}
            </span>
            {durations}
            {untilField}
            {customField}
          </div>
          <div class="field">
            <span class="label">{t('focus.mode')}</span>
            <RadioCards
              value={mode}
              onChange={setMode}
              label={t('focus.mode')}
              class="grid"
              itemClass="choice compact"
              options={[{ value: 'groups' }, { value: 'allowlist' }]}
              render={(o) => (
                <>
                  <Icon name={o.value === 'groups' ? 'layers' : 'globe'} />
                  <span>
                    <strong>{t(`focus.mode.${o.value}`)}</strong>
                    <span class="small muted">{t(`focus.mode.${o.value}.desc`)}</span>
                  </span>
                </>
              )}
            />
          </div>
          {mode === 'groups' ? (
            <div class="field">
              <span class="label">{t('focus.whichGroups')}</span>
              {active.length ? (
                <div class="chips" role="group" aria-label={t('focus.whichGroups')}>
                  {active.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      class="chip"
                      aria-pressed={selected.includes(g.id)}
                      onClick={() =>
                        setSelected(
                          selected.includes(g.id) ? selected.filter((x) => x !== g.id) : [...selected, g.id],
                        )
                      }
                    >
                      <ColorDot color={g.color} />
                      {g.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p class="muted small">{t('focus.noGroups')}</p>
              )}
            </div>
          ) : (
            <div class="stack stack-sm">
              <p class="help">{t('focus.allowlistHelp')}</p>
              <TargetsEditor targets={allow} onChange={setAllow} />
            </div>
          )}
          <div class="field">
            <span class="label" id="focus-start">
              {t('focus.startIn')}
            </span>
            <Segmented
              value={delay}
              onChange={setDelay}
              labelledBy="focus-start"
              options={DELAYS.map((d) => ({
                value: d,
                label:
                  d === 0 ? t('focus.startNow') : t('focus.startInN', { duration: formatDuration(d * 60) }),
              }))}
            />
          </div>
          <div class="settings-list">
            <Toggle checked={noPauses} onChange={setNoPauses} label={t('focus.noPauses')} />
            <Toggle
              checked={locked}
              onChange={setLocked}
              label={t('focus.lockedLabel')}
              help={t('focus.lockedLabelHelp')}
            />
          </div>
          <Button
            variant="primary"
            size="large"
            icon="play"
            disabled={mode === 'groups' && !selected.length}
            onClick={() => (locked || mode === 'allowlist' ? setPreview(true) : void start())}
          >
            {t('focus.start')}
          </Button>
        </section>
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
                end: formatWhen(until() ?? Date.now() + (delay + (length ?? 0)) * 60_000),
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
    <div class="stack stack-xl">
      <div class="page-head">
        <div>
          <h1>{t('focus.title')}</h1>
          <p>{t('focus.subtitle')}</p>
        </div>
      </div>
      <QuickSession sessions={o?.sessions ?? []} groups={model.config.groups} onChange={reload} />
      <p class="small muted row nowrap" style={{ gap: '8px', alignItems: 'flex-start' }}>
        <Icon name="keyboard" />
        <span>{t('focus.shortcutHelp', { minutes: DEFAULT_SESSION_MINUTES })}</span>
      </p>
    </div>
  );
}
