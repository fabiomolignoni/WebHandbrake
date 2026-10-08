# ADR 0006 — One scenario set in real Chromium and Firefox

- Status: accepted
- Date: 2026-10-07
- Requirements: REL-03, COMP-01, COMP-02, A11Y-01

## Context and problem statement

What matters most in WebHandbrake happens between its code and the browser, where simulated
browser APIs cannot see:

- declarativeNetRequest redirects must stop a navigation before the request is sent, in two
  browsers with different regular-expression engines, limits and error reports;
- the background is a service worker in Chrome and an event page in Firefox, and both browsers
  stop it when idle;
- storage, tabs, alarms, permissions and content scripts behave differently in each browser;
- the typed challenge refuses synthetic input, so only real input can pass it;
- time drives schedules, limits, breaks and cooling-off, so tests must move the clock without
  waiting.

How is the extension tested end to end, in which browsers, and with which tools?

## Considered options

As evaluated on 2026-10-07, with Playwright 1.63, Chromium 141, Firefox 157 and geckodriver 0.37.
The ways to drive Firefox were tried on this extension: Playwright, Puppeteer over WebDriver BiDi,
geckodriver with WebDriver classic, and the hybrid geckodriver session. The other points come from
the tools' documentation.

1. **Simulated browser APIs only**, such as the fake in `tests/unit/fake-browser.ts`.
   - Good: fast and deterministic; the right tool for logic, and kept for the unit tests.
   - Bad: cannot show whether a rule really matches, whether a stopped background loses state, how
     a browser orders stored keys, or what happens to a message when its sender closes.
2. **Playwright for both browsers.**
   - Good: the best Chromium support (an extension loaded in a persistent context, a handle on the
     service worker, the DevTools protocol, headless mode) and a complete test runner.
   - Bad: Playwright's Firefox is a patched build driven by its own protocol, with no way to install
     an add-on. A dead end for Firefox.
3. **Puppeteer for both browsers**, with WebDriver BiDi for Firefox.
   - Good: installs the add-on in Firefox and drives web pages.
   - Bad: Firefox refuses BiDi input actions, `browsingContext.activate` and viewport changes in
     `moz-extension:` pages, and untrusted DOM events cannot pass the typed challenge. No test
     runner.
4. **WebdriverIO or Selenium (WebDriver classic) for both browsers.**
   - Good: trusted input everywhere, extension pages included; geckodriver installs temporary
     add-ons.
   - Bad: little access to Chromium's background, and tabs and events are clumsy in classic
     WebDriver.
5. **Cypress.**
   - Bad: cannot open `chrome-extension:` pages and cannot install Firefox add-ons. Not suited.
6. **Playwright Test as the runner; Playwright for Chromium; geckodriver for Firefox in one hybrid
   session**, both behind one driver interface.
   - Good: real browsers and trusted input in both; Playwright's fixtures, parallel workers,
     retries and reports; one scenario source.
   - Bad: the Firefox driver is the project's own code on top of geckodriver.

Observations that shaped the choice: no tool can click the toolbar button, use the browser's own
context menu or press a shortcut handled by the browser; Firefox gives each installation a random
extension address unless a preference fixes it; and both browsers load extensions headless.

## Decision outcome

Chosen: option 6, because it is the only option with trusted input on extension pages and full
access to the background in both browsers, together with a complete test runner.

- Playwright Test runs every scenario in two projects, `chromium` and `firefox`
  (`playwright.config.ts`).
- Chromium is driven by Playwright. Firefox is driven by geckodriver in one session that uses
  WebDriver classic for input, focus and window size on extension pages, and WebDriver BiDi for
  tabs, navigation, scripts and events.
- Both implement the interface in `tests/e2e/harness/driver.ts`. Scenarios use only the harness
  built on it, so each scenario runs unchanged in both browsers; a browser-specific skip states its
  reason.
- A test build (`dist-test/`, [ADR 0011](0011-auditable-build.md)) adds a test clock and test
  entry points. A local server answers for every host and logs every request. Each test gets a
  fresh browser and profile.
- geckodriver is pinned (`GECKODRIVER` in `scripts/browsers.mjs`); Firefox is the stable release at
  the time of installation, and Chromium is Playwright's build (`npm run browsers`).
- The popup's interface is tested by opening `popup.html?tab=<id>` in a tab, which only the test
  build accepts. Context-menu items and keyboard commands are dispatched to the handlers the
  browser would call. [The testing guide](../testing.md#how-the-harness-works) describes the
  harness.

Revisit this decision when Firefox accepts WebDriver BiDi input on `moz-extension:` pages (the
classic half of the session can go), or when Playwright can install Firefox add-ons (the Firefox
driver can go).

## Consequences

Good:

- A difference between the browsers shows up as the same scenario failing in one of them.
- Scenarios use the browsers' real input, so they exercise what people do, the typed challenge
  included.

Bad:

- The Firefox driver (`tests/e2e/harness/firefox.ts` and `webdriver.ts`) is the project's code to
  maintain as WebDriver BiDi evolves.
- The suite needs geckodriver and a Firefox release besides Playwright's Chromium.
- The suite runs on current browser releases only, not on the minimum versions
  ([ADR 0010](0010-minimum-browser-versions.md)).
- Opening the popup from the toolbar button, the browser's own menu and shortcut interface,
  Firefox for Android and store-signed builds stay outside automation; they are
  [manual checks](../testing.md#manual-checks).

## Confirmation

- The `e2e` job of `.github/workflows/ci.yml` runs `npm run test:e2e:chromium` and
  `npm run test:e2e:firefox` as two matrix jobs for every pull request and every push to `main`; a
  scenario that fails in either browser fails CI.
