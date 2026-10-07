/**
 * The structure of the Help page (src/dashboard/help-content.ts) is consistent with the messages
 * and the manifest: every key exists, every placeholder gets a value, and the shortcuts listed are
 * commands of the manifest with a default key.
 */

import { describe, expect, it } from 'vitest';
import { manifest } from '../../scripts/manifest.mjs';
import messages from '../../src/_locales/en/messages.json';
import {
  defaultShortcut,
  HELP_TOPICS,
  type HelpBlock,
  type HelpParams,
  helpFacts,
  SHORTCUTS,
  SYNTAX,
} from '../../src/dashboard/help-content';
import { DEFAULT_SESSION_MINUTES } from '../../src/engine/limits';
import { parse } from '../../src/i18n/icu';
import en from '../../src/locales/en.json';

const EN = en as Record<string, { message: string }>;

type IcuNode = ReturnType<typeof parse>[number];

/** The argument names of an ICU message, including the variables of plural and select. */
function placeholders(message: string): Set<string> {
  const names = new Set<string>();
  const walk = (nodes: IcuNode[]) => {
    for (const n of nodes) {
      if (typeof n === 'string' || n.t === 'hash') continue;
      names.add(n.name);
      if (n.t === 'plural' || n.t === 'select') for (const option of Object.values(n.options)) walk(option);
    }
  };
  walk(parse(message));
  return names;
}

/** The message keys of a block and its parameters. */
function blockKeys(block: HelpBlock): { keys: string[]; params?: HelpParams } {
  if ('p' in block) return { keys: [block.p], params: block.params };
  if ('list' in block) return { keys: block.list, params: block.params };
  if ('q' in block) return { keys: [block.q, block.a], params: block.params };
  return { keys: [] };
}

/** Every key with its parameters: topic titles, blocks, shortcut descriptions, syntax meanings. */
function allUses(): { where: string; keys: string[]; params?: HelpParams }[] {
  return [
    ...HELP_TOPICS.flatMap((topic) => [
      { where: `help topic '${topic.id}'`, keys: [topic.title] },
      ...topic.blocks.map((b) => ({ where: `help topic '${topic.id}'`, ...blockKeys(b) })),
    ]),
    ...SHORTCUTS.map((s) => ({ where: `shortcut '${s.command}'`, keys: [s.description], params: s.params })),
    ...SYNTAX.map(([entry, key]) => ({ where: `syntax '${entry}'`, keys: [key] })),
  ];
}

describe('the Help structure', () => {
  it('topic IDs are unique', () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it('every message key exists in src/locales/en.json', () => {
    for (const use of allUses())
      for (const key of use.keys) expect(EN[key], `${use.where}: ${key} is not in en.json`).toBeDefined();
  });

  it('every placeholder of a message is provided by the params of its block, and nothing else', () => {
    const facts = helpFacts();
    for (const use of allUses()) {
      const provided = Object.keys(use.params?.(facts) ?? {});
      const needed = new Set(use.keys.flatMap((key) => [...placeholders(EN[key]?.message ?? '')]));
      for (const name of needed)
        expect(
          provided,
          `${use.where}: ${use.keys.join(', ')} uses {${name}} but its params do not provide it`,
        ).toContain(name);
      for (const name of provided)
        expect(
          [...needed],
          `${use.where}: params provide {${name}}, which ${use.keys.join(', ')} does not use`,
        ).toContain(name);
    }
  });

  it('the facts are numbers or HH:MM, never empty', () => {
    for (const [name, value] of Object.entries(helpFacts())) {
      if (typeof value === 'number') expect(Number.isFinite(value), name).toBe(true);
      else expect(value, name).toMatch(/^\d\d:\d\d$/);
    }
  });

  it('every shortcut listed is a command of both manifests with a default key', () => {
    for (const target of ['chrome', 'firefox'] as const) {
      const { commands } = manifest(target, '0.0.0');
      for (const s of SHORTCUTS)
        expect(
          defaultShortcut(commands, s.command),
          `${target}: command ${s.command} has no default key`,
        ).toMatch(/^[A-Za-z]+(\+[A-Za-z0-9]+)+$/);
    }
  });

  it('the shortcut that starts a focus session states its length (manifest strings take no parameters)', () => {
    expect(messages.cmdStartSession.message).toContain(String(DEFAULT_SESSION_MINUTES));
  });
});
