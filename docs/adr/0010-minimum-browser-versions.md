# ADR 0010 — Minimum browser versions

- Status: accepted
- Date: 2026-10-04
- Recorded: 2026-10-08
- Requirements: COMP-01, COMP-03

## Context and problem statement

The manifest built by `scripts/manifest.mjs` sets the oldest browser version that can install
WebHandbrake: `minimum_chrome_version` for Chrome, and `strict_min_version` under `gecko` and
`gecko_android` for Firefox and Firefox for Android. esbuild compiles the code for the same
desktop versions (`target` in `scripts/build.mjs`).

Two platform facts weigh on the choice:

- From Chrome 121, the limit on dynamic declarativeNetRequest rules is higher for block and allow
  rules, and an extension reads it through `MAX_NUMBER_OF_DYNAMIC_RULES`; redirect rules keep the
  lower limit
  ([Chrome's announcement](https://developer.chrome.com/blog/improvements-to-content-filtering-in-manifest-v3)).
  `dnrLimits()` in `src/background/dnr-sync.ts` reads that constant and falls back to the older one.
- Firefox 140 on desktop and Firefox 142 on Android are the first versions with Firefox's built-in
  consent for data collection: the `data_collection_permissions` key of the manifest, shown in the
  install prompt and in the add-ons manager. Since 2025-11-03, addons.mozilla.org requires the key
  for every new extension
  ([Extension Workshop](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)).
  WebHandbrake declares `required: ["none"]`. Firefox 140 is an Extended Support Release.

This record was written after the versions were chosen. The original specification gave a reason
for Chrome only, the limits of dynamic rules; the Firefox versions match the data-collection
consent, which this record takes as their reason.

Which minimum versions should the manifest declare?

## Considered options

1. **The oldest versions that have the APIs used** (declarativeNetRequest, `storage.session`,
   dynamic content scripts).
   - Good: more people can install it.
   - Bad: older Chrome versions have a lower limit for dynamic rules; older Firefox versions do not
     show the data-collection declaration; and every extra version is one more to support and to
     test.
2. **The current release only**, raised with every release.
   - Good: the fewest platform differences.
   - Bad: excludes people on an Extended Support Release or on slower update channels, and changes
     the manifest at every release.
3. **The first versions that bring a feature WebHandbrake depends on.**
   - Good: each minimum has a reason that can be checked, and every supported Firefox shows the
     declaration that nothing is collected.
   - Bad: still excludes older browsers.

## Decision outcome

Chosen: option 3.

- Chrome: <!-- fact: manifest.chrome.min -->121<!-- /fact -->, for the higher limit on dynamic
  rules.
- Firefox on desktop: <!-- fact: manifest.firefox.min -->140<!-- /fact -->, and Firefox for
  Android: <!-- fact: manifest.android.min -->142<!-- /fact -->, so that every Firefox that can
  install WebHandbrake shows its data-collection declaration.

Edge and other Chromium browsers read `minimum_chrome_version` too; they are not tested
([supported browsers](../../README.md#supported-browsers)).

## Consequences

Good:

- Fallbacks for older browsers are unnecessary. The in-memory fallback for `storage.session` in
  `src/platform/api.ts`, written for Firefox versions before 115, cannot be reached at these
  minimums.
- A person installing from addons.mozilla.org sees that WebHandbrake collects no data, whatever
  Firefox version they use.

Bad:

- People on older browsers cannot install WebHandbrake.
- The minimum versions are not tested: the end-to-end suite runs on current releases
  ([ADR 0006](0006-e2e-real-browsers.md)), and smoke tests on the minimums are
  [verification debt](../roadmap.md#verification-debt).
- The higher Chrome limit does not cover redirect rules, which WebHandbrake uses whenever it has
  access to the sites.

## Confirmation

- The three versions above are fact markers read from `scripts/manifest.mjs`. The `generated`
  check of `npm run docs:check` fails when the manifest declares other versions.
- Not automated: a new minimum version is a new decision. Write an ADR that supersedes this one,
  rather than only running `npm run docs` to update the numbers here.
