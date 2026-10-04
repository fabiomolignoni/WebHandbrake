/** Popup (§8.4.1): state of the current site and quick actions, two taps at most (FOC-01). */

import { render } from 'preact';
import { useState } from 'preact/hooks';
import { t } from '../i18n/i18n';
import { extensionUrl, isAndroid } from '../platform/api';
import { formatDuration, formatWhen } from '../shared/format';
import type { PopupModel, TicketView } from '../shared/models';
import { call, type Granularity } from '../shared/rpc';
import { interventionName, setWeekStart } from '../shared/summary';
import {
  Banner,
  Button,
  Chips,
  ColorDot,
  IconButton,
  Progress,
  Select,
  Spinner,
  Toasts,
  toast,
} from '../ui/components';
import { budgetText, Explain, verdict } from '../ui/explain';
import { bootPage, useModel, useNow } from '../ui/hooks';
import { BrakeLogo } from '../ui/icons';
import { costsLabel, PauseDialog, pauseBudgetLabel } from '../ui/pause';
import { useSaveFlow } from '../ui/saveflow';
import { TicketDialog } from '../ui/ticket';

function openDashboard(route = '') {
  void call('tabs.open', { url: extensionUrl(`dashboard.html${route ? `#${route}` : ''}`) });
  window.close();
}

function SiteCard({ m, reload }: { m: PopupModel; reload: () => void }) {
  const [why, setWhy] = useState(false);
  const [forfeit, setForfeit] = useState(false);
  const now = useNow(1000);
  const d = m.decision;
  if (!m.tab || !d) {
    return (
      <section class="popup-section" aria-label={t('popup.currentSite')}>
        <p class="muted">{t('popup.noPage')}</p>
      </section>
    );
  }
  const primary = d.groups[0];
  const budget =
    primary?.policies.find((p) => p.budget && p.scheduleActive && !p.budget.exhausted)?.budget ?? null;
  return (
    <section class="popup-section" aria-label={t('popup.currentSite')}>
      <div class="row between nowrap">
        <strong class="ellipsis" title={d.host}>
          {d.host}
        </strong>
        {m.tab.incognito && <span class="tag">{t('popup.private')}</span>}
      </div>
      {d.groups.length > 0 ? (
        <div class="row">
          {d.groups.map((g) => (
            <span key={g.groupId} class="row nowrap" style={{ gap: '6px' }}>
              <ColorDot color={g.color} />
              <span class="small">{g.name}</span>
            </span>
          ))}
        </div>
      ) : (
        !d.exempt && <p class="small muted">{d.excepted.length ? t('why.excepted') : t('popup.noRules')}</p>
      )}
      {budget && (
        <div class="stack stack-sm">
          <Progress
            value={budget.used}
            max={budget.limit}
            label={budgetText(budget)}
            tone={budget.remaining < 300 && budget.type !== 'visits' ? 'warning' : undefined}
          />
          <div class="row between">
            <span class="small text-2">{budgetText(budget)}</span>
            {!forfeit && (
              <button type="button" class="link-btn tiny" onClick={() => setForfeit(true)}>
                {t('popup.forfeit')}
              </button>
            )}
          </div>
          {forfeit && primary && (
            <div class="row">
              <span class="small">{t('popup.forfeitConfirm', { group: primary.name })}</span>
              <Button
                size="small"
                variant="primary"
                onClick={async () => {
                  await call('budget.forfeit', { groupId: primary.groupId });
                  setForfeit(false);
                  toast(t('popup.forfeitDone'));
                  reload();
                }}
              >
                {t('popup.forfeitYes')}
              </Button>
              <Button size="small" variant="ghost" onClick={() => setForfeit(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          )}
        </div>
      )}
      <p class="small">
        {verdict(d, now)}
        {d.restriction && d.severity < 4 && d.groups.length > 0 && (
          <span class="muted">
            {' '}
            · {t('popup.then', { what: interventionName(d.restriction.intervention.type) })}
          </span>
        )}
      </p>
      {(d.groups.length > 0 || d.excepted.length > 0 || d.allowlisted) && (
        <button
          type="button"
          class="link-btn small"
          aria-expanded={why}
          onClick={() => setWhy(!why)}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('popup.why')}
        </button>
      )}
      {why && <Explain d={d} />}
    </section>
  );
}

function FocusCard({ m, reload }: { m: PopupModel; reload: () => void }) {
  const [minutes, setMinutes] = useState(String(m.quickMinutes[0]));
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const now = useNow(1000);
  const active = m.sessions.find((s) => s.startAt <= now && now < s.endAt);
  const upcoming = m.sessions.find((s) => s.startAt > now);
  if (active) {
    return (
      <section class="popup-section" aria-label={t('popup.focus')}>
        <div class="row between">
          <strong>{t('popup.focusUntil', { when: formatWhen(active.endAt, now) })}</strong>
          {active.locked && <span class="tag">{t('focus.locked')}</span>}
        </div>
        <div class="row">
          <Button
            size="small"
            onClick={async () => {
              await call('session.extend', { id: active.id, minutes: 15 });
              reload();
            }}
          >
            {t('focus.extend', { minutes: 15 })}
          </Button>
          {!active.locked && (
            <Button
              size="small"
              variant="ghost"
              onClick={async () => {
                const r = await call('session.end', { id: active.id });
                if (r.refused) toast(t(r.refused));
                else if (r.ticket) setTicket(r.ticket);
              }}
            >
              {t('focus.end')}
            </Button>
          )}
        </div>
        {ticket && (
          <TicketDialog
            ticket={ticket}
            title={t('focus.endTitle')}
            onDone={() => {
              setTicket(null);
              reload();
            }}
            onCancel={() => setTicket(null)}
          />
        )}
      </section>
    );
  }
  return (
    <section class="popup-section" aria-label={t('popup.focus')}>
      <div class="row nowrap">
        <Button
          variant="primary"
          icon="play"
          class="grow"
          onClick={async () => {
            await call('session.start', {
              kind: 'groups',
              groups: [],
              allow: [],
              minutes: Number(minutes),
              locked: false,
              noPauses: false,
            });
            toast(t('focus.started', { minutes: Number(minutes) }));
            reload();
          }}
        >
          {t('popup.startFocus')}
        </Button>
        <span style={{ width: '120px' }}>
          <Select
            value={minutes}
            onChange={setMinutes}
            label={t('popup.focusDuration')}
            options={m.quickMinutes.map((n) => ({ value: String(n), label: t('common.minutes', { n }) }))}
          />
        </span>
      </div>
      {upcoming && (
        <p class="small muted">{t('popup.focusStarts', { when: formatWhen(upcoming.startAt, now) })}</p>
      )}
    </section>
  );
}

function AddSite({ m, onDone }: { m: PopupModel; onDone: () => void }) {
  const [granularity, setGranularity] = useState<Granularity>('domain');
  const [groupId, setGroupId] = useState<string>(m.groups[0]?.id ?? 'new');
  const [name, setName] = useState('');
  const flow = useSaveFlow();
  const add = async () => {
    const ok = await flow.run(
      call('config.addPage', {
        url: m.tab!.url,
        granularity,
        groupId: groupId === 'new' ? null : groupId,
        newGroupName: name || m.tab!.host,
      }),
    );
    if (ok) onDone();
  };
  return (
    <div class="stack stack-sm card flat tight">
      <span class="label small">{t('popup.add.what')}</span>
      <Chips
        value={granularity}
        onChange={setGranularity}
        label={t('popup.add.what')}
        options={[
          { value: 'domain', label: t('popup.add.domain') },
          { value: 'host', label: t('popup.add.host') },
          { value: 'path', label: t('popup.add.path') },
          { value: 'page', label: t('popup.add.page') },
        ]}
      />
      <label class="label small" for="add-group">
        {t('popup.add.group')}
      </label>
      <Select
        id="add-group"
        value={groupId}
        onChange={setGroupId}
        options={[
          ...m.groups.map((g) => ({ value: g.id, label: g.name })),
          { value: 'new', label: t('popup.add.newGroup') },
        ]}
      />
      {groupId === 'new' && (
        <input
          class="input"
          value={name}
          placeholder={m.tab?.host}
          aria-label={t('popup.add.newGroupName')}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      )}
      <div class="row end">
        <Button variant="primary" size="small" onClick={add}>
          {t('popup.add.action')}
        </Button>
      </div>
      {flow.element}
    </div>
  );
}

function App() {
  const { data: m, reload, error } = useModel('popup.get', {}, [], 5000);
  const [adding, setAdding] = useState(false);
  const [pausing, setPausing] = useState(false);
  const now = useNow(1000);
  if (error)
    return (
      <div class="popup popup-section">
        <Banner kind="danger">{error}</Banner>
      </div>
    );
  if (!m)
    return (
      <div class="popup popup-section">
        <Spinner />
      </div>
    );
  const pause = m.pause;
  return (
    <div class="popup">
      <header class="popup-head">
        <BrakeLogo size={24} />
        <strong class="grow">WebHandbrake</strong>
        <IconButton
          icon="settings"
          label={t('popup.openDashboard')}
          variant="ghost"
          size="small"
          onClick={() => openDashboard()}
        />
        <IconButton
          icon="help"
          label={t('nav.help')}
          variant="ghost"
          size="small"
          onClick={() => openDashboard('/help')}
        />
      </header>
      {!m.onboarded && (
        <section class="popup-section">
          <Banner
            kind="accent"
            action={
              <Button size="small" variant="primary" onClick={() => openDashboard('/welcome')}>
                {t('popup.setup')}
              </Button>
            }
          >
            {t('popup.notSetUp')}
          </Banner>
        </section>
      )}
      {m.warnings.map((w) => (
        <section class="popup-section" key={w.kind}>
          <Banner kind="warning">{t(`warning.${w.kind}.short`)}</Banner>
        </section>
      ))}
      <SiteCard m={m} reload={reload} />
      <FocusCard m={m} reload={reload} />
      {(m.canAdd || pause || m.activePauses.length > 0 || m.restorable > 0 || m.pendingReady > 0) && (
        <section class="popup-section" aria-label={t('popup.actions')}>
          <div class="row">
            {m.canAdd && (
              <Button size="small" icon="plus" aria-expanded={adding} onClick={() => setAdding(!adding)}>
                {t('popup.blockSite')}
              </Button>
            )}
            {m.canAdd && (
              <Button
                size="small"
                icon="bookmark"
                onClick={async () => {
                  await call('later.add', { url: m.tab!.url, title: m.tab!.title });
                  toast(t('popup.savedLater'));
                }}
              >
                {t('popup.later')}
              </Button>
            )}
            {pause && (
              <Button size="small" icon="pause" disabled={!pause.available} onClick={() => setPausing(true)}>
                {t('popup.pause')}
              </Button>
            )}
          </div>
          {pause && (
            <p class="tiny muted">
              {pause.available
                ? [costsLabel(pause.costs), pauseBudgetLabel(pause)].filter(Boolean).join(' · ')
                : pause.reason
                  ? t(pause.reason)
                  : ''}
            </p>
          )}
          {adding && (
            <AddSite
              m={m}
              onDone={() => {
                setAdding(false);
                reload();
              }}
            />
          )}
          {m.activePauses.map((p) => (
            <div key={p.id} class="row between">
              <span class="small">
                {p.until
                  ? t('popup.pausedUntil', { when: formatWhen(p.until, now) })
                  : t('popup.pausedLeft', { duration: formatDuration(p.remaining ?? 0) })}
              </span>
              <Button
                size="small"
                variant="ghost"
                onClick={async () => {
                  await call('pause.cancel', { grantId: p.id });
                  reload();
                }}
              >
                {t('popup.endPause')}
              </Button>
            </div>
          ))}
          {m.restorable > 0 && (
            <Button
              size="small"
              icon="refresh"
              onClick={async () => {
                const r = await call('tabs.reopenBlocked', {});
                toast(t('popup.reopened', { count: r.reopened }));
                reload();
              }}
            >
              {t('popup.reopen', { count: m.restorable })}
            </Button>
          )}
          {m.pendingReady > 0 && (
            <button type="button" class="link-btn small" onClick={() => openDashboard('/protection')}>
              {t('popup.pendingReady', { count: m.pendingReady })}
            </button>
          )}
        </section>
      )}
      <section class="popup-section">
        <p class="small">{t('popup.today', { duration: formatDuration(m.today.seconds) })}</p>
        {m.today.impulses > 0 && (
          <p class="small text-2">{t('popup.impulses', { count: m.today.impulses })}</p>
        )}
        <div class="row between">
          {m.laterCount > 0 ? (
            <button type="button" class="link-btn small" onClick={() => openDashboard('/later')}>
              {t('popup.laterCount', { count: m.laterCount })}
            </button>
          ) : (
            <span />
          )}
          <button type="button" class="link-btn small" onClick={() => openDashboard()}>
            {t('popup.openDashboard')} →
          </button>
        </div>
      </section>
      {pausing && pause && (
        <PauseDialog options={pause} url={m.tab?.url} onClose={() => setPausing(false)} onStarted={reload} />
      )}
      <Toasts />
    </div>
  );
}

// On Android the popup opens as a full page: let it take the whole width.
if (isAndroid) document.documentElement.classList.add('mobile');

void bootPage().then((s) => {
  setWeekStart(s.weekStart);
  render(<App />, document.getElementById('app')!);
});
