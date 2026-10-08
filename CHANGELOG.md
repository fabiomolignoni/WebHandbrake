# Changelog

All notable changes to WebHandbrake are documented here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), as described in
[versioning](docs/releasing.md#versioning).

## [Unreleased]

The first version. Nothing has been released yet.

### Added

- Rules for the sites you choose: domains, hosts, paths, pages, home pages, wildcards, query
  parameters, regular expressions and exceptions; shared lists and an **Always allowed** list;
  ready-made lists, including platforms in every country (`amazon.*`).
- A new rule in four steps (sites, when, what happens, review), and a full editor with conditions
  written as "When → Then" sentences.
- Conditions with weekly and overnight time windows, and time, visit and continuous-use limits per
  hour, day, week, month, custom or rolling period, per site or per rule.
- Interventions: count only, reminder, visual filter, intention question, wait, typed challenge,
  block, close and redirect; saving pages for later; a grace period while you are typing.
- Blocking before the page loads with the browser's own blocking filters, from browser start, with
  checks for single-page applications, the back/forward cache, browser pages and local files.
- Breaks with scope, duration, limits, cost and reason; focus sessions, including sessions that
  allow only chosen sites.
- Protection levels (Soft, Balanced, Strict, Locked): stricter changes apply at once, loosening
  changes cost a confirmation, a wait or a cooling-off period; settings password, protected
  browser pages, an emergency exit, a log of protection events and clock checks.
- Popup, dashboard, intervention page, on-page timer, badge, notifications, context menu and
  keyboard shortcuts.
- Statistics kept on the device, insights, export as CSV or JSON, and deletion.
- Export and import of settings, rules and lists, including plain lists of sites, hosts files and
  uBlock Origin, AdGuard and uBlacklist filters; automatic backups with integrity checks.
- A welcome that lets you set up your first rules or skip, offline Help, and diagnostics with a
  self-test and a report without addresses.
- Light, dark and high-contrast themes, layouts down to phone size, and keyboard and
  screen-reader support.
- Firefox, Firefox for Android and Chrome from one code base.

[Unreleased]: https://github.com/fabiomolignoni/WebHandbrake/commits/main
