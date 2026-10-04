# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

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
