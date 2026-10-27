/**
 * The structure of the Help page (src/dashboard/help-content.ts) is consistent with the messages
 * and the manifest: every key exists, every placeholder gets a value, and the shortcuts listed are
 * commands of the manifest, whose default keys both browsers give.
 */

import { describe, expect, it } from 'vitest';
import { manifest } from '../../scripts/manifest.mjs';
import messages from '../../src/_locales/en/messages.json';
import {
  ADDRESS_TOPIC,
  HELP_TOPICS,
  type HelpBlock,
  type HelpParams,
  helpFacts,
  helpRoute,
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
      else if (typeof value === 'function') expect(value(9 * 60 + 5), name).toBe('09:05');
      else expect(value, name).toMatch(/^\d\d:\d\d$/);
    }
  });

  it('every shortcut listed is a command of both manifests', () => {
    for (const target of ['chrome', 'firefox'] as const) {
      const { commands } = manifest(target, '0.0.0');
      for (const s of SHORTCUTS) expect(Object.keys(commands), target).toContain(s.command);
    }
  });

  it('the default keys are ones that both browsers give and that reach the extension', () => {
    // Firefox on Windows and Linux ignores Shift for the menu bar's access keys: Alt+Shift+F opened
    // the File menu instead of starting a session, and the letters change with the browser's
    // language. Chrome does not give a key that is one of its own: Alt+Shift+B (bookmarks bar) was
    // never assigned.
    const CHROME_OWN = ['Alt+Shift+A', 'Alt+Shift+B', 'Alt+Shift+I', 'Alt+Shift+T', 'Alt+Shift+W'];
    for (const target of ['chrome', 'firefox'] as const) {
      const keys = Object.values(manifest(target, '0.0.0').commands).flatMap((c) =>
        c.suggested_key?.default ? [c.suggested_key.default] : [],
      );
      expect(keys.length, target).toBeGreaterThan(0);
      // Chrome gives at most four suggested keys.
      expect(keys.length, target).toBeLessThanOrEqual(4);
      expect(new Set(keys).size, target).toBe(keys.length);
      for (const key of keys) {
        expect(key, `${target}: ${key} opens a menu of Firefox`).not.toMatch(/^Alt\+(Shift\+)?[A-Z]$/);
        expect(CHROME_OWN, `${target}: ${key} is a shortcut of Chrome`).not.toContain(key);
      }
    }
  });

  it('the shortcut that starts a focus session states its length (manifest strings take no parameters)', () => {
    expect(messages.cmdStartSession.message).toContain(String(DEFAULT_SESSION_MINUTES));
  });
});

describe('the link from the address guide to every address type (#11)', () => {
  it('opens Help at the topic that holds the address syntax table', () => {
    expect(helpRoute(ADDRESS_TOPIC)).toBe(`#/help/${ADDRESS_TOPIC}`);
    const topic = HELP_TOPICS.find((x) => x.id === ADDRESS_TOPIC);
    expect(topic, `no Help topic '${ADDRESS_TOPIC}'`).toBeDefined();
    expect(topic!.blocks.some((b) => 'syntax' in b)).toBe(true);
  });
});
