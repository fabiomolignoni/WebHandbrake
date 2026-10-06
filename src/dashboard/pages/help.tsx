/** Offline help (ONB-03, ONB-06): everything needed to use WebHandbrake, available without network. */

import { t } from '../../i18n/i18n';
import { api } from '../../platform/api';
import { NEW_ISSUE_URL, REPO_URL } from '../../shared/links';
import { Icon } from '../../ui/icons';

const SECTIONS: { id: string; paragraphs: number }[] = [
  { id: 'start', paragraphs: 3 },
  { id: 'groups', paragraphs: 3 },
  { id: 'rules', paragraphs: 4 },
  { id: 'interventions', paragraphs: 3 },
  { id: 'pauses', paragraphs: 2 },
  { id: 'focus', paragraphs: 2 },
  { id: 'protection', paragraphs: 4 },
  { id: 'emergency', paragraphs: 2 },
  { id: 'privacy', paragraphs: 2 },
  { id: 'mobile', paragraphs: 2 },
];

const SYNTAX: [string, string][] = [
  ['youtube.com', 'help.syntax.domain'],
  ['amazon.*', 'help.syntax.countries'],
  ['=m.youtube.com', 'help.syntax.host'],
  ['reddit.com/r/funny', 'help.syntax.path'],
  ['example.com/page$', 'help.syntax.page'],
  ['example.com/$', 'help.syntax.homepage'],
  ['reddit.com/r/*/comments/*', 'help.syntax.wildcard'],
  ['news.*/sport/**', 'help.syntax.doubleWildcard'],
  ['youtube.com/watch?list=*', 'help.syntax.query'],
  ['+reddit.com/r/rust', 'help.syntax.exception'],
  ['/^https?:\\/\\/(www\\.)?example\\.com\\/a+$/', 'help.syntax.regex'],
  ['# comment', 'help.syntax.comment'],
  ['||example.com^  ·  *://*.example.com/*', 'help.syntax.import'],
];

const FAQ = ['private', 'flash', 'locked', 'android', 'sync', 'uninstall'];

export function HelpPage() {
  const version = api.runtime.getManifest().version;
  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <h1>{t('help.title')}</h1>
          <p>{t('help.subtitle')}</p>
        </div>
      </div>
      <nav class="card" aria-label={t('help.contents')}>
        <ul class="row" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                class="link-btn"
                onClick={() => document.getElementById(`help-${s.id}`)?.scrollIntoView()}
              >
                {t(`help.${s.id}.title`)}
              </button>
            </li>
          ))}
          {(['faq', 'about'] as const).map((id) => (
            <li key={id}>
              <button
                type="button"
                class="link-btn"
                onClick={() => document.getElementById(`help-${id}`)?.scrollIntoView()}
              >
                {t(`help.${id}`)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {SECTIONS.map((s) => (
        <section key={s.id} id={`help-${s.id}`} class="card stack">
          <h2>{t(`help.${s.id}.title`)}</h2>
          {Array.from({ length: s.paragraphs }, (_, i) => (
            <p key={i}>{t(`help.${s.id}.p${i + 1}`)}</p>
          ))}
          {s.id === 'groups' && (
            <table class="table">
              <thead>
                <tr>
                  <th>{t('help.syntax.entry')}</th>
                  <th>{t('help.syntax.meaning')}</th>
                </tr>
              </thead>
              <tbody>
                {SYNTAX.map(([code, key]) => (
                  <tr key={code}>
                    <td>
                      <code>{code}</code>
                    </td>
                    <td>{t(key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      <section id="help-faq" class="card stack">
        <h2>{t('help.faq')}</h2>
        {FAQ.map((f) => (
          <details key={f} class="disclosure">
            <summary>{t(`help.faq.${f}.q`)}</summary>
            <div class="body">
              <p>{t(`help.faq.${f}.a`)}</p>
            </div>
          </details>
        ))}
      </section>
      <section class="card stack">
        <h2>{t('help.shortcuts')}</h2>
        <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
          <li>
            <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> — {t('help.shortcut.popup')}
          </li>
          <li>
            <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> — {t('help.shortcut.focus')}
          </li>
          <li>
            <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> — {t('help.shortcut.block')}
          </li>
        </ul>
        <p class="small muted">{t('help.shortcutsNote')}</p>
      </section>
      <section id="help-about" class="card stack">
        <h2>{t('help.about')}</h2>
        <p>{t('help.aboutBody', { version })}</p>
        <ul class="list link-list">
          <li>
            <a class="link-row" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              <Icon name="code" />
              <span class="stack stack-xs grow">
                <strong>{t('help.source')}</strong>
                <span class="small muted">{REPO_URL.replace('https://', '')}</span>
              </span>
              <Icon name="external" />
              <span class="sr-only">{t('common.newTab')}</span>
            </a>
          </li>
          <li>
            <a class="link-row" href={NEW_ISSUE_URL} target="_blank" rel="noopener noreferrer">
              <Icon name="chat" />
              <span class="stack stack-xs grow">
                <strong>{t('help.issue')}</strong>
                <span class="small muted">{t('help.issueHelp')}</span>
              </span>
              <Icon name="external" />
              <span class="sr-only">{t('common.newTab')}</span>
            </a>
          </li>
        </ul>
        <p class="small muted">{t('help.license')}</p>
      </section>
    </div>
  );
}
