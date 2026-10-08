/** Offline help (ONB-03, ONB-06): everything needed to use WebHandbrake, available without network. */

import { Fragment } from 'preact';
import { t } from '../../i18n/i18n';
import { api, features } from '../../platform/api';
import { ACCESSIBILITY_URL, CHANGELOG_URL, NEW_ISSUE_URL, PRIVACY_URL, REPO_URL } from '../../shared/links';
import { Icon } from '../../ui/icons';
import {
  defaultShortcut,
  HELP_TOPICS,
  type HelpBlock,
  type HelpFacts,
  helpFacts,
  SHORTCUTS,
  SYNTAX,
} from '../help-content';

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

/** The default keys of the commands (`suggested_key` in the manifest); hidden without the commands API. */
function Shortcuts({ facts }: { facts: HelpFacts }) {
  if (!features.commands) return null;
  const commands = api.runtime.getManifest().commands;
  const rows = SHORTCUTS.flatMap((s) => {
    const combo = defaultShortcut(commands, s.command);
    return combo ? [{ ...s, combo }] : [];
  });
  if (!rows.length) return null;
  return (
    <ul class="small" style={{ margin: 0, paddingInlineStart: '18px' }}>
      {rows.map((r) => (
        <li key={r.command}>
          {r.combo.split('+').map((k, i) => (
            <Fragment key={k}>
              {i > 0 && '+'}
              <kbd>{k}</kbd>
            </Fragment>
          ))}{' '}
          — {t(r.description, r.params?.(facts))}
        </li>
      ))}
    </ul>
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

export function HelpPage() {
  const version = api.runtime.getManifest().version;
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
          <h2>{t(topic.title)}</h2>
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
          <AboutLink href={ACCESSIBILITY_URL} icon="eye" title={t('help.accessibilityStatement')} />
          <AboutLink href={CHANGELOG_URL} icon="list" title={t('help.changelog')} />
        </ul>
        <p class="small muted">{t('help.license')}</p>
      </section>
    </div>
  );
}
