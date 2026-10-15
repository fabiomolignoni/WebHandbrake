import { describe, expect, it } from 'vitest';
import { diffConfig } from '../../src/engine/changes';
import { defaultConfig } from '../../src/engine/defaults';
import { normalizeConfig } from '../../src/engine/schema';
import type { Config, Protection } from '../../src/engine/types';

/** A stored or exported configuration as an earlier version wrote it. */
function legacy(patch: (c: any) => void) {
  const c: any = JSON.parse(JSON.stringify(defaultConfig()));
  patch(c);
  return c;
}

describe('settings removed from earlier versions', () => {
  it('the accent colour is dropped, so importing an old file changes nothing', () => {
    const old = legacy((c) => {
      c.settings.accent = '#ff0000';
    });
    const { config } = normalizeConfig(old);
    expect(config.settings).not.toHaveProperty('accent');
    expect(diffConfig(normalizeConfig(defaultConfig()).config, config)).toEqual([]);
  });

  it('the alternatives of intervention pages are dropped (#16)', () => {
    const old = legacy((c) => {
      c.settings.interventions.alternatives = [{ id: 'a', label: 'Read a book', url: 'https://x.test/' }];
    });
    const { config } = normalizeConfig(old);
    expect(config.settings.interventions).not.toHaveProperty('alternatives');
    expect(diffConfig(normalizeConfig(defaultConfig()).config, config)).toEqual([]);
  });

  it('a Reminder condition becomes Only count time, not the fallback block (#17)', () => {
    const old = legacy((c) => {
      c.groups = [
        {
          id: 'g',
          name: 'Reading',
          targets: [{ id: 't', type: 'domain', value: 'read.test' }],
          policies: [
            {
              id: 'p',
              schedule: { mode: 'always', windows: [] },
              intervention: { type: 'remind', message: 'Hi' },
            },
          ],
        },
      ];
    });
    const { config } = normalizeConfig(old);
    expect(config.groups[0].policies[0].intervention).toEqual({ type: 'track' });
  });

  it('keeps unknown settings of newer versions', () => {
    const { config } = normalizeConfig(legacy((c) => (c.settings.future = 1)));
    expect((config.settings as unknown as Record<string, unknown>).future).toBe(1);
  });
});

describe('the protection levels of earlier versions (#12)', () => {
  const rule = (id: string, protection?: unknown, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    targets: [{ id: `${id}-t`, type: 'domain', value: `${id}.test` }],
    policies: [{ id: `${id}-p`, schedule: { mode: 'always', windows: [] }, intervention: { type: 'block' } }],
    ...(protection === undefined ? {} : { protection }),
    ...extra,
  });
  const HASH = 'pbkdf2-sha256$600000$c2FsdA==$aGFzaA==';
  const SECRET = 'GEZDGNBVGY3TQOJQ';

  it('each level becomes a protection: Soft a reminder, Balanced and Strict their waits, Locked its date', () => {
    const { config } = normalizeConfig(
      legacy((c) => {
        c.settings.protection.balancedDelaySeconds = 45;
        c.settings.protection.coolingOffHours = 12;
        c.groups = [
          rule('soft', 'soft'),
          rule('balanced', 'balanced'),
          rule('strict', 'strict'),
          rule('locked', 'locked', { protectionUntil: 5000 }),
          rule('undated', 'locked'),
          rule('permanent', 'permanent'),
        ];
      }),
    );
    expect(config.groups.map((g) => g.protection)).toEqual([
      { kind: 'reminder' },
      { kind: 'wait', seconds: 45 },
      { kind: 'wait', seconds: 12 * 3600 },
      { kind: 'locked', until: 5000 },
      { kind: 'permanent' },
      { kind: 'permanent' },
    ]);
    for (const g of config.groups) expect(g).not.toHaveProperty('protectionUntil');
    for (const path of [
      'level',
      'lockedUntil',
      'fallback',
      'coolingOffHours',
      'balancedDelaySeconds',
      'challengeLength',
    ])
      expect(config.settings.protection).not.toHaveProperty(path);
  });

  it('a rule that followed the global level takes it, with its date', () => {
    const { config } = normalizeConfig(
      legacy((c) => {
        c.settings.protection.level = 'locked';
        c.settings.protection.lockedUntil = 5000;
        c.groups = [rule('global', null), rule('own', 'soft')];
      }),
    );
    expect(config.groups.map((g) => g.protection)).toEqual([
      { kind: 'locked', until: 5000 },
      { kind: 'reminder' },
    ]);
  });

  it('a password or a partner code takes over a gentler level, never Locked; the partner before the password', () => {
    const { config } = normalizeConfig(
      legacy((c) => {
        c.groups = [
          rule('pw', 'strict', { passwordHash: HASH }),
          rule('both', 'soft', { passwordHash: HASH, partner: { secret: SECRET, breaks: false } }),
          rule('locked', 'locked', { protectionUntil: 5000, passwordHash: HASH }),
          rule('bad', 'balanced', { passwordHash: 'secret' }),
        ];
      }),
    );
    expect(config.groups.map((g) => g.protection)).toEqual([
      { kind: 'password', hash: HASH },
      { kind: 'partner', secret: SECRET, breaks: false },
      { kind: 'locked', until: 5000 },
      { kind: 'wait', seconds: 30 },
    ]);
    for (const g of config.groups) {
      expect(g).not.toHaveProperty('passwordHash');
      expect(g).not.toHaveProperty('partner');
    }
  });

  it('the settings password and the partner code of an earlier version go to every rule', () => {
    const { config } = normalizeConfig(
      legacy((c) => {
        c.settings.protection.access = {
          passwordHash: HASH,
          codeLength: 40,
          lockWindows: [{ days: [1], start: 0, end: 600 }],
          partner: { secret: SECRET, breaks: false },
        };
        c.groups = [rule('a', 'soft'), rule('b', 'locked', { protectionUntil: 5000 })];
      }),
    );
    expect(config.groups.map((g) => g.protection)).toEqual([
      { kind: 'partner', secret: SECRET, breaks: false },
      { kind: 'locked', until: 5000 },
    ]);
    // The random code and the times when settings could not be loosened have no rule to go to.
    expect(config.settings.protection).not.toHaveProperty('access');
  });

  it('without a level (a shared rule, a new configuration), a rule waits 30 seconds', () => {
    const { config } = normalizeConfig({ ...defaultConfig(), groups: [rule('shared')] });
    expect(config.groups[0].protection).toEqual({ kind: 'wait', seconds: 30 });
  });

  it('normalising again changes nothing, so a stored configuration is not a change', () => {
    const raw = legacy((c) => {
      c.settings.protection.level = 'strict';
      c.groups = [rule('global', null), rule('pw', 'soft', { passwordHash: HASH })];
    });
    const once = normalizeConfig(raw).config;
    expect(diffConfig(once, normalizeConfig(once).config)).toEqual([]);
  });
});

describe('protections in a stored or imported file', () => {
  const rule = (protection: unknown) => ({ id: 'a', name: 'A', targets: [], policies: [], protection });
  const read = (protection: unknown, current?: Config) =>
    normalizeConfig(
      legacy((c) => (c.groups = [rule(protection)])),
      Date.now(),
      { secretsFrom: current },
    ).config.groups[0].protection;

  it('waits are kept within their range; Locked without a date is Permanent', () => {
    expect(read({ kind: 'wait', seconds: 1 })).toEqual({ kind: 'wait', seconds: 5 });
    expect(read({ kind: 'wait', seconds: 1e9 })).toEqual({ kind: 'wait', seconds: 30 * 86_400 });
    expect(read({ kind: 'locked' })).toEqual({ kind: 'permanent' });
    expect(read({ kind: 'nonsense' })).toEqual({ kind: 'wait', seconds: 30 });
  });

  it('a password needs a well-formed hash, a partner code a base32 secret', () => {
    const hash = 'pbkdf2-sha256$600000$c2FsdA==$aGFzaA==';
    expect(read({ kind: 'password', hash })).toEqual({ kind: 'password', hash });
    expect(read({ kind: 'password', hash: 'secret' })).toEqual({ kind: 'reminder' });
    expect(read({ kind: 'partner', secret: 'gezdgnbvgy3tqojqgezdgnbvgy3tqojq' })).toEqual({
      kind: 'partner',
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      breaks: true,
    });
    expect(read({ kind: 'partner', secret: 'not base32!' })).toEqual({ kind: 'reminder' });
  });

  it('a secret left out of a file is taken from the rule it replaces, when that has the same kind', () => {
    const hash = 'pbkdf2-sha256$600000$c2FsdA==$aGFzaA==';
    const current = (protection: Protection) =>
      ({ ...defaultConfig(), groups: [{ ...rule(protection) }] }) as unknown as Config;
    expect(read({ kind: 'password' }, current({ kind: 'password', hash }))).toEqual({
      kind: 'password',
      hash,
    });
    expect(read({ kind: 'password' }, current({ kind: 'reminder' }))).toEqual({ kind: 'reminder' });
    expect(
      read(
        { kind: 'partner', breaks: false },
        current({ kind: 'partner', secret: 'GEZDGNBVGY3TQOJQ', breaks: true }),
      ),
    ).toEqual({ kind: 'partner', secret: 'GEZDGNBVGY3TQOJQ', breaks: false });
  });
});
