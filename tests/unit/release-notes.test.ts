import { describe, expect, it } from 'vitest';
import { releaseNotes, tagVersion, verifyNote } from '../../scripts/release-notes.mjs';

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

- Something not released yet.

## [1.1.0] - 2026-11-02

### Added

- A new feature.

### Fixed

- A fix.

## [1.0.0] - 2026-10-20

### Added

- The first version.

[Unreleased]: https://github.com/o/r/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/o/r/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/o/r/releases/tag/v1.0.0
`;

describe('release notes', () => {
  it('a release tag names the version in package.json', () => {
    expect(tagVersion('v1.1.0', '1.1.0')).toBe('1.1.0');
    expect(() => tagVersion('v1.1.1', '1.1.0')).toThrow('does not match');
    expect(() => tagVersion('1.1.0', '1.1.0')).toThrow('not a release tag');
    expect(() => tagVersion('v1.1', '1.1')).toThrow('not a release tag');
  });

  it('the notes are the changelog entry of the version, up to the next entry', () => {
    expect(releaseNotes(CHANGELOG, '1.1.0')).toBe('### Added\n\n- A new feature.\n\n### Fixed\n\n- A fix.\n');
  });

  it('the last entry stops at the link definitions', () => {
    expect(releaseNotes(CHANGELOG, '1.0.0')).toBe('### Added\n\n- The first version.\n');
  });

  it('a version without an entry, or with an empty one, stops the release', () => {
    expect(() => releaseNotes(CHANGELOG, '1.2.0')).toThrow('no entry');
    expect(() =>
      releaseNotes('## [Unreleased]\n\n## [1.0.0] - 2026-10-20\n\n## [0.9.0] - 2026-10-01\n', '1.0.0'),
    ).toThrow('empty');
    // The Unreleased section is never a release.
    expect(() => releaseNotes(CHANGELOG, 'Unreleased')).toThrow('no entry');
  });

  it('the notes say how to verify the files', () => {
    const note = verifyNote('o/r');
    expect(note).toContain('sha256sum -c SHA256SUMS');
    expect(note).toContain('gh attestation verify <file> --repo o/r');
  });
});
