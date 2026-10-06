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
  (sites, when, what happens, review), with ready-made lists, a recommended option and the plan
  stated in one sentence; the full editor stays one click away.

### Fixed

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
- Export/import (including LeechBlock NG), automatic backups with integrity checks and restore.
- Onboarding, offline help, diagnostics with self-test and redacted report.
