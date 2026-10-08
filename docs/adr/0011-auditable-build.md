# ADR 0011 — An auditable, deterministic build and a separate test build

- Status: accepted
- Date: 2026-10-07
- Recorded: 2026-10-08
- Requirements: PRIV-07, MAINT-03, SEC-02, REL-03

## Context and problem statement

WebHandbrake asks for access to every site, so people and store reviewers need to read the code
that ships and to rebuild it. addons.mozilla.org asks for the sources and the build instructions
of any code that a tool has bundled or generated, and its reviewers rebuild the package from them.
The Chrome Web Store forbids remote code.

The end-to-end suite ([ADR 0006](0006-e2e-real-browsers.md)) needs entry points that no user may
have: a clock that tests can move, error capture in every context, and requests that read the
background's internal state. A clock that anyone can move would get around schedules, limits and
cooling-off.

This record was written after the decisions. The unminified, deterministic build dates from
2026-10-04; the separate test build and its guard date from 2026-10-07.

How is WebHandbrake built so that the shipped code can be read and rebuilt, and how are the test
entry points kept out of it?

## Considered options

1. **Minified bundles with source maps.**
   - Good: smaller packages.
   - Bad: the shipped code cannot be read without the maps and the sources, and reviewers must
     trust that the maps match.
2. **One build, with the test entry points behind a switch read at run time.**
   - Good: the tests exercise exactly the files that ship.
   - Bad: the entry points ship to every user, and anyone who flips the switch can move the clock.
3. **Unminified bundles, and a separate test build whose entry points the production build drops
   at compile time, with a guard on the production bundles.**
   - Good: the shipped code is the readable source, bundled, and the code behind the test flag is
     left out of it.
   - Bad: larger files, and a second build to keep in step with the first.

## Decision outcome

Chosen: option 3.

- **Readable bundles.** `scripts/build.mjs` bundles each surface with esbuild into one IIFE file,
  with `minify: false`, `sourcemap: false` and `legalComments: 'none'`. The manifest comes from
  `scripts/manifest.mjs`, and its content security policy allows only the extension's own scripts
  and styles, so no remote code can run.
- **Deterministic output.** The build writes no timestamps, so the same sources and the same tool
  versions give a byte-identical `dist/`. The Node version is pinned in `.nvmrc`, which CI uses,
  and the other tools are pinned by `package-lock.json`.
- **Packages.** `npm run package` zips `dist/chrome` and `dist/firefox`; `npm run package:source`
  archives the committed sources for addons.mozilla.org.
- **Test build.** `npm run build:test` builds the same sources into `dist-test/` with the
  compile-time constant `__TEST__` set to true. Code behind `if (__TEST__)` adds the test clock,
  error capture, the `test.*` requests, `test.html`, an open shadow root for the overlay and the
  `popup.html?tab=` parameter. In the production build the constant is false: esbuild leaves the
  test modules out, and only inert `if (false)` statements remain where they were called. Packages
  are never made from `dist-test/`.
- **Guard.** Every production build except the watch mode runs `checkNoTestHooks()` in
  `scripts/build.mjs`, which fails when a bundle contains the name of a known test hook.

## Consequences

Good:

- The shipped code can be read as it is, and anyone can rebuild `dist/` and compare it file by
  file with a package ([releasing](../releasing.md#verify-a-package)).
- The test entry points cannot reach users through a forgotten switch.

Bad:

- The packages are larger than minified ones would be. Preact's published build is already
  minified, so that part of each bundle stays minified ([ADR 0002](0002-ui-preact.md)).
- The zip files are not byte-identical between builds, because they store the time of each file;
  a package is compared by its unpacked contents.
- `dist/` is compared between two builds on one machine. CI builds on x86-64, while the default
  environment of addons.mozilla.org reviewers is ARM64; a byte-identical result across the two has
  not been verified; the [release checklist](../releasing.md#release-checklist) includes that
  check.
- The end-to-end suite tests `dist-test/`, which differs from `dist/` by the guarded code.
- The guard knows a fixed list of names: a new test hook that it does not name would not be
  caught.

## Confirmation

- `npm run build:verify` builds `dist/` twice, fails when any file differs, and runs `web-ext lint`
  on `dist/firefox`. CI runs it in the `check` job.
- `checkNoTestHooks()` runs in `npm run build`, so `npm run build:verify` and the CI `package` job
  fail if a test hook reaches `dist/`.
- Not automated: comparing a store package with a rebuild, a step of the
  [release checklist](../releasing.md#release-checklist).
