import { describe, expect, it } from 'vitest';
import { closeChangelog, nextVersion } from '../../scripts/release.mjs';
import { releaseNotes } from '../../scripts/release-notes.mjs';

const none = () => false;

const FIRST = `# Changelog

Intro.

## [Unreleased]

The first version.

### Added

- Everything.

[Unreleased]: https://github.com/o/r/commits/main
`;

const LATER = `# Changelog

## [Unreleased]

### Fixed

- A fix.

## [1.0.0] - 2026-10-20

### Added

- Everything.

[Unreleased]: https://github.com/o/r/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/o/r/releases/tag/v1.0.0
`;

describe('release: the version', () => {
  it('patch, minor and major raise the version in package.json', () => {
    expect(nextVersion('1.2.3', 'patch', none)).toBe('1.2.4');
    expect(nextVersion('1.2.3', 'minor', none)).toBe('1.3.0');
    expect(nextVersion('1.2.3', 'major', none)).toBe('2.0.0');
  });

  it('a version can be named, and the first release is the version in package.json', () => {
    expect(nextVersion('1.0.0', '1.0.0', none)).toBe('1.0.0');
    expect(nextVersion('1.0.0', '1.10.0', none)).toBe('1.10.0');
  });

  it('a version lower than package.json, already tagged, or not x.y.z is refused', () => {
    expect(() => nextVersion('1.2.0', '1.1.9', none)).toThrow('lower');
    expect(() => nextVersion('1.10.0', '1.9.0', none)).toThrow('lower');
    expect(() => nextVersion('1.0.0', '1.0.0', (v) => v === '1.0.0')).toThrow('already been released');
    expect(() => nextVersion('1.0.0', 'v1.0.1', none)).toThrow('not a version');
    expect(() => nextVersion('1.0.0', undefined, none)).toThrow('not a version');
    expect(() => nextVersion('1.0', 'patch', none)).toThrow('not x.y.z');
  });
});

describe('release: the changelog', () => {
  it('the first release turns [Unreleased] into its entry and links its tag', () => {
    const out = closeChangelog(FIRST, '1.0.0', '2026-10-20', 'o/r');
    expect(out).toBe(`# Changelog

Intro.

## [Unreleased]

## [1.0.0] - 2026-10-20

The first version.

### Added

- Everything.

[Unreleased]: https://github.com/o/r/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/o/r/releases/tag/v1.0.0
`);
    // The entry is what the release workflow publishes.
    expect(releaseNotes(out, '1.0.0')).toBe('The first version.\n\n### Added\n\n- Everything.\n');
  });

  it('a later release links the comparison with the previous one', () => {
    const out = closeChangelog(LATER, '1.0.1', '2026-11-02', 'o/r');
    expect(out).toContain(
      '## [Unreleased]\n\n## [1.0.1] - 2026-11-02\n\n### Fixed\n\n- A fix.\n\n## [1.0.0] - 2026-10-20',
    );
    expect(out).toContain(
      '[Unreleased]: https://github.com/o/r/compare/v1.0.1...HEAD\n[1.0.1]: https://github.com/o/r/compare/v1.0.0...v1.0.1\n[1.0.0]:',
    );
    expect(releaseNotes(out, '1.0.1')).toBe('### Fixed\n\n- A fix.\n');
  });

  it('link definitions are added when the changelog has none', () => {
    const out = closeChangelog('## [Unreleased]\n\n- A change.\n', '0.1.0', '2026-10-20', 'o/r');
    expect(out).toBe(
      '## [Unreleased]\n\n## [0.1.0] - 2026-10-20\n\n- A change.\n\n[Unreleased]: https://github.com/o/r/compare/v0.1.0...HEAD\n[0.1.0]: https://github.com/o/r/releases/tag/v0.1.0\n',
    );
    const later = closeChangelog(
      '## [Unreleased]\n\n- B.\n\n## [0.1.0] - 2026-10-20\n\n- A.\n\n',
      '0.2.0',
      '2026-10-21',
      'o/r',
    );
    expect(later).toBe(
      '## [Unreleased]\n\n## [0.2.0] - 2026-10-21\n\n- B.\n\n## [0.1.0] - 2026-10-20\n\n- A.\n\n[Unreleased]: https://github.com/o/r/compare/v0.2.0...HEAD\n[0.2.0]: https://github.com/o/r/compare/v0.1.0...v0.2.0\n',
    );
  });

  it('nothing to release, no [Unreleased] section or an existing entry stops the release', () => {
    expect(() => closeChangelog(LATER.replace('- A fix.\n', ''), '1.0.1', '2026-11-02', 'o/r')).toThrow(
      'lists no change',
    );
    expect(() => closeChangelog('# Changelog\n', '1.0.0', '2026-10-20', 'o/r')).toThrow(
      'no "## [Unreleased]"',
    );
    expect(() => closeChangelog(LATER, '1.0.0', '2026-10-20', 'o/r')).toThrow('already has an entry');
  });
});
