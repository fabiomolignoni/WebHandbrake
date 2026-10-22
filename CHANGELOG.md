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
- Insights shows a day hour by hour, and the day-by-day chart can split each day by site (**By
  site**): the six sites with the most time in the period, the rest as "Other sites". The hours
  are kept from this version on; for the last two days they are rebuilt from the minute counters.
- Lengths of time are typed as a number and a unit (seconds, minutes, hours or days, as fits):
  time limits and their periods (“After 2 hours”, “every 3 days”, “in any 2 hours”), continuous
  use and its stop, waits, Ask first, breaks, focus sessions, the emergency exit and the time
  settings. A new rule’s **After some time** is no longer only “each day”: the time allowed can
  start again every so many minutes, hours or days. A limit as long as its period, which would
  never be reached, is pointed out.

### Changed

- Shorter, plainer texts on every page. Help lines that repeated their label are gone, the
  others say one thing in everyday words, and Help gets to the point (the six protections are now
  a list). The page WebHandbrake shows instead of a site is the block page everywhere, and the
  Settings tab **Interventions** is now **Blocking**.
- The ready-made lists are rewritten. They cover the platforms of more countries (all of Amazon's
  and eBay's stores, Mercado Livre in Brazil, Zalando, Vinted, Shopee and more), and each list
  holds only addresses that people open, written out country by country: no list now needs a site
  name with `*`, which made the page script run on every site and matched unrelated sites. They
  block the distraction and not the work around it: Amazon's stores leave Amazon Web Services,
  Seller Central and Kindle open, Meta's business tools, YouTube Studio and YouTube Music are
  exceptions, LinkedIn is blocked in its feed only, and Discord, a messaging app, is no longer in
  Forums. News adds outlets of more countries, Games adds browser and online games, and the
  alternative front ends of YouTube and X are included.
- Clearer texts throughout. The block page now says "This page is blocked" instead of "This space
  is protected", since Protection is what keeps a rule from being loosened. The kinds of
  intervention have one name each, the one of the "What should happen?" picker (**Ask first**,
  **Count only**, **Don't count**), and a change to a setting names it as Settings does. The popup's
  "Stop for today" is now **Stop now**: it gives up the time left for the limit's whole period,
  which may be an hour or a week. Quotation marks and apostrophes are typographic.
- The browser's extension and settings pages are now blocked by default while a firmly protected
  rule restricts sites or a focus session that cannot be interrupted is running, so that turning
  WebHandbrake off is no longer the easiest way around a rule you protected. Before, they were
  never blocked unless you chose it in Protection; a choice you made there is kept. The page shown
  instead says why and where to change it.
- A new rule from the wizard allows no breaks until you turn on **Allow breaks**, as in the full
  editor; and with the Partner code protection, breaks need your partner's code only if you tick
  the box (it was ticked from the start). What a protection says about breaks shows only while
  the rule allows them.
- Clearer texts: a rule says that its sites open normally when none of its conditions applies
  (instead of "time is only counted"); the popup and **Why?** say "Your break lasts until 10:23.
  After that: Block." instead of "The break or access ends", and the on-page timer of an access
  no longer calls it a break; the plan of an **Ask first** rule in the wizard mentions the wait on
  its page; **Later** says when a saved page opens again, or that the current rules never open it,
  instead of "not yet available" for every page.

### Removed

- Shared lists and the **Always allowed** list, with their pages under Rules: a rule's sites and
  exceptions are now all in the rule. When you update, the sites of a shared list move into the
  rules that used it, and an Always allowed site becomes an exception of the rules whose sites it
  may open. Files exported by earlier versions are read the same way.
- The four bars next to the current site's status in the popup: the status already says in words
  how much the site is restricted.
- Notes on the sites and exceptions of a rule: the pencil edits only the address, and in **Edit as
  text** “entry  # …” is a comment. Notes saved by earlier versions are dropped. The reason a rule
  matters to you, shown on its block page, stays.

### Fixed

- The warnings on Today about something that happened (settings restored from a backup, unusual
  events such as a clock change) can be dismissed: they stayed for a week with no way to close
  them. A restore no longer also shows the unusual-events warning, and a restore to the defaults
  no longer names an empty backup date.
- A limit's period no longer shows "per day" twice (in the list and again below it) in the rule
  editor and in Settings › Interventions; and the wizard's step names are no longer cut, such as
  "What ha…" at 1280 pixels.
- Breaks say what they cover: Today, the popup and Insights showed only "Break: 4 min left on the
  site" or "Tue 9:45 · 5 min", without the site or the rule. They now name the site or page and
  the rules of each break ("youtube.com · Social"), or "All rules".
- Today, in **Breaks in progress**, the **End the break** button stuck out of its card even at
  1280 pixels, and on a phone-sized screen the page scrolled sideways. The text of a break now
  wraps and the button stays in the card.
- During a break, the popup offered **Take a break** again, which started a second break and used
  up another break of the limit. It now offers **Extend the break**: the running break lasts
  longer, at the same cost, up to the longest a break can last, and no other break is counted.
- The pencil next to a site or an exception of a rule opened an empty box without a label, for a
  note only: correcting a mistyped address meant removing it and adding it again. It now edits the
  address, with a label. A corrected address follows the rule's protection like removing the old
  one and adding the new one.
- A number typed quickly in a field could lose a digit (“120” became “10”).
- A new rule left without a name no longer takes the name of its first site, which made texts such
  as “Remove tiktok.com from tiktok.com” and the popup’s “Add to: tiktok.com”. As in the rule
  editor, a rule needs a name: a ready-made list still gives one, otherwise the wizard asks for it
  on its last step.
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
- An import that replaces everything keeps only the saved pages that are web pages, so that an
  edited file can no longer break the Later list.
- Texts that said something wrong: the rule wizard asked for a redirect address starting with
  https:// (http:// works too); the Reminder protection said that any change asks for a
  confirmation (only loosening does); the import preview and some warnings said "1 conditions" or
  "1 entries are"; a notification about several pending changes said "it expires"; the privacy
  policy said that Reset follows the protection of your rules (it follows the emergency exit).
- Today showed the state of a rule from its first site only. During a break or an access on that
  site, a rule that still blocked or asked on its other sites read "On a break" or "Does not apply
  now", the page said that nothing was restricted, and Coming up missed the end of the block.
- The reason typed for a break could be lost, and was then missing from Insights: it was kept in
  memory only, and the browser may stop the extension's background while you wait, type the
  characters or ask your partner for the code.
- "Times you chose not to go in" counted the block pages that you went past with a break, as if
  you had left them.
- Sites pasted with commas or semicolons between them (“a.com, *news*, b.com/feed”) kept the
  comma: a site name was refused, but a wildcard or a section was added with it and then matched
  nothing, so those pages stayed open. Commas and semicolons now separate entries like spaces.
- Blocking the browser's extension and settings pages also blocked all of Chrome's settings, such
  as saved passwords, clearing browsing data and the search engine, although only resetting them
  can turn WebHandbrake off. In Chrome and similar browsers it now blocks the extension pages, the
  flags and the reset of the settings, as Firefox blocks only the Add-ons manager and its
  troubleshooting pages. The wizard and the rule editor say, when you choose a firm protection,
  that these pages are blocked while the rule restricts sites; the page shown instead names the
  rules or the focus session that block them and says until when, with a link to Protection; and
  where these pages are needed while they are blocked (allowing WebHandbrake in private windows,
  **Change shortcuts** in Help) the dashboard says so instead of opening a blocked page.
- **Block site** in the popup, and the keyboard shortcut, added the site to the first rule in the
  list (or the last one used) even when that rule applied only at certain times or after a limit,
  so the site stayed open: “Allowed until tomorrow 9:00”. They now add it to a rule that blocks
  it right away and at all times, or else to a new rule that does, and the popup says what the
  rule you pick will do (“blocks it from 18:00: until then it stays open”, “blocked right away,
  until 17:00”). Its choices say what each one covers: the whole site with its subdomains, this
  host without them, a section with the pages under it, or only this page, which showed the
  same address twice before. A rule created there is
  called “Blocked sites” unless you name it, never after the site, and allows no breaks until you
  turn them on, as a rule from the wizard.
- At the end of the first setup, **Try it** opened the example site even when the new rule did
  not apply at that moment (outside its times, or within its limit), so the site opened normally
  and the rule looked broken. The step now says when the rule steps in instead (“opens normally:
  WebHandbrake steps in from Mon 9:00”) and offers **Try it** only when the site is restricted
  right away.
- A time limit on several sites did not say that they share it: “30 min a day on youtube.com,
  reddit.com and 2 more sites” is 30 minutes in total, and **Count each site separately** was
  only in advanced mode. The wizard says that the sites share the time allowed, with the option to
  give each site its own, the plan says “in total” or “on each of”, and the rule editor shows the
  option without advanced mode.
- On a phone-sized screen, the list of rules in Protection lost their names: only their icons, their
  protections and **Change** were left, and one **Change** stuck out of the list. The protection
  now goes under the name when both do not fit.
- "Times you chose not to go in" counted every intervention page that you did not go past,
  including those that left no choice: a block without breaks, and a page that a change of your
  rules put in place of one you had open, such as the tab of a site you had just blocked (“You
  chose not to go in once” before you had tried anything). It now counts only the pages that
  offered a way in (a question, a wait, a challenge or a break), from this version on; a page that
  stops you when a limit is used up still counts when you leave it.
- **Recent decisions** in Settings › Diagnostics kept, by default, the full address of every page
  that WebHandbrake restricted, private windows included, for anyone at the computer to read
  until the browser closed. It is now off until you turn on **Keep a log**, which says what it
  keeps; a choice already made is kept.

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
