/** Offline help (ONB-03, ONB-06): everything needed to use WebHandbrake, available without network. */

import { Fragment } from 'preact';
import { t } from '../../i18n/i18n';
import { api, features } from '../../platform/api';
import { NEW_ISSUE_URL, REPO_URL } from '../../shared/links';
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
