/**
 * Popup: status first — the state of the current site as a
 * tinted hero with the most useful fact — then quick actions, two taps at most, and
 * the dashboard at the end.
 */

import { render } from 'preact';
import { useState } from 'preact/hooks';
import { type Granularity, targetFor } from '../engine/page-target';
import { isNav } from '../engine/severity';
import { t } from '../i18n/i18n';
import { api, extensionUrl, isAndroid } from '../platform/api';
import { formatWhen } from '../shared/format';
import type { DecisionView, PopupModel } from '../shared/models';
import { call } from '../shared/rpc';
import { describeIntervention, describeTarget, setWeekStart } from '../shared/summary';
import {
  Banner,
  Button,
  ColorDot,
  IconButton,
  Progress,
  RadioCards,
  Spinner,
  Toasts,
  ToneIcon,
  toast,
} from '../ui/components';
import { budgetText, Explain } from '../ui/explain';
import { bootPage, useModel, useNow } from '../ui/hooks';
import { BrakeLogo, Icon } from '../ui/icons';
import { breakSubject, PauseDialog, pauseSummary } from '../ui/pause';
import { useSaveFlow } from '../ui/saveflow';
import { interventionIcon, siteStatus, toneOf } from '../ui/status';

/**
 * Opens a dashboard page, then closes the popup. Closing first could drop the request: when the
 * browser has stopped the background, the message waits for it to start and dies with the popup.
 */
function openDashboard(route = '') {
  const close = () => window.close();
  call('tabs.open', { url: extensionUrl(`dashboard.html${route ? `#${route}` : ''}`) }).then(close, close);
}

/** The next change for the current site, with the icon of what comes next. */
function NextLine({ d, now }: { d: DecisionView; now: number }) {
  if (isNav(d)) {
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
      {d && (d.groups.length > 0 || d.excepted.length > 0) && (
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

/** What adding the page to a rule will do: block it now (and until when), from a time, or not at all. */
function addOutcome(g: PopupModel['groups'][number] | undefined): string {
  if (!g) return t('popup.add.outcomeNew');
  if (g.blocksNow && g.change) return t('popup.add.outcomeUntil', { when: formatWhen(g.change) });
  if (g.blocksNow) return t('popup.add.outcomeNow');
  if (g.change) return t('popup.add.outcomeLater', { rule: g.name, when: formatWhen(g.change) });
  return t('popup.add.outcomeNever', { rule: g.name });
}

function AddSite({ m, onDone, onCancel }: { m: PopupModel; onDone: () => void; onCancel: () => void }) {
  const [granularity, setGranularity] = useState<Granularity>('domain');
  // A rule that blocks the page right now, or a new one: "Block" should block.
  const [groupId, setGroupId] = useState<string>(m.addTo ?? 'new');
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
        newGroupName: name,
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
              {/* The same address can mean a site with its subdomains or without, a section or one page. */}
              <span class="scope">{t(`popup.add.${o.value}.scope`)}</span>
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
          placeholder={t('addPage.newGroupName')}
          aria-label={t('popup.add.newGroupName')}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      )}
      <p class="small text-2" aria-live="polite">
        {addOutcome(m.groups.find((g) => g.id === groupId))}
      </p>
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

/**
 * Test build only: a headless browser has no toolbar, so the end-to-end suite opens the popup in a
 * tab and names the tab it is for (popup.html?tab=<id>).
 */
const forTab = __TEST__ ? Number(new URLSearchParams(location.search).get('tab')) || undefined : undefined;

/**
 * The tab the popup is for: the active tab of its own window, named to the background. In Chrome
 * the private windows have a background of their own (background/bridge.ts), and the current
 * window of the main one can be another window.
 */
async function ownTab(): Promise<number | undefined> {
  if (forTab !== undefined) return forTab;
  const [tab] = (await api.tabs.query({ active: true, currentWindow: true }).catch(() => [])) ?? [];
  return tab?.id;
}

function App({ tabId }: { tabId?: number }) {
  const { data: m, reload, error } = useModel('popup.get', tabId !== undefined ? { tabId } : {}, [], 5000);
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
  const groupName = (id: string) => m.groups.find((g) => g.id === id)?.name;
  const figures = m.today.impulses > 0 || m.laterCount > 0;
  return (
    <div class="popup">
      <header class="popup-head">
        <BrakeLogo size={22} />
        <span class="brand-name">WebHandbrake</span>
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
                  {pause.available ? pauseSummary(pause) : pause.reason ? t(pause.reason) : ''}
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
                <span class="row nowrap small" style={{ gap: '8px', minWidth: 0 }}>
                  <ToneIcon tone="calm" icon="pause" size={26} />
                  <span class="stack break-subject" style={{ gap: 0 }}>
                    <span>{breakSubject(p, groupName)}</span>
                    {p.until !== undefined && (
                      <span class="text-2">{t('pause.leftUntil', { when: formatWhen(p.until, now) })}</span>
                    )}
                  </span>
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
      </div>
      {/*
       * The one way to the dashboard, always in view, with today's figures it opens on. The button
       * is named by its label alone and stretches over the whole bar (whole-card link).
       */}
      <footer class="foot">
        <div class="open-dashboard card-link">
          <span class="open-dashboard-icon">
            <Icon name="dashboard" />
          </span>
          <div class="stack stack-xs grow" style={{ minWidth: 0 }}>
            <button
              type="button"
              class="stretched open-dashboard-name"
              aria-describedby={figures ? 'open-dashboard-today' : undefined}
              onClick={() => openDashboard()}
            >
              {t('popup.dashboard')}
            </button>
            {figures && (
              <span id="open-dashboard-today" class="stack stack-xs">
                {m.today.impulses > 0 && (
                  <span class="tiny muted">{t('popup.impulses', { count: m.today.impulses })}</span>
                )}
                {m.laterCount > 0 && (
                  <span class="tiny muted">{t('popup.laterCount', { count: m.laterCount })}</span>
                )}
              </span>
            )}
          </div>
          <Icon name="arrow-right" />
        </div>
      </footer>
      {pausing && pause && (
        <PauseDialog options={pause} url={m.tab?.url} onClose={() => setPausing(false)} onStarted={reload} />
      )}
      <Toasts />
    </div>
  );
}

// On Android the button opens the dashboard (background/toolbar.ts): the popup shows only if it is
// tapped before the background has started, and goes to the dashboard as well.
if (isAndroid) openDashboard();
else
  void Promise.all([bootPage(), ownTab()]).then(([s, tabId]) => {
    setWeekStart(s.weekStart);
    render(<App tabId={tabId} />, document.getElementById('app')!);
  });
