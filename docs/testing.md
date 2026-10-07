# Testing WebHandbrake

WebHandbrake is tested at two levels:

| Level | Where | What it proves | Runs in |
| --- | --- | --- | --- |
| Unit | `tests/unit` (Vitest) | The pure rule engine, schedules, budgets, the DNR compiler, the change classifier, importers, the store, background modules against an in-memory fake of the WebExtension APIs | Node, a few seconds |
| End to end | `tests/e2e` (Playwright Test) | The real extension, built and installed in a **real Chromium and a real Firefox**, driven like a user would: navigation, clicks and keystrokes, popup, dashboard, intervention pages, restarts | Headless browsers, ~12 min for both on 4 cores |

Every end-to-end scenario is written once and runs in both browsers. This document explains how
that approach was chosen (§1–§3), how the suite works (§4–§6), what it covers (§7) and found
(§8), what it cannot cover (§9), and how to run and extend it (§10–§11).

## 1. What has to be verified

Most of what can go wrong in an extension like WebHandbrake happens **between** the code and the
browser, where unit tests with mocks cannot see:

- `declarativeNetRequest` redirects compiled from the rules must stop a navigation **before** the
  request leaves the browser, in both browsers, with their different regex engines, limits and
  error reporting;
- the background is a service worker in Chrome and an event page in Firefox: both are stopped by
  the browser when idle and must lose nothing;
- `storage`, `tabs`, `alarms`, `scripting`, `permissions`, `notifications`, `contextMenus` and
  `commands` behave differently in each browser (key order in storage, error codes, permission
  prompts, focus and visibility reporting);
- content scripts measure the active time and show overlays in pages the extension does not
  control;
- the extension's own pages (popup, dashboard, intervention page) must work with real input —
  the typed challenge (INT-04) **refuses synthetic input**, so a test that dispatches DOM events
  cannot even pass it;
- time drives almost everything (schedules, budgets, breaks, cooling-off), so tests must be able
  to move the clock without waiting.

The goal is therefore a suite of **scenarios on the real extension in real browsers**, headless
so that it runs in CI, fast enough to run on every change, and identical for both browsers so that
a difference between them shows up as a failing scenario rather than as a user report.

## 2. State of the art (2026)

### 2.1 Simulated browser APIs

`sinon-chrome`, `jest-chrome`, `@webext-core/fake-browser` (WXT) and similar libraries replace
`chrome.*`/`browser.*` with in-memory fakes. They are fast and deterministic and are the right
tool for logic (this repository has its own fake in `tests/unit/fake-browser.ts`). They cannot
tell whether a DNR rule really matches, whether a service worker restart loses state, how a
browser actually orders storage keys or what happens to a message when its sender closes — bugs
1, 2 and 9 in §8 were invisible to them by construction.

### 2.2 Browser automation tools

| Tool | Chromium extensions | Firefox extensions | Notes |
| --- | --- | --- | --- |
| **Playwright** | ✅ `launchPersistentContext` + `--load-extension`, headless with the new headless mode, service worker handle, CDP | ❌ Playwright's Firefox is a patched build driven by its own protocol, with no way to install an add-on | Best Chromium story; excellent runner (fixtures, parallelism, retries, traces, reports) |
| **Puppeteer** | ✅ CDP (`enableExtensions`, `installExtension`), service worker target, worker termination as recommended by the Chrome documentation | 🟡 WebDriver BiDi: add-ons can be installed (`webExtension.install`) and web pages driven, but Firefox **refuses input actions, activation and viewport changes in `moz-extension:` contexts** (privileged scope) | Chromium side comparable to Playwright, no test runner |
| **WebDriver BiDi** (W3C) | 🟡 `webExtension.install` with ChromeDriver (behind flags) | ✅ `webExtension.install`; same privileged-scope restriction as above | The standard both browsers are converging on; still incomplete for extension pages |
| **WebDriver classic** (Selenium, WebdriverIO) | ✅ `--load-extension` / packed `.crx` | ✅ geckodriver `/moz/addon/install` (temporary add-on), trusted input everywhere, including extension pages | WebdriverIO documents extension testing for both; no access to the background context in Chromium beyond what pages can do |
| **Cypress** | 🟡 `--load-extension` only; cannot visit `chrome-extension:` pages | ❌ | Not suited |
| **web-ext** | — | `web-ext run` / `lint` | Development and packaging tool, not a test driver |

Other observations that shaped the design:

- **Headless** works for extensions in both browsers today: Chromium's new headless mode is the
  full browser (the old "headless shell" cannot load extensions); Firefox's `-headless` loads
  add-ons normally.
- **Extension pages are opened as tabs.** No tool can click the toolbar button to open the popup,
  the browser's context menu or a keyboard shortcut handled by the browser UI. The usual practice
  is to open `popup.html` in a tab and call the background handlers of menus and commands.
- **Firefox gives each install a random extension UUID** (`moz-extension://<uuid>/`); the
  `extensions.webextensions.uuids` preference fixes it so tests can address the pages.
- Chrome's documentation recommends testing **service worker termination** explicitly; Firefox
  suspends event pages after `extensions.background.idle.timeout`.

### 2.3 Experiments

Before deciding, the candidate approaches were tried on this extension (Chromium 141, Firefox 157,
geckodriver 0.37):

1. **Playwright, Chromium** — loads the extension headless, reaches the service worker, drives
   the popup, dashboard and intervention pages with trusted input. Works.
2. **Playwright, Firefox** — no API to install an add-on. Dead end.
3. **Puppeteer over WebDriver BiDi, Firefox** — installs the add-on and drives web pages, but
   `input.performActions` on the dashboard or the intervention page fails (privileged scope), and
   so do `browsingContext.activate` and `setViewport`. Untrusted DOM events are not an option (the
   challenge refuses them, and real input is what users do).
4. **geckodriver with WebDriver classic** — temporary add-on install, trusted clicks and keys on
   extension pages once system access is allowed (`--allow-system-access`). Works, but tab
   management and events are clumsy in classic WebDriver.
5. **geckodriver, hybrid session** — one session, opened with `webSocketUrl: true`: classic
   commands for input, window switching and window size on extension pages; BiDi for tabs,
   navigation, scripts in any context and events. Works for everything the suite needs.

### 2.4 Evaluation

| Criterion | Playwright both | Puppeteer both | WebdriverIO/Selenium both | **Playwright + geckodriver (chosen)** |
| --- | --- | --- | --- | --- |
| Real Firefox with the add-on | ❌ | ✅ | ✅ | ✅ |
| Trusted input on extension pages, both browsers | ❌ | ❌ (Firefox) | ✅ | ✅ |
| Background access (Chromium service worker, Firefox background page) | Chromium only | ✅ | 🟡 | ✅ |
| Stopping the service worker / event page | Chromium only | ✅ | 🟡 | ✅ |
| Test runner (fixtures, parallel, retries, reports) | ✅ | ❌ | ✅ | ✅ |
| One scenario source for both browsers | — | ✅ | ✅ | ✅ (driver interface) |
| Headless in CI | ✅ | ✅ | ✅ | ✅ |
| Reuse of the existing Chromium suite and tooling | ✅ | ❌ | ❌ | ✅ |

**Decision** ([ADR 0006](adr/0006-e2e-real-browsers.md)): Playwright Test is the runner for both
browsers. Chromium is driven by Playwright; Firefox by geckodriver in a hybrid classic + BiDi
session. Both sit behind one small driver interface, and the scenarios only use the harness
built on it, so the same test runs in both browsers.

## 3. Principles

- **Real browsers, real extension.** The test build (§5) is the production code plus a few test
  entry points; nothing in the browser is mocked.
- **Real input.** Clicks, typing, key presses and pastes go through the browser's input pipeline
  (trusted events), in both browsers.
- **Black-box assertions first.** A scenario checks what a user would see (the intervention page,
  the real page, text, focus) and what the network saw (whether a request reached a blocked site);
  internal state is used only where nothing is visible (counters, logs).
- **Time is controlled, not waited for.** A test clock moves the extension's notion of "now".
- **Isolation.** Each test gets a fresh browser and profile, so tests can run in any order and in
  parallel.
- **No silent errors.** Any uncaught error or rejected promise in any extension context fails the
  test that caused it.

## 4. Architecture

```
tests/e2e/
  *.spec.ts               scenarios (Playwright Test), each run in the "chromium" and "firefox" projects
  helpers.ts              expectBlocked / expectAllowed / useUntil
  harness/
    index.ts              the `h` fixture: launch, error collection, artifacts on failure
    harness.ts            Harness, Tab, Locator: the API the scenarios use
    config.ts             builders for rules, policies, budgets, schedules
    queries.ts            in-page element resolver (role, accessible name, label, text, CSS, shadow roots)
    server.ts             local web server for every *.test host, with a request log
    driver.ts             BrowserDriver / TabDriver interface
    chromium.ts           Playwright implementation
    firefox.ts            geckodriver implementation (classic + BiDi)
    webdriver.ts          minimal WebDriver classic + BiDi client
```

**Network.** A local HTTP server answers for every host. Chromium maps all names to it with
`--host-resolver-rules`; Firefox uses proxy preferences. Each request is logged, so a scenario
can assert that **no request reached a blocked site** (pre-navigation blocking, ENF-01) and that
**the extension makes no request of its own** (PRIV-01).

**Locating elements.** `queries.ts` is one self-contained function injected into the page; it
resolves roles and accessible names, labels, placeholders and text (including open shadow roots)
the same way in both browsers. Locators wait and retry like Playwright's, and the element found
is then clicked or typed into with the browser's real input.

**Background access.** Scenarios talk to the background through the extension's own message
protocol, from a blank extension page (`test.html`), exactly as the UI does. Chromium can also
stop the service worker (CDP `Target.closeTarget`); Firefox suspends its event page when idle.

**Firefox specifics.** The add-on is installed as a temporary add-on with a fixed UUID; optional
permissions are granted without a prompt; HTTPS-first is off for the local server; extension
pages are focused and resized with classic commands because BiDi refuses them.

**Per-test lifecycle.** The `h` fixture starts the server and the browser with a new profile and
installs the test build; `h.configure()` also marks the first run as done, so only the scenarios
of the first run see it. At the end the fixture collects the errors reported by every context.
On failure it saves screenshots of every tab, the request log and a dump of the background state
as test attachments.

## 5. Test build and test seams

`npm run build:test` builds `dist-test/` with `__TEST__ = true`. The production build
(`dist/`) is the same code with `__TEST__ = false`: the test modules are left out by the bundler
(only inert `if (false)` statements remain where they are called), and the build fails if any
test entry point is left in a production bundle (`checkNoTestHooks` in `scripts/build.mjs`).

| Seam | Why |
| --- | --- |
| `test.clock` (`set`, `advance`, `detect`) | Moves the trusted clock of the background and `Date` in the extension's pages, persisted across restarts. `detect` simulates the system clock being changed by the user (SCH-07, PRO-13) |
| `test.state`, `test.errors` | Snapshot of the internal state (decisions, counters, DNR rules, content script registrations, notifications, menus); errors reported by every context |
| `test.periodic`, `test.reconcile`, `test.flush`, `test.idle` | Run an alarm, a reconciliation, a counter flush or an idle-state change now instead of waiting for the browser |
| `test.menu`, `test.command` | Dispatch a context-menu click or a keyboard command to the same handlers the browser calls |
| Open overlay shadow root | The in-page overlay can be inspected (closed in production) |
| `popup.html?tab=<id>` | The popup opened in a tab acts on another tab, as it does when opened from the toolbar |

## 6. Writing a scenario

```ts
import { test } from './harness';
import { delay, group, policy } from './harness/config';
import { expectBlocked } from './helpers';

test('INT-02: a wait lets the page through after the countdown', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test'], [policy(delay(2))])];
  });
  const tab = await expectBlocked(h, 'http://video.test/watch'); // no request reached the site
  const next = tab.button('Continue', { exact: true });
  await next.expectEnabled(false);
  await next.expectEnabled(true, 6000); // after the countdown
  await next.click(); // a real, trusted click
  await tab.expectReal('video.test/watch'); // the real page, served by the test server
});
```

- `h.configure(fn)` edits the configuration through the API, as the dashboard would.
- `h.open(url)`, `h.page('dashboard.html#/…')`, `h.popup(tab)` open tabs; `tab.role()`,
  `tab.button()`, `tab.label()`, `tab.text()`, `tab.get(css)` locate elements; `click`, `fill`,
  `type`, `paste`, `press`, `select` act; `expect*` assertions retry until they hold.
- `h.clock.advance(ms)` moves time; `h.alarm('periodic')` runs an alarm; `h.restart()` restarts
  the browser (Chromium) or reloads the add-on (Firefox) on the same profile.
- Browser-specific behaviour is the exception: use `test.skip(browserName === …, 'reason')` and
  say why.

## 7. Scenario catalogue

| File | Scenarios | Covers |
| --- | --- | --- |
| `smoke.spec.ts` | 1 | The harness end to end: block, real page, challenge through the UI, popup |
| `enforcement.spec.ts` | 24 | Matching (domains, hosts, paths, pages, wildcards, regular expressions, query parameters, exceptions, shared lists, "Always allowed"), DNR redirects before the request, every ready-made list within the browser limits, open tabs, single-page apps, back/forward cache, frames, redirects, close, private windows, reopening (ENF, MAT, SEM) |
| `interventions.spec.ts` | 26 | Block page, waits (auto-continue, hidden, increasing, random, not skippable), passes for a page, a site or a rule, intention questions, typed challenges with paste and synthetic input refused, the accessible alternative, phrases and calculations, filters and mute, reminders, alternatives, "Later", custom message and CSS, refusal to run in a frame (INT, A11Y-05) |
| `time.spec.ts` | 15 | Active time, background tabs, idle and locked screen, several tabs, exceptions, budgets per rule and per site, visits, continuous use, escalation, "Stop for today", badge, timer, warnings, grace period while typing, counter flushing (TIM, LIM, NOT, INT-13) |
| `schedules.spec.ts` | 8 | Weekly and overnight windows, "only in these windows", day start, first-match conditions, "Test a URL" and "until" (SCH, SEM) |
| `breaks.spec.ts` | 11 | Scopes, durations, budgets, costs verified in the background, reasons, metered breaks, expiry with immediate re-application, from the block page and the popup (BRK) |
| `focus.spec.ts` | 8 | Sessions from the popup, dashboard, shortcut and menu; allowlist mode; delayed start; extend; end early; locked sessions; end notification (FOC, API) |
| `protection.spec.ts` | 13 | The four levels, classification of changes, cooling-off and typed confirmation, settings password and locked hours, protected import and reset, emergency exit, protected browser pages, clock set backwards or forwards (PRO, SCH-07) |
| `data.spec.ts` | 8 | Export and import, lists of sites, sharing one rule, backups and restore, recovery of a damaged configuration at start-up, unknown fields kept, statistics export and deletion, privacy page (DAT, LST, STA, PRIV) |
| `lifecycle.spec.ts` | 14 | Install, browser restart, stopped service worker, suspended event page, self-test, diagnostics, no requests of its own, message security, content script scope, context menu and shortcuts, badge, missing host permission (REL, PRIV, SEC, DIA, PERF-03, ENF-12) |
| `popup.spec.ts` | 8 | Status of the current site, "Why?", "Block site", "Save for later", reopening tabs, counts, width, buttons after the background was stopped |
| `dashboard.spec.ts` | 12 | Every page at desktop and phone widths, the rule wizard, the first run, the editor, the rule list, shared lists, "Always allowed", theme, insights (ONB, SET, MAT-18, MAT-22, STA) |
| `a11y.spec.ts` | 4 | axe-core WCAG 2.2 AA on every page and state in both themes, the popup and intervention pages; keyboard, focus, countdown announcements (A11Y-01…03) |

Some scenarios are generated by loops (themes, widths), and each runs in both browsers:
**308 test runs** in total. Four are skipped in Chromium: the suspended event page, which only
Firefox has, and three browser limits listed in §9. [`traceability.md`](traceability.md) maps the
requirements to the tests (`E` in its Tests column).

## 8. Bugs found by the suite

Writing the scenarios found these bugs, all fixed with a regression test (unit or end to end):

1. **Chrome: the configuration was "restored from a backup" after every service-worker restart.**
   Chrome returns stored objects with their keys sorted, so the integrity checksum of the saved
   configuration never matched and the extension rolled back to the last snapshot, losing recent
   changes. The checksum is now computed on canonical JSON (with a migration for existing data).
2. **Firefox: without access to the sites, a blocked page stayed on an empty error page** (ENF-12):
   Firefox reports the error of a blocking rule as a number (`NS_ERROR_ABORT`).
3. **Passes for `http://` pages never applied:** the key of the page did not match, so "Continue"
   led back to the intervention page in a loop.
4. **In-page labels lost their values:** the reminder title, the timer's label and accessible name
   and the grace-period countdown showed empty placeholders.
5. **The intention typed at the entry question was never recalled on the page** (INT-03).
6. **Reminders were shown again on every page of the same visit.**
7. **The "Block this site" shortcut could add the site to an archived rule**, where it blocked
   nothing; menu and shortcut changes were not serialised with other configuration changes.
8. **The diagnostics log of recent decisions stayed empty** for restrictions applied by the browser
   filters.
9. **Chrome: the popup's Dashboard and Set up buttons did nothing after the browser had stopped the
   service worker:** the popup closed itself before its request reached the background, which had
   to start first. Found as a rare failure under load, then reproduced every time by stopping the
   service worker in the test.

## 9. Limits and what covers them

| Not covered end to end | Why | Covered instead by |
| --- | --- | --- |
| Opening the popup from the toolbar button; the browser's context menu UI; shortcuts typed in the browser UI | No automation tool can operate the browser's own UI | `popup.html?tab=` in a tab; `test.menu` / `test.command` call the same handlers; the declared commands are checked |
| Background-tab and unfocused-window time in Chromium | Headless Chromium reports every tab as visible and focused | The same scenario runs in Firefox; unit tests of the accounting |
| Optional permission prompts in Chromium (notifications) | Chromium shows a browser prompt automation cannot answer | The scenario runs in Firefox, where prompts are disabled for tests |
| Missing host access in Chromium (ENF-12) | Chromium does not let an extension give back a host permission declared in its manifest | The scenario runs in Firefox, where the user can withdraw it |
| `runtime.reload()` in Chromium | Under automation the reloaded extension stays disabled | Browser restart on the same profile (`h.restart()`) |
| Firefox for Android (TIM-04, DAT-05 on Android) | No Android emulator in CI | Manual device tests (`web-ext run -t firefox-android`) |
| Store-installed (signed) builds, updates from the store | Temporary/unpacked installs only | `npm run package` + manual checks |
| Real-time waits longer than a few seconds | Too slow | The test clock |

## 10. Running the suite

```bash
npm ci
npm run browsers            # Playwright's Chromium, Firefox (current release) and geckodriver into .cache/browsers
npm run test:e2e            # test build + both browsers
npm run test:e2e:chromium   # one browser
npm run test:e2e:firefox
npx playwright test tests/e2e/focus.spec.ts --project=firefox -g "FOC-02"   # one scenario (after npm run build:test)
```

| Variable | Effect |
| --- | --- |
| `CHROMIUM_BIN`, `FIREFOX_BIN`, `GECKODRIVER_BIN` | Use these binaries instead of the ones in `.cache/browsers` |
| `HEADED=1` | Show the browsers |
| `E2E_WORKERS=n` | Parallel workers (default 3) |

Failures leave screenshots of every tab, the request log and the background state in
`test-results/`; CI uploads them as artifacts. In CI each browser is a separate job, with one
retry: a test that passes only on the retry is reported as flaky and should be fixed.

## 11. Timings

Measured on a 4-core, 16 GB container with 3 workers (Chromium 141, Firefox 157), each test with
its own fresh browser:

| | Runs | Median | Slowest | Total test time | Wall time (3 workers) |
| --- | --- | --- | --- | --- | --- |
| Chromium | 150 (+4 skipped) | 3.1 s | 32 s | 10.7 min | ~4 min |
| Firefox | 154 | 8.1 s | 35 s | 23.3 min | ~8 min |
| Both, one machine | 308 | | | | 11.6 min |

The slowest scenarios measure real use over tens of seconds (continuous-use limits, idle
detection), where the test clock cannot stand in for the content script's ticks. Three full runs
of both browsers, without retries, were made while finishing the suite; they found two
intermittent failures, a launch race in the harness and a race in a scenario, both fixed. A run
with more workers than cores, to load the machine, found bug 9 of §8. The unit tests take a few
seconds.
