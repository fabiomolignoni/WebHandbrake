# ADR 0001 — Manifest V3 everywhere, declarativeNetRequest first

- Status: accepted
- Date: 2026-10-04
- Requirements: COMP-02, ENF-01, ENF-08, ENF-09, ENF-12, PERF-02, PERF-05

## Context and problem statement

WebHandbrake has to stop a navigation to a restricted page before the request leaves the browser
(ENF-01), in Chrome, Firefox and Firefox for Android, from one code base (COMP-02).

Chrome accepts only Manifest V3 extensions. Manifest V3 replaces blocking `webRequest` with
declarativeNetRequest (DNR, the "browser blocking filters" of the [glossary](../glossary.md)): the
extension installs rules and the browser applies them itself, within limits on the number of rules
and of regular expressions. Firefox supports Manifest V3 and DNR, and still offers blocking
`webRequest`.

What applies to a page depends on a lot of state: schedules, limits, breaks, focus sessions,
exceptions and the order of conditions. Which mechanism stops navigations, and what happens to the
cases that the browser's rules cannot express?

## Considered options

1. **Manifest V3 on Chrome, Manifest V2 with blocking `webRequest` on Firefox.**
   - Good: on Firefox the engine itself decides every request, so DNR's limits do not apply there.
   - Bad: two manifests and two enforcement paths to keep in step. Every navigation waits for the
     background, which the browser may have stopped. Chrome still needs DNR, so the hard part
     remains.
2. **Content scripts only:** a script in every page hides or replaces it.
   - Good: no network-filtering permission, and any rule can be expressed.
   - Bad: the request reaches the site and the page starts to render before the script runs. It
     needs a script in every page, and it does nothing where scripts cannot run.
3. **Manifest V3 everywhere, DNR first, with a second layer in the background.**
   - Good: the browser stops the request before it is sent, even while the background is stopped.
     One design serves both browsers.
   - Bad: DNR's limits and syntax constrain the compiler, and the rules must be recompiled whenever
     a decision may change.

## Decision outcome

Chosen: option 3, because it stops requests before they are sent, with one design for every
supported browser, even while the background is stopped.

- **One manifest version.** The background is a service worker in Chrome and an event page in
  Firefox, built from one bundle. Blocking `webRequest` is not used; `webRequest` only observes the
  date of responses for the clock check ([ADR 0009](0009-permissions.md)).
- **Compilation.** The engine compiles the current decisions into dynamic DNR rules
  (`compileDnr()` in `src/engine/dnr.ts`), and `src/background/dnr-sync.ts` installs them, one
  update at a time and only when they changed. Each distinct site entry is a region, and so is
  each page or site with a running break or access: the engine decides a representative address
  of the region, and the rule's priority grows with the entry's specificity, with one more for a
  rule that stops navigation. The browser applies the matching
  rule with the highest priority, so the most specific entry decides, as SEM-06 requires.
- **Redirects.** With access to the sites, a navigation rule redirects to
  `intervention.html#<original address>` through `regexSubstitution`:
  - plain domains share a few rules that list them in `requestDomains` and capture the whole
    address with `regexFilter: ^(.*)$`;
  - every other entry (paths, wildcards, regular expressions) gets its own rule with
    `regexFilter: ^(<expression>)$`;
  - during a focus session that allows only a list of sites, one catch-all rule,
    `^(https?://.*)$`, redirects every other web page;
  - redirect destinations get an allow rule above all the others (ENF-09).
- **Without access to the sites** (ENF-12), the same rules block instead of redirecting, because a
  redirect needs host access. The second layer then replaces the browser's error page with the
  intervention page.
- **Limits.** The compiler reads the browser's limits (`dnrLimits()`). Over them, it keeps the
  navigation rules first, then the higher priorities. The entries left out, the expressions that
  the browser's regular-expression engine rejects (`isRegexSupported()`) and the exceptions that DNR
  could only approximate go to the second layer; **Settings › Diagnostics** lists them and the
  Today page shows a warning. If the browser refuses an update, the rules that cannot fail (plain
  domains) are installed and the error is kept for Diagnostics.
- **Second layer.** `src/background/enforce.ts` re-checks committed navigations, route changes in
  single-page applications, pages restored from the back/forward cache, browser pages and every
  open tab when the state changes; [the architecture](../architecture.md#enforcement) lists the
  cases. The intervention page asks the background for the decision again before showing
  anything, so the engine always has the last word.
- **The intervention page is web-accessible**, because a DNR redirect can load an extension page
  only if `web_accessible_resources` lists it ([ADR 0009](0009-permissions.md) records what this
  exposes).

## Consequences

Good:

- In the common case no request reaches a restricted site and the page never starts to load.
- Dynamic rules persist across browser restarts and apply before the background has started
  (ENF-08).
- Chrome, Firefox and Firefox for Android share one enforcement design.

Bad:

- The rules are recompiled after every change of state that can change a decision (a schedule
  boundary, a break, a used-up limit). A signature comparison skips updates that change nothing.
- What DNR cannot express is caught by the second layer, when the navigation starts or after it
  commits, so the request may reach the site and the page may start to load for a moment: for
  example rules limited to private or normal windows, and entries over the browser's limits.
- Each regular expression needs a rule of its own, because browsers cap the memory of each
  expression, and regular-expression rules are the scarcest kind.
- Redirects need access to every site, and the web-accessible intervention page lets sites detect
  the extension in Chrome ([ADR 0009](0009-permissions.md)).

## Confirmation

- The ENF-01 scenarios in `tests/e2e/enforcement.spec.ts` check, through the test server's request
  log, that a restricted site receives no request while other sites load, and that every
  ready-made list fits in the browser's rules with nothing left to the second layer.
- The ENF-08 scenario in `tests/e2e/lifecycle.spec.ts` checks that the rules survive a restart and
  apply before the first page loads.
- The unit tests "DNR compilation" and "redirect destinations (ENF-09)" in
  `tests/unit/engine.test.ts` check the rules the compiler emits, with and without host access.
- Both end-to-end projects run in CI for every pull request (`npm run test:e2e:chromium`,
  `npm run test:e2e:firefox`).
