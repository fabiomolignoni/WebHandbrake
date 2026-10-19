# Changelog

All notable changes to WebHandbrake are documented here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The address guide of a rule shows how to cover every website (`*`), with exceptions for the
  sites you still need.
- Help lists the keyboard shortcuts with the keys the browser has actually given them, including
  the one without a default key (open the dashboard), and **Change shortcuts** opens the browser's
  shortcut settings.

### Fixed

- Keyboard shortcuts work in Firefox and Chrome: they are now Alt+Shift+1 (open the popup),
  Alt+Shift+2 (start a focus session) and Alt+Shift+3 (block the current site). In Firefox on
  Windows and Linux, Alt+Shift+H, Alt+Shift+F and Alt+Shift+B opened the Help, File and Bookmarks
  menus instead; Chrome never gave Alt+Shift+B, one of its own shortcuts.
- Two loosening changes took effect without the protection of the rules: a shorter inactivity
  delay, which counts less time, and, when days start after midnight, a time window moved before
  the start of the day, which then applies on the following night.
- A new rule whose wizard was left after choosing a password or a partner code, and resumed later,
  was created with a 30-second wait: the wizard now asks for the protection again.
- Focus sessions: the preview of a session of another length said that it would end at once; and
  a quick session (Today, the keyboard shortcut, the context menu) no longer starts when no rule is
  in quick sessions, since it would block nothing: Today says how to add rules to them, and the
  shortcut opens the Focus page.
- Durations of more than two days that are not whole days, such as 50 hours, were shown as
  2 days.
- Insights, when days start after midnight: today's bar, and the breaks and the reasons of a
  period, followed calendar days instead of the days of the statistics.

## [1.0.0] - 2026-10-15

The first version of WebHandbrake.

### Added

- Rules for the sites you choose: domains, hosts, paths, pages, home pages, wildcards, query
  parameters, regular expressions and exceptions; shared lists and an **Always allowed** list;
  ready-made lists, including platforms in every country (`amazon.*`).
- A new rule in five steps (sites, when, what happens with its main settings, protection,
  review), and an editor with the same steps and look: it opens on an overview of the rule with a
  **Change** link for each part, marks the parts with unsaved changes or problems, and writes
  conditions as "When → Then" sentences.
- Conditions with weekly and overnight time windows, and time, visit and continuous-use limits per
  hour, day, week, month, custom or rolling period, per site or per rule.
- Interventions: count only, visual filter, a question about what you want to do (a reason is
  required; a duration chosen or typed), wait, typed challenge, block, close and redirect; saving
  pages for later; a grace period while you are typing. When several rules apply to a page, each
  of them applies: the strictest asks first, the page opens once every rule lets you in, and their
  filters add up.
- Blocking before the page loads with the browser's own blocking filters, from browser start, with
  checks for single-page applications, the back/forward cache, browser pages and local files.
- Breaks from a block, with scope, duration, limits, cost and reason; focus sessions, including
  sessions that allow only chosen sites and sessions that cannot be interrupted.
- A protection per rule, chosen in the wizard, the editor or first run: a reminder, a wait of the
  length you choose (a pending change when it is long), a password, a partner code from an
  authenticator app, Locked until a date, or Permanent until the emergency exit. Stricter changes
  apply at once, loosening changes take what the rules they loosen ask; what a restore, an import
  or a reset loosens, and loosening the settings of the protection itself, waits as long as the
  emergency exit, for that change only; protected browser pages (off by default), an emergency
  exit, a log of protection events and clock checks.
- Popup, dashboard, intervention page, on-page timer, badge, notifications, context menu and
  keyboard shortcuts.
- Statistics kept on the device, insights, export as CSV or JSON, and deletion.
- Export and import of settings, rules and lists, including plain lists of sites, hosts files and
  uBlock Origin, AdGuard and uBlacklist filters; automatic backups with integrity checks.
- A welcome that lets you create your first rule, with the same steps as any new rule, or skip;
  offline Help, and diagnostics with a self-test and a report without addresses.
- Light, dark and high-contrast themes, layouts down to phone size, and keyboard and
  screen-reader support.
- Firefox, Firefox for Android and Chrome from one code base.

[Unreleased]: https://github.com/fabiomolignoni/WebHandbrake/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/fabiomolignoni/WebHandbrake/releases/tag/v1.0.0
