#!/usr/bin/env node
/**
 * Closes a version. From a clean main that matches origin/main, it runs the checks of the CI, sets
 * the version in package.json and package-lock.json, turns the [Unreleased] section of
 * CHANGELOG.md into the entry of the version, commits "Release <version>" and tags it
 * v<version>. With --push it pushes main and the tag together: the tag starts the release
 * workflow (.github/workflows/release.yml), which builds the store packages and drafts the GitHub
 * release.
 *
 *   npm run release -- <x.y.z | patch | minor | major> [--push] [--dry-run] [--skip-checks]
 *
 * patch, minor and major raise the version in package.json; the first release names its
 * version (npm run release -- 1.0.0). --dry-run shows the release without changing anything.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { releaseNotes } from './release-notes.mjs';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Negative, zero or positive as version a is lower than, equal to or higher than version b. */
function compare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * The version to release: x.y.z as given, or the version in package.json with one part raised.
 * It is never lower than the version in package.json, which can itself be released while it has
 * no tag (the first release), and never a version already tagged.
 */
export function nextVersion(current, spec, tagged) {
  const m = SEMVER.exec(current);
  if (!m) throw new Error(`the version in package.json is "${current}", not x.y.z.`);
  const [major, minor, patch] = m.slice(1).map(Number);
  let next;
  if (spec === 'major') next = `${major + 1}.0.0`;
  else if (spec === 'minor') next = `${major}.${minor + 1}.0`;
  else if (spec === 'patch') next = `${major}.${minor}.${patch + 1}`;
  else if (SEMVER.test(spec ?? '')) next = spec;
  else throw new Error(`"${spec ?? ''}" is not a version (x.y.z) nor patch, minor or major.`);
  if (compare(next, current) < 0)
    throw new Error(`${next} is lower than the version in package.json (${current}).`);
  if (tagged(next)) throw new Error(`v${next} has already been released.`);
  return next;
}

/**
 * CHANGELOG.md with the [Unreleased] section turned into "## [<version>] - <date>", an empty
 * [Unreleased] section above it, and the link definitions of both. Throws when [Unreleased] is
 * missing or lists no change, or when the version already has an entry.
 */
export function closeChangelog(changelog, version, date, repository) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## [Unreleased]');
  if (start === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section.');
  if (lines.some((l) => l.startsWith(`## [${version}]`)))
    throw new Error(`CHANGELOG.md already has an entry for ${version}.`);
  let end = lines.findIndex((l, i) => i > start && (l.startsWith('## ') || /^\[[^\]]+\]: /.test(l)));
  if (end === -1) end = lines.length;
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
  if (!/^- /m.test(body)) throw new Error('the [Unreleased] section of CHANGELOG.md lists no change.');

  const rest = lines.slice(end);
  const previous = rest.map((l) => /^## \[(\d+\.\d+\.\d+)\] - /.exec(l)?.[1]).find(Boolean);
  const base = `https://github.com/${repository}`;
  const links = [
    `[Unreleased]: ${base}/compare/v${version}...HEAD`,
    previous
      ? `[${version}]: ${base}/compare/v${previous}...v${version}`
      : `[${version}]: ${base}/releases/tag/v${version}`,
  ];
  const at = rest.findIndex((l) => l.startsWith('[Unreleased]: '));
  if (at === -1) {
    while (rest.length && rest[rest.length - 1] === '') rest.pop();
    // The new entry already ends with a blank line; older entries need one before the links.
    if (rest.length) rest.push('');
    rest.push(...links, '');
  } else rest.splice(at, 1, ...links);
  return [
    ...lines.slice(0, start),
    '## [Unreleased]',
    '',
    `## [${version}] - ${date}`,
    '',
    body,
    '',
    ...rest,
  ].join('\n');
}

/** Today in the local time zone, as YYYY-MM-DD. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

function main(argv) {
  const flags = argv.filter((a) => a.startsWith('--'));
  const unknown = flags.filter((f) => !['--push', '--dry-run', '--skip-checks'].includes(f));
  if (unknown.length) throw new Error(`unknown option ${unknown.join(', ')}.`);
  const spec = argv.find((a) => !a.startsWith('--'));
  const dryRun = flags.includes('--dry-run');

  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const repository = pkg.repository.url.replace(/^.*github\.com\//, '').replace(/\.git$/, '');

  if (git('status', '--porcelain')) throw new Error('the working tree has uncommitted changes.');
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') throw new Error('a release is made from main.');
  execFileSync('git', ['fetch', '--quiet', '--tags', 'origin', 'main'], { stdio: 'inherit' });
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main'))
    throw new Error('main is not the same as origin/main: pull or push first.');

  const version = nextVersion(pkg.version, spec, (v) => git('tag', '--list', `v${v}`) !== '');
  const changelog = closeChangelog(readFileSync('CHANGELOG.md', 'utf8'), version, today(), repository);
  // The same check the release workflow makes on the tag.
  const notes = releaseNotes(changelog, version);

  console.log(`\nRelease ${version} (v${version}) from ${git('rev-parse', '--short', 'HEAD')}.\n\n${notes}`);
  if (dryRun) {
    console.log('Dry run: nothing was changed.');
    return;
  }

  if (!argv.includes('--skip-checks')) {
    run('npm', ['run', 'check']);
    run('npm', ['run', 'build:verify']);
  }
  run('npm', ['version', version, '--no-git-tag-version', '--allow-same-version']);
  writeFileSync('CHANGELOG.md', changelog);
  run('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
  run('git', ['commit', '--quiet', '-m', `Release ${version}`]);
  run('git', ['tag', '-a', `v${version}`, '-m', `WebHandbrake ${version}`]);

  if (flags.includes('--push')) {
    run('git', ['push', '--atomic', 'origin', 'main', `v${version}`]);
    console.log(
      `\nPushed main and v${version}: the release workflow builds the packages and drafts the release.`,
    );
  } else {
    console.log(`\nCommitted and tagged v${version}, nothing pushed. To publish:`);
    console.log(`  git push --atomic origin main v${version}`);
    console.log(`To undo instead:\n  git tag -d v${version} && git reset --hard HEAD~1`);
  }
  console.log(
    `\nThen: https://github.com/${repository}/releases has the draft with the packages. Submit them to the stores (store/), then publish the draft.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`release: ${e.message}`);
    process.exit(1);
  }
}
