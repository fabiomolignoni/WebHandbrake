/**
 * The envelope of the export files (docs/data-format.md): the keys and the format and version
 * markers. A change here changes a file format that people keep: update the document and this test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectAndImport,
  EXPORT_FORMAT,
  EXPORT_RULE_FORMAT,
  EXPORT_RULE_VERSION,
  EXPORT_VERSION,
} from '../../src/engine/importers';
import { installFakeBrowser } from './fake-browser';
import { BLOCK, group } from './helpers';

describe('export files', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  async function setup() {
    const { store } = await import('../../src/background/store');
    const data = await import('../../src/background/data');
    await store.ready();
    store.config.groups = [group('Social', ['social.test'], [{ intervention: BLOCK }])];
    store.config.settings.protection.access.passwordHash = 'pbkdf2$hash';
    return { store, data };
  }

  it('the full export has exactly format, version, exportedAt, config and later', async () => {
    const { data } = await setup();
    const file = JSON.parse((await data.exportData(false, false)).text);
    expect(Object.keys(file), 'export envelope changed: update docs/data-format.md and this test').toEqual([
      'format',
      'version',
      'exportedAt',
      'config',
      'later',
    ]);
    expect(file.format).toBe(EXPORT_FORMAT);
    expect(file.version).toBe(EXPORT_VERSION);
    expect(new Date(file.exportedAt).toISOString()).toBe(file.exportedAt);
    expect(file.config.settings.protection.access.passwordHash).toBeNull();
    expect(detectAndImport(JSON.stringify(file)).format).toBe('webhandbrake');
  });

  it('statistics and the password hash are included only when asked', async () => {
    const { data } = await setup();
    const file = JSON.parse((await data.exportData(true, true)).text);
    expect(Object.keys(file)).toEqual(['format', 'version', 'exportedAt', 'config', 'later', 'statistics']);
    expect(file.config.settings.protection.access.passwordHash).toBe('pbkdf2$hash');
  });

  it('the single-rule file has exactly format, version, group and lists', async () => {
    const { data } = await setup();
    const file = JSON.parse((await data.exportGroupFile('Social')).text);
    expect(
      Object.keys(file),
      'single-rule envelope changed: update docs/data-format.md and this test',
    ).toEqual(['format', 'version', 'group', 'lists']);
    expect(file.format).toBe(EXPORT_RULE_FORMAT);
    expect(file.version).toBe(EXPORT_RULE_VERSION);
    expect(detectAndImport(JSON.stringify(file)).format).toBe('group');
  });
});
