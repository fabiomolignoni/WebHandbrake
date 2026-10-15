#!/usr/bin/env node
/**
 * Release notes: checks that a release tag names the version in package.json and that
 * CHANGELOG.md has an entry for it, then prints that entry with the way to verify the files. The
 * release workflow (.github/workflows/release.yml) uses the output as the text of the GitHub
 * release, and stops when this script fails.
 *
 *   node scripts/release-notes.mjs v<version>
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The version a release tag names ("v1.2.0" → "1.2.0"); throws unless it is package.json's. */
export function tagVersion(tag, packageVersion) {
  const m = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!m) throw new Error(`"${tag}" is not a release tag (vX.Y.Z).`);
  if (m[1] !== packageVersion)
    throw new Error(`tag ${tag} does not match the version in package.json (${packageVersion}).`);
  return m[1];
}

/**
 * The body of the CHANGELOG.md entry "## [<version>] - YYYY-MM-DD", up to the next entry or the
 * link definitions; throws when the entry is missing or empty.
 */
export function releaseNotes(changelog, version) {
  const lines = changelog.split('\n');
  const heading = `## [${version}] - `;
  const start = lines.findIndex(
    (l) => l.startsWith(heading) && /^\d{4}-\d{2}-\d{2}\s*$/.test(l.slice(heading.length)),
  );
  if (start === -1) throw new Error(`CHANGELOG.md has no entry "${heading}YYYY-MM-DD".`);
  const end = lines.findIndex((l, i) => i > start && (l.startsWith('## ') || /^\[[^\]]+\]: /.test(l)));
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  if (!body) throw new Error(`the CHANGELOG.md entry for ${version} is empty.`);
  return `${body}\n`;
}

/** How to check the files of a release, appended to its notes. */
export function verifyNote(repository) {
  return [
    '### Verify the files',
    '',
    'The release workflow built these files from the tagged commit. Check them with',
    '`sha256sum -c SHA256SUMS` and',
    `\`gh attestation verify <file> --repo ${repository}\`.`,
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const tag = process.argv[2] ?? '';
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const notes = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), tagVersion(tag, pkg.version));
    const repository = pkg.repository.url.replace(/^.*github\.com\//, '').replace(/\.git$/, '');
    process.stdout.write(`${notes}\n${verifyNote(repository)}`);
  } catch (e) {
    console.error(`release-notes: ${e.message}`);
    process.exit(1);
  }
}
