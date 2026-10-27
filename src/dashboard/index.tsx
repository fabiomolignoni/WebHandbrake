/** Dashboard: full page management UI, responsive, keyboard accessible. */

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n/i18n';
import { routePage } from '../shared/block-site';
import { whenParams } from '../shared/format';
import type { Overview } from '../shared/models';
import { setWeekStart } from '../shared/summary';
import { Banner, Spinner, Toasts } from '../ui/components';
import { applyAppearance, bootPage, useModel, useNow } from '../ui/hooks';
import { BrakeLogo, Icon } from '../ui/icons';
import { Ctx } from './context';
import { FocusPage } from './pages/focus';
import { GroupEditorPage } from './pages/group-editor';
import { GroupsPage } from './pages/groups';
import { HelpPage } from './pages/help';
import { InsightsPage } from './pages/insights';
import { LaterPage } from './pages/later';
import { NewGroupPage } from './pages/new-group';
import { ProtectionPage } from './pages/protection';
import { SettingsPage } from './pages/settings';
import { TodayPage } from './pages/today';
import { WelcomePage } from './pages/welcome';
import { navigate, useRoute } from './router';

// Primary destinations first, then the less frequent ones.
const NAV_PRIMARY = [
  { id: 'today', icon: 'home', key: 'nav.today' },
  { id: 'groups', icon: 'layers', key: 'nav.groups' },
  { id: 'focus', icon: 'target', key: 'nav.focus' },
  { id: 'insights', icon: 'chart', key: 'nav.insights' },
];
const NAV_SECONDARY = [
  { id: 'later', icon: 'bookmark', key: 'nav.later' },
  { id: 'protection', icon: 'shield', key: 'nav.protection' },
  { id: 'settings', icon: 'settings', key: 'nav.settings' },
  { id: 'help', icon: 'help', key: 'nav.help' },
];
const NAV = [...NAV_PRIMARY, ...NAV_SECONDARY];
const MOBILE_MAIN = ['today', 'groups', 'focus', 'insights'];

function App() {
  const { data: model, reload, error } = useModel('config.get', {});
  const route = useRoute(() => confirm(t('editor.leaveConfirm')));
  const [more, setMore] = useState(false);
  const section = route.path[0] ?? 'today';
  const { data: overview } = useModel('overview.get', {}, [], 60_000);
  const pending = overview?.pending.length ?? 0;

  useEffect(() => {
    if (!model) return;
    applyAppearance(model.config.settings);
    setWeekStart(model.config.settings.weekStart);
    // The first run replaces the landing page only: links to a page (Help from the sites guide,
    // a page opened from the popup) keep working while the setup is in progress.
    if (
      !model.config.settings.onboarded &&
      section === 'today' &&
      !sessionStorage.getItem('whb-skip-welcome')
    )
      navigate('/welcome');
  }, [model]);
  useEffect(() => {
    const titles: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.id, t(n.key)]));
    document.title = `${titles[section] ?? t('nav.welcome')} — WebHandbrake`;
    setMore(false);
  }, [section]);

  if (error)
    return (
      <div class="main">
        <Banner kind="danger">{error}</Banner>
      </div>
    );
  if (!model)
    return (
      <div class="main">
        <Spinner />
      </div>
    );

  const reloadModel = async () => {
    await reload();
  };
  let page: preact.JSX.Element;
  switch (section) {
    case 'groups':
      page =
        route.path[1] === 'new' ? (
          <NewGroupPage
            key={route.query.toString()}
            template={route.query.get('template')}
            page={routePage(route.query)}
          />
        ) : route.path[1] ? (
          <GroupEditorPage key={route.path[1]} id={route.path[1]} step={route.query.get('step')} />
        ) : (
          <GroupsPage />
        );
      break;
    case 'focus':
      page = <FocusPage />;
      break;
    case 'later':
      page = <LaterPage />;
      break;
    case 'insights':
      page = <InsightsPage />;
      break;
    case 'protection':
      page = <ProtectionPage />;
      break;
    case 'settings':
      page = <SettingsPage sub={route.path[1] ?? 'general'} />;
      break;
    case 'help':
      page = <HelpPage topic={route.path[1] ?? null} />;
      break;
    case 'welcome':
      page = <WelcomePage />;
      break;
    default:
      page = <TodayPage />;
  }
  const isCurrent = (id: string) => (section === id ? 'page' : undefined);

  if (section === 'welcome') {
    return (
      <Ctx.Provider value={{ model, reload: reloadModel }}>
        <main class="main" id="main" style={{ margin: '0 auto' }}>
          {page}
        </main>
        <Toasts />
      </Ctx.Provider>
    );
  }
  return (
    <Ctx.Provider value={{ model, reload: reloadModel }}>
      <button
        type="button"
        class="skip-link link-btn"
        onClick={() => document.getElementById('main')?.focus()}
      >
        {t('nav.skip')}
      </button>
      <div class="shell">
        <aside class="sidebar" aria-label={t('nav.sidebar')}>
          <div class="brand">
            <BrakeLogo size={28} />
            <span>WebHandbrake</span>
          </div>
          <nav aria-label={t('nav.label')} class="stack" style={{ gap: '12px' }}>
            {[NAV_PRIMARY, NAV_SECONDARY].map((list, i) => (
              <div class="nav" key={i}>
                {list.map((n) => (
                  <a key={n.id} href={`#/${n.id}`} aria-current={isCurrent(n.id)} title={t(n.key)}>
                    <Icon name={n.icon} />
                    <span class="label">{t(n.key)}</span>
                    <PendingCount id={n.id} count={pending} />
                  </a>
                ))}
              </div>
            ))}
          </nav>
          {overview && <SideStatus o={overview} />}
        </aside>
        <main
          class={`main${['protection', 'settings', 'help', 'focus', 'later'].includes(section) ? ' narrow' : ''}`}
          id="main"
          tabIndex={-1}
        >
          {page}
        </main>
      </div>
      <nav class="bottom-nav" aria-label={t('nav.label')}>
        {NAV.filter((n) => MOBILE_MAIN.includes(n.id)).map((n) => (
          <a key={n.id} href={`#/${n.id}`} aria-current={isCurrent(n.id)}>
            <Icon name={n.icon} />
            <span>{t(n.key)}</span>
          </a>
        ))}
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore(!more)}
          aria-current={!MOBILE_MAIN.includes(section) ? 'page' : undefined}
        >
          <Icon name="more" />
          <span>{t('nav.more')}</span>
          <PendingCount id="protection" count={pending} />
        </button>
      </nav>
      {more && (
        <div class="more-sheet" role="menu">
          {NAV.filter((n) => !MOBILE_MAIN.includes(n.id)).map((n) => (
            <a key={n.id} role="menuitem" href={`#/${n.id}`} onClick={() => setMore(false)}>
              <Icon name={n.icon} />
              {t(n.key)}
              <PendingCount id={n.id} count={pending} />
            </a>
          ))}
        </div>
      )}
      <Toasts />
    </Ctx.Provider>
  );
}

/** Quiet status at the bottom of the sidebar: active session, pending changes. */
function SideStatus({ o }: { o: Overview }) {
  const now = useNow(30_000);
  const session = o.sessions.find((s) => s.startAt <= now && now < s.endAt);
  if (!session && !o.pending.length) return null;
  return (
    <div class="side-status side-extra">
      {session && (
        <a href="#/focus">
          <Icon name="target" />
          <span>{t('nav.status.session', whenParams(session.endAt, now))}</span>
        </a>
      )}
      {o.pending.length > 0 && (
        <a href="#/protection">
          <Icon name="hourglass" />
          <span>{t('nav.pendingCount', { count: o.pending.length })}</span>
        </a>
      )}
    </div>
  );
}

/** Badge with the number of pending changes on "Protection". */
function PendingCount({ id, count }: { id: string; count: number }) {
  if (id !== 'protection' || !count) return null;
  return (
    <span class="count">
      <span aria-hidden="true">{count}</span>
      <span class="sr-only">{t('nav.pendingCount', { count })}</span>
    </span>
  );
}

void bootPage().then((s) => {
  setWeekStart(s.weekStart);
  render(<App />, document.getElementById('app')!);
});
