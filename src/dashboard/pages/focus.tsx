/** Focus sessions and lockdown. */

import { useEffect, useState } from 'preact/hooks';
import { isGroupActive } from '../../engine/compile';
import { DEFAULT_SESSION_MINUTES, MAX_SESSION_MS, QUICK_SESSION_MINUTES } from '../../engine/limits';
import type { FocusKind, FocusLists, FocusSession, Group } from '../../engine/types';
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

function SessionCard({ s, groups, onChange }: { s: FocusSession; groups: Group[]; onChange: () => void }) {
  const now = useNow(1000);
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const started = s.startAt <= now;
  const total = s.endAt - s.startAt;
  const left = Math.max(0, s.endAt - (started ? now : s.startAt));
  const names =
    s.kind === 'allowlist'
      ? t('focus.allowlistMode')
      : s.kind === 'blocklist'
        ? t('focus.blocklistMode', { count: (s.block ?? []).filter((x) => !x.allow).length })
        : groups
            .filter((g) => s.groups.includes(g.id))
            .map((g) => g.name)
            .join(', ');
  return (
    <div class="stack card tone-protected">
      <div class="session-hero">
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
        {[15, 30, 60].map((m) => (
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

const DELAYS = [0, 5, 15, 30, 60];

/** What a session can block, from the fewest sites to the most, with their icons. */
const MODES: Record<FocusKind, string> = { groups: 'layers', blocklist: 'ban', allowlist: 'globe' };

function FocusSessions({
  sessions,
  groups,
  onChange,
}: {
  sessions: FocusSession[];
  groups: Group[];
  onChange: () => void;
}) {
  const [minutes, setMinutes] = useState<number | 'until' | 'custom'>(DEFAULT_SESSION_MINUTES);
  /** #18: a length of the person's choice, in minutes. */
  const [customMinutes, setCustomMinutes] = useState(120);
  const [untilTime, setUntilTime] = useState('17:00');
  const active = groups.filter(isGroupActive);
  /** At first, the rules of a quick session, as the keyboard shortcut starts it. */
  const [selected, setSelected] = useState<string[]>(() =>
    active.filter((g) => g.options.quickSession).map((g) => g.id),
  );
  /** What to block and the lists, as they were left: null until they are read. */
  const [lists, setLists] = useState<FocusLists | null>(null);
  useEffect(() => {
    void call('focus.get', {}).then(setLists);
  }, []);
  /** Every change is kept at once, for the next sessions. */
  const keep = (part: Partial<FocusLists>) => {
    setLists((l) => (l ? { ...l, ...part } : l));
    void call('focus.save', part);
  };
  const mode = lists?.kind ?? 'groups';
  const block = lists?.block ?? [];
  const allow = lists?.allow ?? [];
  const blocked = block.filter((x) => !x.allow).length;
  const clear = (list: 'block' | 'allow') => {
    const before = list === 'block' ? block : allow;
    keep({ [list]: [] });
    toast(t('focus.listCleared'), { label: t('common.undo'), run: () => keep({ [list]: before }) });
  };
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
      groups: mode === 'groups' ? selected : [],
      allow: mode === 'allowlist' ? allow : [],
      block: mode === 'blocklist' ? block : [],
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
      labelledBy="focus-duration"
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
        <SessionCard key={s.id} s={s} groups={groups} onChange={onChange} />
      ))}
      {lists && (
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
              onChange={(kind) => keep({ kind })}
              label={t('focus.mode')}
              class="grid"
              itemClass="choice compact"
              options={(Object.keys(MODES) as FocusKind[]).map((value) => ({ value }))}
              render={(o) => (
                <>
                  <Icon name={MODES[o.value]} />
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
              <p class="help">{t(mode === 'blocklist' ? 'focus.blocklistHelp' : 'focus.allowlistHelp')}</p>
              {/* One editor per list: an address half typed in one does not move to the other. */}
              <TargetsEditor
                key={mode}
                targets={mode === 'blocklist' ? block : allow}
                onChange={(next) => keep(mode === 'blocklist' ? { block: next } : { allow: next })}
                onClear={() => clear(mode === 'blocklist' ? 'block' : 'allow')}
              />
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
            {/* The breaks are those of the rules: a list session has none. */}
            {mode === 'groups' && (
              <Toggle checked={noPauses} onChange={setNoPauses} label={t('focus.noPauses')} />
            )}
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
            disabled={(mode === 'groups' && !selected.length) || (mode === 'blocklist' && !blocked)}
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
      <FocusSessions sessions={o?.sessions ?? []} groups={model.config.groups} onChange={reload} />
      <p class="small muted row nowrap" style={{ gap: '8px', alignItems: 'flex-start' }}>
        <Icon name="keyboard" />
        <span>{t('focus.shortcutHelp', { minutes: DEFAULT_SESSION_MINUTES })}</span>
      </p>
    </div>
  );
}
