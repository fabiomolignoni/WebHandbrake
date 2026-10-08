# Releasing

How to build, verify and publish WebHandbrake. This page is also the build guide for store
reviewers: Mozilla asks for the exact environment and commands that rebuild the submitted package.

Nothing has been released yet: there are no tags, no store listings and no signed packages.

## Versioning

- The version lives in `package.json` only; `scripts/manifest.mjs` copies it into both manifests.
- Browsers accept one to four dot-separated integers, so a version has no `-beta` suffix. Every
  store upload needs a higher version than the last one.
- [Semantic Versioning](https://semver.org/) applies to what people rely on: the export format
  ([data format](data-format.md)), the address syntax, settings and supported browsers. A change
  that removes a feature or a setting, breaks an export or drops a browser version is a major
  release; a new feature is a minor one; a fix is a patch.

## Build from source

The reference environment is Node <!-- fact: toolchain.node -->24.14.0<!-- /fact --> (`.nvmrc`)
with the npm it bundles, on Ubuntu 24.04: the default build environment of Mozilla's reviewers.

```bash
git clone https://github.com/fabiomolignoni/WebHandbrake.git
cd WebHandbrake
git checkout v<version>
npm ci
npm run build      # dist/chrome and dist/firefox
npm run package    # web-ext-artifacts/webhandbrake-chrome-<version>.zip and -firefox-<version>.zip
```

The bundles are not minified and have no source maps, so reviewers read the same code as the
repository ([ADR 0011](adr/0011-auditable-build.md)). `npm run package:source` writes
`web-ext-artifacts/webhandbrake-source-<version>.zip` from the committed tree, for the source
upload that Mozilla asks for.

## Verify a package

- `npm run build:verify` builds `dist/` twice and compares the SHA-256 of every file, then runs
  `web-ext lint` on `dist/firefox`. Two builds of the same sources are identical byte for byte.
- The zip files themselves are not byte-identical between builds, because zip entries carry file
  times. To check a package, unzip it and compare its files with a fresh `dist/` build
  (`diff -r`). A package installed from a store also carries the store's own files (such as the
  signature in `META-INF/` on AMO); compare the other files.
- CI builds on x86-64 Ubuntu. That a build on ARM64, the architecture of Mozilla's reviewers, is
  identical has not been verified yet: it is a step of the checklist below.

## Release checklist

1. `npm run check`, `npm run build:verify` and both end-to-end jobs are green on the commit.
2. The [manual checks](testing.md#manual-checks) are done on Chrome, Firefox and Firefox for
   Android, and the results are noted in the release pull request.
3. On an ARM64 machine with the reference environment, `npm ci && npm run build` gives the same
   `dist/` as CI; if it does not, state the difference in the AMO reviewer notes.
4. The version in `package.json` is raised, and `CHANGELOG.md` moves the `[Unreleased]` entries
   under the new version with today's date.
5. If the release changes what is stored, read or sent, `PRIVACY.md` (its date and its change
   history), the permission table and the store answers in
   [store-listings.md](store-listings.md) change in the same pull request.
6. The repository settings that the documents rely on are on: Discussions, private vulnerability
   reporting and Reported content.
7. Tag the commit `v<version>`, then make the packages and the source archive from the tag.
8. Write SHA-256 checksums (`sha256sum web-ext-artifacts/*.zip`) and a software bill of materials
   (`npm sbom --omit dev --sbom-format cyclonedx`) and attach them to the GitHub release with the
   changelog entry.
9. Submit to the stores with the texts in [store-listings.md](store-listings.md): on AMO for
   desktop and Android with the source archive and this page as build instructions, and on the
   Chrome Web Store.
10. After the stores publish it, install the release from each store and check it as in
    [Verify a package](#verify-a-package).

At the first release, also update the sentences that describe the project as unreleased: this
page, `README.md`, `SECURITY.md` and the statuses of MAINT-03 and PRIV-07 in
[requirements.md](requirements.md).
