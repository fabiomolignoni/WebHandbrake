# Testing

WebHandbrake has two kinds of automated tests and a short list of manual checks.

| Level | Where | Runs in | Proves |
| --- | --- | --- | --- |
| Unit | `tests/unit` (Vitest) | Node | The pure engine (matching, schedules, limits, browser filters, change classification) and background modules against an in-memory fake of the browser APIs (`tests/unit/fake-browser.ts`) |
| End to end | `tests/e2e` (Playwright Test) | Real Chromium and real Firefox, headless | The built extension doing what a person sees: navigation, intervention pages, popup, dashboard, restarts, time and protection |
| Manual | [Manual checks](#manual-checks) | A person, on real devices | What no automation can reach |

Why both browsers and real input: [ADR 0006](adr/0006-e2e-real-browsers.md).

## Set up

```bash
npm ci
npm run browsers
```

`npm run browsers` installs Playwright's Chromium in Playwright's cache, and Firefox stable and a
pinned geckodriver in `.cache/browsers`, whose paths it writes to `.cache/browsers/paths.json`. It
needs network access to GitHub and Mozilla.

## Run

| Command | What it runs |
| --- | --- |
| `npm test` | Unit tests |
| `npm run test:e2e` | The test build, then every scenario in both browsers |
| `npm run test:e2e:chromium`, `npm run test:e2e:firefox` | The same scenarios in one browser |
| `npx playwright test tests/e2e/focus.spec.ts --project=firefox -g "FOC-02"` | Matching scenarios of one file, after `npm run build:test` |

CI runs the unit tests in the `check` job and the end-to-end scenarios as one job per browser,
with one retry: a scenario that passes only on the retry is flaky and must be fixed. On failure,
CI uploads `test-results/` and `playwright-report/`.

## Environment variables

| Variable | Effect |
| --- | --- |
| `CHROMIUM_BIN` | Use this Chromium binary |
| `FIREFOX_BIN` | Use this Firefox binary |
| `GECKODRIVER_BIN` | Use this geckodriver binary |
| `HEADED` | Show the browsers |
| `E2E_WORKERS` | Number of parallel workers |
| `WHB_SCREENSHOTS` | A folder where `tests/e2e/dashboard.spec.ts` saves a screenshot of every dashboard page |

## How the harness works

- **Two drivers, one interface.** `tests/e2e/harness/driver.ts` defines what a scenario may do.
  `tests/e2e/harness/chromium.ts` implements it with Playwright, and
  `tests/e2e/harness/firefox.ts` with geckodriver in one session that uses WebDriver classic for
  input on extension pages and WebDriver BiDi for the rest. Scenarios use only
  `tests/e2e/harness/harness.ts`, so each runs unchanged in both browsers. A browser-specific skip
  states its reason in the test.
- **Real input.** Clicks, typing, key presses and pastes go through the browser's input, so the
  typed challenge accepts them as it would from a person.
- **A local server answers for every host** (`tests/e2e/harness/server.ts`) and logs every
  request. `expectBlocked()` in `tests/e2e/helpers.ts` uses the log to prove that no request
  reached a blocked site, and a lifecycle scenario proves that the extension sends none of its own.
- **A fresh browser and profile per test**, so tests run in any order and in parallel.
- **Errors fail the test.** An uncaught error, rejected promise or `console.error` in an extension
  page, the background or a content script fails the test that caused it, unless the test calls
  `h.allowErrors()`. On failure the fixture saves a screenshot of every tab and attaches the
  request log and the background state.
- **Elements are found the same way in both browsers** by `tests/e2e/harness/queries.ts`: role,
  accessible name, label, text or CSS, including open shadow roots.

## Test build and seams

`npm run build:test` writes `dist-test/` with `__TEST__` set to true. It adds:

| Seam | Purpose |
| --- | --- |
| `test.clock` (`set`, `advance`, `detect`) | Moves the trusted clock of the background and `Date` in extension pages, kept across restarts; `detect` simulates a person changing the system clock |
| `test.state`, `test.errors` | The background's state and the errors reported by every context |
| `test.periodic`, `test.reconcile`, `test.flush`, `test.idle` | Run an alarm, a reconciliation, a counter flush or an idle change now |
| `test.menu`, `test.command` | Send a context-menu click or a keyboard command to the handlers the browser would call |
| Open shadow root of the in-page overlay | Lets scenarios inspect it (closed in packages) |
| `popup.html?tab=<id>` | The popup in a tab acts on another tab, as it does from the toolbar |

The seams live in `src/background/testing.ts` and `src/shared/test-hooks.ts`, inside
`if (__TEST__)`. A packaged build refuses to finish if one is left in a bundle
([ADR 0011](adr/0011-auditable-build.md)).

## Write a scenario

`tests/e2e/smoke.spec.ts` is a short complete example. The fixture `h` gives:

- `h.configure(fn)`: change the configuration through the background, as the dashboard does,
  paying any cost it asks;
- `h.open(url)`, `h.page('dashboard.html#/…')`, `h.popup(tab)`: open tabs;
- `tab.role()`, `tab.button()`, `tab.label()`, `tab.text()`, `tab.get(css)`: find elements, then
  `click`, `fill`, `type`, `paste`, `press` or `select`, and assert with `expect*` methods that
  retry;
- `h.clock.advance(ms)`, `h.alarm('periodic')` and `h.restart()` (a browser restart in Chromium, an
  add-on reload in Firefox, on the same profile).

Put the requirement IDs a scenario verifies in its title (`'PRO-15: …'`):
`docs/traceability.md` is generated from test titles.

## Unit tests

Engine tests build configurations with the helpers in `tests/unit/helpers.ts`. Background tests
call `installFakeBrowser()`; `installFakeBrowser({ chrome: true })` also sorts stored object keys
the way Chrome does.

## Manual checks

Before each release, on the browsers named in the [release checklist](releasing.md#release-checklist):

- TIM-04 On Firefox for Android, time is counted only while the page is in front.
- ENF-05 After a browser restart that restores tabs, restricted tabs show the intervention page and
  pinned tabs stay pinned.
- ENF-07 A site that blocks scripts or runs `beforeunload` handlers is still restricted.
- DAT-05 On Firefox for Android, export and import work, including **Copy as text**.
- REL-03 A smoke test on Firefox for Android with `npx web-ext run -t firefox-android`: block a
  site, take a break, start a focus session.
- COMP-03 On Firefox for Android, the dashboard works by touch and nothing depends on shortcuts or
  the context menu.
- A11Y-01 A keyboard-only pass and a screen-reader pass (NVDA with Firefox, VoiceOver with Chrome)
  over the popup, the intervention page and the rule wizard.

Also by hand, because no tool reaches them: opening the popup from the toolbar button, the
browser's own context menu and shortcut settings, and a store-signed install and update.
