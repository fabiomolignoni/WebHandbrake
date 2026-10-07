/**
 * Popup (§8.4.1, docs/ux-redesign.md §6.1): status first — the state of the current site as a
 * tinted hero with the most useful fact — then quick actions and focus, two taps at most (FOC-01).
 */

import { render } from 'preact';
import { useState } from 'preact/hooks';
import { type Granularity, targetFor } from '../engine/page-target';
import { t } from '../i18n/i18n';
import { extensionUrl, isAndroid } from '../platform/api';
import { formatDuration, formatWhen } from '../shared/format';
import type { DecisionView, PopupModel, TicketView } from '../shared/models';
import { call } from '../shared/rpc';
import { describeIntervention, describeTarget, setWeekStart } from '../shared/summary';
import {
  Banner,
  Button,
  ColorDot,
  FrictionMeter,
  IconButton,
  Progress,
  RadioCards,
  Ring,
  Segmented,
  Spinner,
  Toasts,
  ToneIcon,
  toast,
} from '../ui/components';
import { budgetText, Explain } from '../ui/explain';
import { bootPage, useModel, useNow } from '../ui/hooks';
import { BrakeLogo, Icon } from '../ui/icons';
import { costsLabel, PauseDialog, pauseBudgetLabel } from '../ui/pause';
import { useSaveFlow } from '../ui/saveflow';
import { interventionIcon, meterLevel, siteStatus, toneOf } from '../ui/status';
import { TicketDialog } from '../ui/ticket';

function openDashboard(route = '') {
  void call('tabs.open', { url: extensionUrl(`dashboard.html${route ? `#${route}` : ''}`) });
  window.close();
}

/** The next change for the current site, with the icon of what comes next. */
function NextLine({ d, now }: { d: DecisionView; now: number }) {
  if (d.severity >= 4) {
    if (!d.until) return null;
    return (
      <p class="then">
        <Icon name="clock" />
        {t('why.nextChange', {
          when: formatWhen(d.until, now),
          what: d.next ? describeIntervention(d.next) : '',
        })}
      </p>
    );
  }
  if (!d.restriction || !d.groups.length) return null;
  const next = d.restriction.intervention;
  return (
    <p class={`then tone-${toneOf(next.type)}`}>
      <span style={{ color: 'var(--tone)', display: 'inline-flex' }}>
        <Icon name={interventionIcon(next.type)} />
      </span>
      {t(`why.restriction.${d.restriction.kind}`, {
        when: formatWhen(d.restriction.at, now),
        what: describeIntervention(next),
      })}
    </p>
  );
}

function Hero({ m, reload }: { m: PopupModel; reload: () => void }) {
  const [why, setWhy] = useState(false);
  const [forfeit, setForfeit] = useState(false);
  const now = useNow(1000);
  const d = m.decision;
  const s = siteStatus(m.tab ? d : null, now);
  const primary = d?.groups[0];
  const budget =
    primary?.policies.find((p) => p.budget && p.scheduleActive && !p.budget.exhausted)?.budget ?? null;
  const pausedHere = m.activePauses.find((p) => d?.groups.some((g) => g.pause?.id === p.id));
  const level = meterLevel(s.tone);
  return (
    <section class={`hero tone-${s.tone}`} aria-label={t('popup.currentSite')}>
      <div class="hero-top">
        <ToneIcon tone={s.tone} icon={s.icon} size={40} />
        <div class="stack stack-xs" style={{ minWidth: 0 }}>
          {m.tab && d && !d.exempt && (
            <span class="host ellipsis" title={d.host}>
              {d.host}
              {m.tab.incognito && (
                <span class="tag" style={{ marginInlineStart: '6px' }}>
                  {t('popup.private')}
                </span>
              )}
            </span>
          )}
          <span class="status">{s.title}</span>
        </div>
        {level > 0 && <FrictionMeter level={level} tone={s.tone} />}
      </div>
      {budget && (
        <div class="stack stack-xs">
          <Progress value={budget.used} max={budget.limit} label={budgetText(budget)} />
          <div class="row between small">
            <span class="text-2">{budgetText(budget)}</span>
            {!forfeit && (
              <button type="button" class="link-btn" onClick={() => setForfeit(true)}>
                {t('popup.forfeit')}
              </button>
            )}
          </div>
        </div>
      )}
      {forfeit && primary && (
        <div class="hero-why stack stack-sm">
          <span>{t('popup.forfeitConfirm', { group: primary.name })}</span>
          <div class="row">
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
        </div>
      )}
      {d && <NextLine d={d} now={now} />}
      {pausedHere && (
        <div class="row">
          <Button
            size="small"
            icon="x"
            onClick={async () => {
              await call('pause.cancel', { grantId: pausedHere.id });
              reload();
            }}
          >
            {t('popup.endPause')}
          </Button>
        </div>
      )}
      {d && (d.groups.length > 0 || d.excepted.length > 0 || d.allowlisted) && (
        <div class="hero-foot">
          <div class="row" style={{ gap: '4px 10px' }}>
            {d.groups.map((g) => (
              <span key={g.groupId} class="row nowrap small text-2" style={{ gap: '6px' }}>
                <ColorDot color={g.color} />
                {g.name}
              </span>
            ))}
          </div>
          <button type="button" class="link-btn" aria-expanded={why} onClick={() => setWhy(!why)}>
            {t('popup.why')}
          </button>
        </div>
      )}
      {why && d && (
        <div class="hero-why">
          <Explain d={d} />
        </div>
      )}
    </section>
  );
}

function AddSite({ m, onDone, onCancel }: { m: PopupModel; onDone: () => void; onCancel: () => void }) {
  const [granularity, setGranularity] = useState<Granularity>('domain');
  const [groupId, setGroupId] = useState<string>(m.groups[0]?.id ?? 'new');
  const [name, setName] = useState('');
  const flow = useSaveFlow();
  const url = m.tab?.url ?? '';
  const options: { value: Granularity; label: string }[] = [
    { value: 'domain', label: t('popup.add.domain') },
    { value: 'host', label: t('popup.add.host') },
    { value: 'path', label: t('popup.add.path') },
    { value: 'page', label: t('popup.add.page') },
  ];
  const preview = (g: Granularity) => {
    const tg = targetFor(url, g);
    return tg ? describeTarget(tg) : '';
  };
  // Hide granularities that give the same entry as a broader one (e.g. "This section" on a home page).
  const seen = new Set<string>();
  const distinct = options.filter((o) => {
    const p = `${targetFor(url, o.value)?.type}|${preview(o.value)}`;
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  const add = async () => {
    const ok = await flow.run(
      call('config.addPage', {
        url,
        granularity,
        groupId: groupId === 'new' ? null : groupId,
        newGroupName: name || m.tab!.host,
      }),
    );
    if (ok) onDone();
  };
  return (
    <section class="panel" aria-labelledby="add-title">
      <div class="row between nowrap">
        <strong id="add-title">{t('popup.add.title')}</strong>
        <IconButton icon="x" label={t('common.close')} variant="ghost" size="small" onClick={onCancel} />
      </div>
      <RadioCards
        value={granularity}
        onChange={setGranularity}
        label={t('popup.add.what')}
        class="granularity"
        itemClass="choice"
        options={distinct}
        render={(o, checked) => (
          <>
            <span class="radio-dot" aria-hidden="true" />
            <span class="stack stack-xs grow" style={{ minWidth: 0 }}>
              <span class={checked ? 'strong' : ''}>{options.find((x) => x.value === o.value)?.label}</span>
              <span class="value">{preview(o.value)}</span>
            </span>
          </>
        )}
      />
      <div class="field">
        <label for="add-group" class="small">
          {t('popup.add.group')}
        </label>
        <select
          id="add-group"
          class="select"
          value={groupId}
          onChange={(e) => setGroupId((e.target as HTMLSelectElement).value)}
        >
          {m.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="new">{t('popup.add.newGroup')}</option>
        </select>
      </div>
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
        <Button variant="ghost" size="small" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="small" icon="plus" onClick={add}>
          {t('popup.add.action')}
        </Button>
      </div>
      {flow.element}
    </section>
  );
}

function FocusPanel({ m, reload }: { m: PopupModel; reload: () => void }) {
  const [minutes, setMinutes] = useState<number>(m.quickMinutes[0]);
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const now = useNow(1000);
  const active = m.sessions.find((s) => s.startAt <= now && now < s.endAt);
  const upcoming = m.sessions.find((s) => s.startAt > now);
  if (active) {
    const total = active.endAt - active.startAt;
    const left = Math.max(0, active.endAt - now);
    return (
      <section class="panel tone-protected" aria-label={t('popup.focus')}>
        <div class="session-compact">
          <Ring value={total > 0 ? left / total : 0}>{Math.ceil(left / 60_000)}</Ring>
          <div class="stack stack-xs grow">
            <strong>{t('popup.focusUntil', { when: formatWhen(active.endAt, now) })}</strong>
            <span class="small text-2">{t('focus.left', { duration: formatDuration(left / 1000) })}</span>
          </div>
          {active.locked && (
            <span class="tag" title={t('focus.lockedHelp')}>
              <Icon name="lock" /> {t('focus.locked')}
            </span>
          )}
        </div>
        <div class="row">
          <Button
            size="small"
            icon="plus"
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
  // A quick session applies the rules marked for it: with none, it would look active and block nothing.
  if (!m.canFocus) return null;
  return (
    <section class="panel" aria-labelledby="focus-title">
      <div class="row between">
        <strong id="focus-title" class="row nowrap" style={{ gap: '6px' }}>
          <Icon name="target" />
          {t('popup.focus')}
        </strong>
        {upcoming && (
          <span class="tiny muted">
            {t('popup.focusStarts', { when: formatWhen(upcoming.startAt, now) })}
          </span>
        )}
      </div>
      <Segmented
        block
        value={minutes}
        onChange={setMinutes}
        label={t('popup.focusDuration')}
        options={m.quickMinutes.map((n) => ({ value: n, label: t('common.minutes', { n }) }))}
      />
      <Button
        block
        variant="primary"
        icon="play"
        onClick={async () => {
          await call('session.start', {
            kind: 'groups',
            groups: [],
            allow: [],
            minutes,
            locked: false,
            noPauses: false,
          });
          toast(t('focus.started', { minutes }));
          reload();
        }}
      >
        {t('popup.startFocus')}
      </Button>
    </section>
  );
}

/**
 * Test build only: a headless browser has no toolbar, so the end-to-end suite opens the popup in a
 * tab and names the tab it is for (popup.html?tab=<id>).
 */
const forTab = __TEST__ ? Number(new URLSearchParams(location.search).get('tab')) || undefined : undefined;

function App() {
  const {
    data: m,
    reload,
    error,
  } = useModel('popup.get', forTab !== undefined ? { tabId: forTab } : {}, [], 5000);
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
  const otherPauses = m.activePauses.filter((p) => !m.decision?.groups.some((g) => g.pause?.id === p.id));
  const tiles = (pause ? 1 : 0) + (m.canAdd ? 2 : 0);
  return (
    <div class="popup">
      <header class="popup-head">
        <BrakeLogo size={22} />
        <span class="sr-only">WebHandbrake</span>
        <button
          type="button"
          class="level"
          onClick={() => openDashboard('/protection')}
          title={t('popup.levelTitle')}
        >
          <Icon name="shield" />
          {t(`level.${m.level}`)}
          {m.pendingReady > 0 && (
            <span class="sr-only">{t('popup.pendingReady', { count: m.pendingReady })}</span>
          )}
        </button>
        <span class="grow" />
        <Button
          variant="primary"
          icon="dashboard"
          size="small"
          class="open-dashboard"
          title={t('popup.openDashboard')}
          onClick={() => openDashboard()}
        >
          {t('popup.dashboard')}
        </Button>
      </header>
      <div class="popup-body">
        {!m.onboarded && (
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
        )}
        {m.warnings.map((w) => (
          <Banner key={w.kind} kind="warning">
            {t(`warning.${w.kind}.short`)}
          </Banner>
        ))}
        <Hero m={m} reload={reload} />
        {tiles > 0 && (
          <div
            class="action-tiles"
            role="group"
            aria-label={t('popup.actions')}
            style={{ gridTemplateColumns: `repeat(${tiles}, minmax(0, 1fr))` }}
          >
            {pause && (
              <button
                type="button"
                class="action-tile"
                disabled={!pause.available}
                onClick={() => setPausing(true)}
              >
                <Icon name="pause" />
                {t('popup.pause')}
                <span class="sub">
                  {pause.available
                    ? [costsLabel(pause.costs), pauseBudgetLabel(pause)].filter(Boolean).join(' · ')
                    : pause.reason
                      ? t(pause.reason)
                      : ''}
                </span>
              </button>
            )}
            {m.canAdd && (
              <button
                type="button"
                class="action-tile"
                onClick={async () => {
                  await call('later.add', { url: m.tab!.url, title: m.tab!.title });
                  toast(t('popup.savedLater'));
                  reload();
                }}
              >
                <Icon name="bookmark" />
                {t('popup.later')}
              </button>
            )}
            {m.canAdd && (
              <button
                type="button"
                class="action-tile"
                aria-expanded={adding}
                onClick={() => setAdding(!adding)}
              >
                <Icon name="plus" />
                {t('popup.blockSite')}
              </button>
            )}
          </div>
        )}
        {adding && (
          <AddSite
            m={m}
            onCancel={() => setAdding(false)}
            onDone={() => {
              setAdding(false);
              reload();
            }}
          />
        )}
        {(otherPauses.length > 0 || m.restorable > 0 || m.pendingReady > 0) && (
          <section class="panel" aria-label={t('popup.status')}>
            {otherPauses.map((p) => (
              <div key={p.id} class="row between nowrap">
                <span class="row nowrap small" style={{ gap: '8px' }}>
                  <ToneIcon tone="calm" icon="pause" size={26} />
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
              <button
                type="button"
                class="link-btn small"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => openDashboard('/protection')}
              >
                {t('popup.pendingReady', { count: m.pendingReady })}
              </button>
            )}
          </section>
        )}
        <FocusPanel m={m} reload={reload} />
      </div>
      <footer class="foot">
        <span class="stack stack-xs" style={{ minWidth: 0 }}>
          <span>
            <strong class="num">{formatDuration(m.today.seconds)}</strong> {t('popup.todayLimited')}
          </span>
          {(m.today.impulses > 0 || m.laterCount > 0) && (
            <span class="tiny muted">
              {[
                m.today.impulses > 0 ? t('popup.impulses', { count: m.today.impulses }) : '',
                m.laterCount > 0 ? t('popup.laterCount', { count: m.laterCount }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </span>
        <button type="button" class="link-btn nowrap" onClick={() => openDashboard('/insights')}>
          {t('popup.details')} →
        </button>
      </footer>
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
