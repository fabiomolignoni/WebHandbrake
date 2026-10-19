import { describe, expect, it } from 'vitest';
import {
  detectAndImport,
  EXPORT_FORMAT,
  EXPORT_RULE_FORMAT,
  exportGroup,
  mergeImport,
  withoutSecrets,
} from '../../src/engine/importers';
import type { Config } from '../../src/engine/types';
import { BLOCK, config, group, t } from './helpers';

const NOW = Date.UTC(2026, 9, 5);
const HASH = `pbkdf2-sha256$1000$${'A'.repeat(22)}==$${'B'.repeat(43)}=`;
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

describe('reading a file or a pasted text', () => {
  it('reports an empty text, broken JSON and JSON without sites', () => {
    expect(detectAndImport('  ', NOW)).toMatchObject({ format: 'unknown', errors: ['import.error.empty'] });
    expect(detectAndImport('{"groups": [', NOW)).toMatchObject({ errors: ['import.error.json'] });
    expect(detectAndImport('{"hello": 1}', NOW)).toMatchObject({ errors: ['import.error.format'] });
  });

  it('a WebHandbrake export, wrapped or bare, is a whole configuration', () => {
    const c = config([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    for (const text of [
      JSON.stringify({ format: EXPORT_FORMAT, version: 1, config: c }),
      JSON.stringify(c),
    ]) {
      const r = detectAndImport(text, NOW);
      expect(r.format).toBe('webhandbrake');
      expect(r.config?.groups.map((g) => g.name)).toEqual(['A']);
      expect(r.groups).toBe(r.config?.groups);
      expect(r.errors).toEqual([]);
    }
  });

  it('a shared rule is a rule to add; an older file brings the sites of its lists into it', () => {
    const c = config([group('A', ['a.test'], [{ intervention: BLOCK }])]);
    const r = detectAndImport(exportGroup(c, 'A')!, NOW);
    expect(r.format).toBe('group');
    expect(r.config).toBeNull();
    expect(r.groups.map((g) => g.targets.map((x) => x.value))).toEqual([['a.test']]);
    const old = JSON.parse(exportGroup(c, 'A')!);
    old.group.lists = ['L'];
    old.lists = [{ id: 'L', name: 'List', targets: [t('b.test')] }];
    const sites = detectAndImport(JSON.stringify(old), NOW).groups[0].targets.map((x) => x.value);
    expect(sites).toEqual(['a.test', 'b.test']);
  });

  it('a list of sites becomes one blocking rule; lines that are not sites are reported', () => {
    const r = detectAndImport('0.0.0.0 ads.test\n||tracker.test^\nnot a site\n# comment', NOW);
    expect(r.format).toBe('list');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].targets.map((x) => x.value)).toEqual(['ads.test', 'tracker.test']);
    expect(r.groups[0].policies.map((p) => p.intervention)).toEqual([BLOCK]);
    expect(r.warnings).toEqual([{ key: 'import.warn.line', params: { line: 3, text: 'not a site' } }]);
    expect(detectAndImport('just words', NOW).errors).toEqual(['import.error.noSites']);
  });

  it('JSON of another tool gives the addresses it holds', () => {
    const r = detectAndImport(
      JSON.stringify({ blocked: ['news.test', { url: 'https://video.test/x' }], n: 3 }),
      NOW,
    );
    expect(r.format).toBe('list');
    expect(r.groups[0].targets.map((x) => x.value)).toEqual(['news.test', 'video.test/x']);
  });
});

describe('files never carry secrets they should not', () => {
  it('a rule without secrets says only which protection it had', () => {
    const pw = group('P', ['p.test'], [], { protection: { kind: 'password', hash: HASH } });
    const partner = group('Q', ['q.test'], [], {
      protection: { kind: 'partner', secret: SECRET, breaks: false },
    });
    expect(withoutSecrets(pw).protection).toEqual({ kind: 'password' });
    expect(withoutSecrets(partner).protection).toEqual({ kind: 'partner', breaks: false });
    const plain = group('R', ['r.test']);
    expect(withoutSecrets(plain)).toBe(plain);
    expect(exportGroup(config([pw]), 'P')).not.toContain(HASH);
    expect(JSON.parse(exportGroup(config([pw]), 'P')!).format).toBe(EXPORT_RULE_FORMAT);
    expect(exportGroup(config([pw]), 'missing')).toBeNull();
  });
});

describe('merging an import', () => {
  const current = (): Config => config([group('Mine', ['mine.test'], [{ intervention: BLOCK }])]);

  it('adds rules with new ids, secrets replaced by a reminder', () => {
    const imported = config([
      group('Shared', ['s.test'], [{ intervention: BLOCK }], {
        protection: { kind: 'password', hash: HASH },
      }),
    ]);
    const imp = detectAndImport(JSON.stringify(imported), NOW);
    const next = mergeImport(current(), imp, 'merge');
    expect(next.groups.map((g) => g.name)).toEqual(['Mine', 'Shared']);
    const added = next.groups[1];
    expect(added.id).not.toBe('Shared');
    expect(added.protection).toEqual({ kind: 'reminder' });
    expect(added.policies[0].id).not.toBe(imported.groups[0].policies[0].id);
    expect(added.targets[0].id).not.toBe(imported.groups[0].targets[0].id);
  });

  it('an export of schema 1 brings its shared lists and Always allowed into its rules', () => {
    const old: Record<string, any> = config([group('Shared', ['s.test'], [{ intervention: BLOCK }])]);
    old.schema = 1;
    old.groups[0].lists = ['L'];
    old.lists = [{ id: 'L', name: 'List', targets: [t('l.test')] }];
    old.allowlist = [t('s.test/docs')];
    const next = mergeImport(current(), detectAndImport(JSON.stringify(old), NOW), 'merge');
    const sites = next.groups[1].targets.map((x) => `${x.allow ? '+' : ''}${x.value}`);
    expect(sites).toEqual(['s.test', 'l.test', '+s.test/docs']);
    expect(next).not.toHaveProperty('lists');
    expect(next).not.toHaveProperty('allowlist');
  });

  it('replacing takes the file as it is, set up', () => {
    const imported = config([group('Other', ['o.test'], [{ intervention: BLOCK }])]);
    const imp = detectAndImport(JSON.stringify(imported), NOW);
    const next = mergeImport(current(), imp, 'replace');
    expect(next.groups.map((g) => g.id)).toEqual(['Other']);
    expect(next.settings.onboarded).toBe(true);
    // The import result itself is not changed.
    expect(imp.config?.settings.onboarded).toBe(false);
  });

  it('a list or a shared rule is always merged', () => {
    const imp = detectAndImport('new.test', NOW);
    const next = mergeImport(current(), imp, 'replace');
    expect(next.groups.map((g) => g.name)).toEqual(['Mine', 'Imported list']);
  });
});
