# ADR 0006 — End-to-end tests in real Chromium and Firefox from one set of scenarios

- Status: accepted
- Requirements: REL-03, COMP-01, COMP-02, A11Y-01
- Details: [`docs/testing.md`](../testing.md)

## Context

The behaviour that matters most (declarativeNetRequest redirects, the service worker and the
Firefox event page being stopped, storage, permissions, content scripts, real input on the
extension's pages) differs between Chromium and Firefox and cannot be observed with simulated
browser APIs. The end-to-end suite ran in Chromium only; Firefox had a single smoke test.

Playwright, the Chromium runner, cannot install add-ons in Firefox. Puppeteer and WebDriver BiDi
can install them, but Firefox refuses BiDi input actions, activation and viewport changes in
`moz-extension:` pages, and the typed challenge refuses untrusted input. geckodriver's classic
WebDriver commands do provide trusted input there.

## Decision

- Playwright Test is the runner for both browsers (`chromium` and `firefox` projects).
- Chromium is driven by Playwright; Firefox by geckodriver in one hybrid session: classic commands
  for input, focus and window size on extension pages, BiDi for tabs, navigation, scripts and
  events.
- Both implement a small driver interface; scenarios use only the harness built on it, so every
  scenario runs unchanged in both browsers. Browser-specific skips state their reason.
- A test build (`dist-test`, `__TEST__`) adds a test clock and test entry points; the production
  build is checked to contain none of them.
- A local server answers for every host and logs requests; each test gets a fresh browser and
  profile.

## Consequences

- Differences between the browsers are caught by the same scenario failing in one of them (two
  such bugs were found while writing the suite).
- The Firefox driver is our own code (~500 lines) on top of geckodriver, to be maintained as
  WebDriver BiDi evolves; when BiDi accepts input on extension pages it can replace the classic
  commands.
- The suite needs geckodriver and a Firefox release besides Playwright's Chromium
  (`npm run browsers`). It takes about 4 minutes in Chromium and 8 in Firefox on 4 cores; in CI
  each browser is a separate job, run in parallel.
- The toolbar popup, the browser's context menu and shortcut UI, and Firefox for Android remain
  outside automated tests (see `docs/testing.md` §9).
