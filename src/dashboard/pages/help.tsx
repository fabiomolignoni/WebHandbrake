/** Offline help: everything needed to use WebHandbrake, available without network. */

import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n/i18n';
import { api, features, openShortcutSettings, quiet } from '../../platform/api';
import { CHANGELOG_URL, NEW_ISSUE_URL, PRIVACY_URL, REPO_URL } from '../../shared/links';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { HELP_TOPICS, type HelpBlock, type HelpFacts, helpFacts, SHORTCUTS, SYNTAX } from '../help-content';

function SyntaxTable() {
  return (
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
  );
}

/** The keys the browser gave the commands, by command name; null until it answers. */
function useCommandKeys(): Record<string, string> | null {
  const [keys, setKeys] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const read = async () => {
      const all = (await quiet(api.commands.getAll())) ?? [];
      setKeys(Object.fromEntries(all.map((c) => [c.name ?? '', c.shortcut ?? ''])));
    };
    // Read again when the user comes back from the browser's shortcut settings.
    const onVisible = () => document.visibilityState === 'visible' && void read();
    void read();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return keys;
}

/** The commands with the keys the browser gave them; hidden without the commands API. */
function Shortcuts({ facts }: { facts: HelpFacts }) {
  if (!features.commands) return null;
  return <ShortcutList facts={facts} />;
}

function ShortcutList({ facts }: { facts: HelpFacts }) {
  const keys = useCommandKeys();
  if (!keys) return null;
  return (
    <div class="stack stack-sm">
      <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
        {SHORTCUTS.map((s) => {
          const combo = keys[s.command];
          return (
            <li key={s.command}>
              {combo ? (
                combo.split('+').map((k, i) => (
                  <Fragment key={k}>
                    {i > 0 && '+'}
                    <kbd>{k}</kbd>
                  </Fragment>
                ))
              ) : (
                <span class="muted">{t('help.shortcutNone')}</span>
              )}{' '}
              — {t(s.description, s.params?.(facts))}
            </li>
          );
        })}
      </ul>
      <div>
        <Button size="small" icon="keyboard" onClick={() => void quiet(openShortcutSettings())}>
          {t('help.shortcutsChange')}
        </Button>
      </div>
    </div>
  );
}

function Block({ block, facts }: { block: HelpBlock; facts: HelpFacts }) {
  if ('p' in block) return <p>{t(block.p, block.params?.(facts))}</p>;
  if ('list' in block)
    return (
      <ul>
        {block.list.map((key) => (
          <li key={key}>{t(key, block.params?.(facts))}</li>
        ))}
      </ul>
    );
  if ('q' in block)
    return (
      <>
        <h3>{t(block.q, block.params?.(facts))}</h3>
        <p>{t(block.a, block.params?.(facts))}</p>
      </>
    );
  if ('syntax' in block) return <SyntaxTable />;
  return <Shortcuts facts={facts} />;
}

/** A link of the About section; it opens in a new tab and the extension never fetches it. */
function AboutLink({ href, icon, title, sub }: { href: string; icon: string; title: string; sub?: string }) {
  return (
    <li>
      <a class="link-row" href={href} target="_blank" rel="noopener noreferrer">
        <Icon name={icon} />
        <span class="stack stack-xs grow">
          <strong>{title}</strong>
          {sub && <span class="small muted">{sub}</span>}
        </span>
        <Icon name="external" />
        <span class="sr-only">{t('common.newTab')}</span>
      </a>
    </li>
  );
}

/** Help; `topic` (from `#/help/<topic>`) opens it at that topic, with the focus on its heading. */
export function HelpPage({ topic: openAt = null }: { topic?: string | null }) {
  const version = api.runtime.getManifest().version;
  useEffect(() => {
    if (!openAt) return;
    const heading = document.querySelector<HTMLElement>(`#help-${CSS.escape(openAt)} h2`);
    heading?.scrollIntoView();
    heading?.focus({ preventScroll: true });
  }, [openAt]);
  const facts = helpFacts();
  const contents = [
    ...HELP_TOPICS.map((topic) => ({ id: topic.id, title: t(topic.title) })),
    { id: 'about', title: t('help.about') },
  ];
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
          {contents.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                class="link-btn"
                onClick={() => document.getElementById(`help-${c.id}`)?.scrollIntoView()}
              >
                {c.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {HELP_TOPICS.map((topic) => (
        <section key={topic.id} id={`help-${topic.id}`} class="card stack">
          <h2 tabIndex={-1}>{t(topic.title)}</h2>
          {topic.blocks.map((block, i) => (
            <Block key={i} block={block} facts={facts} />
          ))}
        </section>
      ))}
      <section id="help-about" class="card stack">
        <h2>{t('help.about')}</h2>
        <p>{t('help.aboutBody', { version })}</p>
        <ul class="list link-list">
          <AboutLink
            href={REPO_URL}
            icon="code"
            title={t('help.source')}
            sub={REPO_URL.replace('https://', '')}
          />
          <AboutLink href={NEW_ISSUE_URL} icon="chat" title={t('help.issue')} sub={t('help.issueHelp')} />
          <AboutLink href={PRIVACY_URL} icon="shield" title={t('help.privacyPolicy')} />
          <AboutLink href={CHANGELOG_URL} icon="list" title={t('help.changelog')} />
        </ul>
        <p class="small muted">{t('help.license')}</p>
      </section>
    </div>
  );
}
