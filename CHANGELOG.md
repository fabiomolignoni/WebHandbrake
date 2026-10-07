# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Redesigned interface (see [`docs/ux-redesign.md`](docs/ux-redesign.md)): one visual language
  for the friction ladder (a tone, an icon and words for every state), a status-first popup with
  quick-action tiles and a preview of what "Block this site" adds, a Today page that leads with
  what is happening now, clickable group rows with an overflow menu, a one-page group editor with
  a section nav, rules as "When → Then" sentence cards and a friction picker, an intervention page
  that presents the healthy choice and "continue" as one decision, a reorganised protection
  centre, setting rows, segmented controls and stronger input contrast.

- "Groups" are now called **Rules** and the lines inside them **conditions**; the browser's
  technical rules are called browser filters in Diagnostics. A new rule is created in four steps
  (sites, when, what happens, review), with ready-made lists, every intervention to choose from
  and the plan stated in one sentence; the full editor stays one click away.

- New first run: a welcome with "Set up" and "Skip setup" side by side, then your goal, sites
  (ready-made lists, your own sites and a summary of the rules that will be created), hours or
  daily time, what happens (all nine interventions with a preview) and your plan. Nothing is
  pre-selected or labelled as recommended: the choice is yours.
- New brand colour and default accent (indigo), with the icons, overlay and themes updated; the
  previous default accent is migrated automatically.
- Unrestricted states are called **Allowed** instead of "Free"; a rule that only counts shows
  "Time counted".
- Ready-made lists cover whole platforms in every country (`amazon.*`) and their alternative
  domains.
- The addresses of the gambling and adult lists are hidden unless you ask to see them.
- The popup has a labelled **Dashboard** button; the footer link opens Insights.
- The sites editor has a short "How to write an address" guide with examples to pick.
- Help → About links to the source code and to the issue tracker; Diagnostics links to a new
  issue next to the report. "Run the setup again" was removed.

### Added

- End-to-end tests run every scenario with the real extension in both Chromium and Firefox
  (headless, in CI), from popup, dashboard and intervention pages to restarts, time limits,
  schedules, protection and accessibility checks. See [`docs/testing.md`](docs/testing.md).

### Removed

- The importer for another extension's settings. Lists of sites are still imported from plain
  lists, hosts files and uBlock Origin / AdGuard / uBlacklist syntax.

### Fixed

- In Chrome, the configuration was reported as damaged and replaced by the previous backup every
  time the background restarted (about 30 s after the last activity), undoing recent changes.
- Passes and breaks for a single page did not work on `http://` pages: the page and the
  intervention page alternated in a loop.
- In Firefox, when the extension has no access to the sites, a blocked page now shows the
  WebHandbrake page instead of an empty error page.
- The on-page reminder, the timer (and its label for screen readers) and the grace-period
  countdown no longer show empty placeholders instead of the rule name and the time.
- The intention given at the entry question is now recalled on the page, once.
- Reminders are shown once per visit, not on every page of it.
- The "Block this site" keyboard shortcut no longer adds the site to an archived or disabled rule.
- The diagnostics log of recent decisions now records the pages stopped by the browser filters.
- In Chrome, the popup's Dashboard and Set up buttons did nothing when the browser had stopped the
  extension's background: the popup closed before its request could be delivered.
- Choosing a gentler protection level during the first run no longer asks to wait or confirm
  while nothing is protected yet (no rules and no focus session).
- Addresses with wildcards, paths or every-country endings (`amazon.*`) are installed as one
  browser filter each: merged filters exceeded Chrome's memory limit for regular expressions and
  were left to the slower fallback, so the page could start loading before being stopped.
- Creating a rule or finishing the setup can no longer add the rules twice (double click, or a
  gentler level waiting for its cost).
- The popup no longer offers a quick focus session when no rule would apply to it.
- On the intervention page, what was typed for one step no longer carries over to the next one,
  and the first duration offered is always within the allowed maximum.
- Links to a dashboard page (Help from the sites guide, pages opened from the popup) work while
  the setup is still in progress.
- A sentence pasted into a list of sites is reported once, and words without a dot are no longer
  added as sites.
- In the dark theme, links no longer turn navigation items and rule names teal.
- The popup no longer repeats the next step ("then Wait … · then Wait"); the rule editor no
  longer shows "What happens" twice.

## [1.0.0] — unreleased

First version (release R1 of the requirements).

### Added

- Groups of sites with domains, hosts, paths, pages, home pages, wildcards, query parameters,
  regular expressions and exceptions; shared lists and a global "Always allowed" list.
- Rules with weekly and overnight windows, time, visit and continuous-use limits (calendar,
  custom and rolling periods, per site or per group), evaluated first-match within a group and
  most-severe across groups.
- Interventions: count only, reminder, filters, intention question, delay, typed challenge, block,
  close, redirect; save for later; grace period for unsaved text.
- Pre-navigation blocking with declarativeNetRequest, re-checks for single-page apps, back/forward
  cache, browser pages and local files; reopening of tabs when a restriction ends.
- Breaks with scope, duration, budgets, costs and reasons; focus sessions with allowlist mode.
- Protection levels with automatic strengthening/weakening classification, cooling-off, access
  password and codes, protected browser pages, emergency exit, tamper log, clock checks.
- Popup, dashboard, intervention pages, on-page timer, badge, notifications, context menu and
  keyboard shortcuts.
- Local statistics and insights, CSV/JSON export and deletion.
- Export/import (including plain lists of sites), automatic backups with integrity checks and restore.
- Onboarding, offline help, diagnostics with self-test and redacted report.
