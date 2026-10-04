/** Offline help (ONB-03, ONB-06): everything needed to use WebHandbrake, available without network. */

import { t } from '../../i18n/i18n';
import { api } from '../../platform/api';
import { Button } from '../../ui/components';
import { navigate } from '../router';

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

const FAQ = ['private', 'flash', 'locked', 'android', 'leechblock', 'sync', 'uninstall'];

export function HelpPage() {
  const version = api.runtime.getManifest().version;
  return (
    <div class="stack stack-lg">
      <div class="page-head">
        <div>
          <h1>{t('help.title')}</h1>
          <p>{t('help.subtitle')}</p>
        </div>
        <Button onClick={() => navigate('/welcome')} icon="sparkle">
          {t('help.rerunSetup')}
        </Button>
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
          <li>
            <button
              type="button"
              class="link-btn"
              onClick={() => document.getElementById('help-faq')?.scrollIntoView()}
            >
              {t('help.faq')}
            </button>
          </li>
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
      <section class="card stack">
        <h2>{t('help.about')}</h2>
        <p>{t('help.aboutBody', { version })}</p>
        <p class="small muted">{t('help.license')}</p>
      </section>
    </div>
  );
}
