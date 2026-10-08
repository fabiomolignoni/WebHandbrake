# Privacy policy

Last updated: 2026-10-08

This policy applies to the WebHandbrake browser extension for Chrome, Firefox and Firefox for
Android.

## In short

- WebHandbrake has no account, no server, no telemetry and no analytics.
- It makes no network requests of its own.
- Everything it stores stays in your browser profile on this device.
- Nothing is sold, shared or transmitted, to anyone.
- You can export or delete your data, and uninstalling WebHandbrake removes everything it stored.

## Who is responsible

WebHandbrake is maintained by the owner of the GitHub repository
[fabiomolignoni/WebHandbrake](https://github.com/fabiomolignoni/WebHandbrake). The maintainer
receives no data from the extension, because the extension sends none.

Questions about this policy go to
[GitHub Discussions, category Q&A](https://github.com/fabiomolignoni/WebHandbrake/discussions/categories/q-a).
If you think WebHandbrake exposes your data, report it privately as a vulnerability, as described
in the [security policy](SECURITY.md).

## What WebHandbrake reads

WebHandbrake reads the following in memory, on this device. It stores only what the next section
lists.

- **The address of every page you open**, to decide whether one of your rules applies to it. This
  needs access to all sites.
- **The `Date` header of the pages the browser loads anyway** (top-level pages only), to notice a
  system clock that is wrong. It makes no extra requests. This is on by default and is turned off
  with **Settings › Time › Detect a manipulated system clock**. Only a detected difference is
  stored, and it is listed under **Protection › Events**.
- **Inside the pages where its page script runs**: whether the page is visible and its window has
  the focus, when you last used the keyboard, mouse or touch screen, whether audio or video is
  playing, and the page's address. This is used to count active time and to show the timer,
  reminders, filters and the grace period.
- **The text of the field you are typing in**, inside the page only. It is used to know whether
  you are typing when a restriction starts, so that you get the grace period, and for the **Copy my draft** button
  of the grace period. It is never sent to the rest of WebHandbrake and never stored.
- **Whether the device is idle or locked**, to stop counting time.

The page script runs on the sites of your active rules. It runs on every site when **Track time on
all sites** is on, when an active rule has a regular expression, or when an active rule has an
address with `*` in the site name other than a leading `*.`, such as `amazon.*`. Several ready-made
lists contain such addresses, so adding one of them makes the page script run on every site.

## What is stored

Everything is stored in the browser's extension storage on this device (`storage.local`), never in
the browser's sync storage. The names in the first column are the ones that **Settings › Privacy ›
What is stored** shows, with their sizes.

| Item | What it contains | Kept for | How to delete it | In exports and backups |
|---|---|---|---|---|
| Rules and settings | Your rules, shared lists, **Always allowed** and settings. The settings password is kept only as a salted hash. After an update that changes the data format, a copy of the previous version is also kept until the next save. | Until you change them | **Settings › Data › Reset rules and settings…**, which follows your protection level | Exports: yes, the password hash only if you tick **Include the password hash**. Backups: yes, including the password hash. |
| Automatic backups | Copies of your rules and settings, including the password hash: one before each of the last <!-- fact: limits.RECENT_SNAPSHOTS -->20<!-- /fact --> changes and one a day for <!-- fact: limits.DAILY_SNAPSHOTS -->30<!-- /fact --> days. | Until newer copies replace them | Only by uninstalling WebHandbrake. **Reset** and the emergency exit do not remove them. | Not exported |
| Breaks, sessions, pending changes and protection events | Breaks and accesses in progress (for a single page, with its address), the last <!-- fact: limits.MAX_BREAK_RECORDS -->1000<!-- /fact --> breaks taken with their reasons, focus sessions, pending changes, cool-downs, an emergency exit you requested, the detected clock difference, and the last <!-- fact: limits.MAX_PROTECTION_EVENTS -->200<!-- /fact --> protection events: clock changes, settings restored from a backup, removed access to all sites or to private windows, browser blocking filters that did not match your settings, times WebHandbrake was not running, and the steps of the emergency exit. | Until they end or newer records replace them | Deleting all statistics removes the reasons of breaks | Not in exports or backups. Insights' JSON export includes the breaks. |
| Visit tracking | For each rule and each site of a rule that you are visiting: when the visit started, how long it lasted and when you were last active. | Until the visit ends | Ends by itself | Not exported |
| Daily statistics | For each day: the time and visits per rule, per site of a rule and per site (the site name, never a full address), and counters of intervention pages shown, of times you continued or left, of breaks and of focus sessions. Sites outside your rules appear only with **Track time on all sites**. | <!-- fact: defaults.settings.tracking.retentionDays -->730<!-- /fact --> days by default, changed in **Settings › Time › Keep daily statistics for** | **Insights › Data › Delete data**, or **Settings › Privacy › Delete all statistics** | Exports: only if you tick **Include statistics**. **Insights › Data** also exports them as CSV or JSON. Not in backups. |
| Recent minute counters | Time and visits per minute, per rule and per site of a rule, for hourly and rolling limits. | <!-- fact: limits.MINUTE_RETENTION_MINUTES|hours -->48<!-- /fact --> hours, removed by a daily clean-up, so up to about one day longer | Ends by itself | Not exported |
| Pages saved for later | The full address and title of each page you save, also from private windows, with its rule and the time you saved it. The newest <!-- fact: limits.MAX_LATER_ITEMS -->1000<!-- /fact --> are kept. | Until you remove them | **Later › Remove** | Exports: yes. Not in backups. |
| Intentions | What you type when WebHandbrake asks what you want to do, with the rule, the time and the minutes you chose. The newest <!-- fact: limits.MAX_INTENTIONS -->500<!-- /fact --> are kept. | Until you delete them | Deleting all statistics | Not in the export of **Settings › Data**. Insights' JSON export includes them. |
| Technical information | The installation time, the version, when the daily maintenance last ran, the self-test result, when the settings were last restored from a backup, the rule that **Block this site** last added a site to, and whether WebHandbrake was allowed in private windows. | Until you uninstall WebHandbrake | Only by uninstalling | Not exported |

Some data is kept only in the browser's memory (`storage.session`) and disappears when the browser
closes. **Settings › Privacy** does not list it.

- **Recent decisions**: the last <!-- fact: limits.DECISION_LOG_SIZE -->200<!-- /fact --> pages
  that WebHandbrake restricted, with their full address, what happened, the rule and the time,
  private windows included. It is on by default. **Settings › Diagnostics › Keep a log** turns it
  off, and **Clear the log** empties it.
- **Costs in progress**: a wait, challenge or confirmation that you have started. Each expires
  after <!-- fact: limits.TICKET_TTL_MS|minutes -->60<!-- /fact --> minutes.
- Which reminders and intentions have already been shown, and a marker that WebHandbrake is
  running.

Deleting statistics never refills a limit. The totals that your limits use (per rule and per site
of a rule), the number of times you continued past an intervention, and the dates of breaks
without their reasons are kept for <!-- fact: limits.BUDGET_KEEP_DAYS -->92<!-- /fact --> days.

## Private windows

WebHandbrake runs in private windows only if you allow it in the browser. When it runs there:

- no statistics per site are kept, but the totals that your limits need are counted, per rule and
  per site of a rule. For an address with `*` in the site name or a regular expression, that site
  is the site you visit;
- pages you save for later keep their address and title;
- **Recent decisions** includes private windows until the browser closes.

In Chrome, one background process serves normal and private windows.

## Files you create

These files are not encrypted, and what happens to them is up to you.

- **Exports** (**Settings › Data › Export**): your rules, shared lists, **Always allowed**,
  settings and pages saved for later. Statistics and the password hash are included only if you
  tick them.
- **Statistics exports** (**Insights › Data**): daily statistics as CSV, or as JSON together with
  the breaks and their reasons and your intentions.
- **Shared rules** (**Share** in a rule's menu): one rule with its shared lists.
- **Diagnostic reports** (**Settings › Diagnostics › Copy diagnostic report**): the version, the
  browser and its user-agent string, the numbers of rules, sites and lists, the protection level,
  whether a password is set, the state of the browser blocking filters and of the permissions, the
  protection events and the recent decisions. Addresses are removed unless you tick **Include
  addresses (off by default)**.

Importing a file never imports statistics. Pages saved for later are imported only when an import
replaces everything.

## What leaves your device

Nothing. WebHandbrake makes no network requests of its own: no server, no update check, no
fonts, scripts or images from the web. An end-to-end test checks this in Chromium and Firefox.

The browser opens two kinds of addresses because you chose them, as with any link:

- a redirect address that you set in a rule;
- the links you click in **Help › About** and **Settings › Diagnostics**, which lead to GitHub.

The self-test in **Settings › Diagnostics** opens a test address that a browser blocking filter
stops before it reaches the network.

## Detectability

In Chrome, a website can find out that WebHandbrake is installed: the intervention page must be
reachable from every site so that restricted pages can be redirected to it, and its address is the
same on every installation. Firefox gives each installation a random address, so a website cannot
probe it. The reasons are in [ADR 0009](docs/adr/0009-permissions.md).

## Permissions

These are the permissions that WebHandbrake asks for, what it uses each one for and what it never
does with it. [ADR 0009](docs/adr/0009-permissions.md) explains the choices and the alternatives
that were considered.

| Permission | What WebHandbrake uses it for | What it never does |
|---|---|---|
| `storage` | Keeping your rules, settings and statistics on this device, and short-lived state in memory. | Using the browser's sync storage. |
| `unlimitedStorage` | Keeping statistics for the period you choose, and the automatic backups, without running into the browser's storage quota. | Storing anything that this policy does not list. |
| `declarativeNetRequest` | Installing browser blocking filters that stop or redirect a restricted page before it loads. | Reading the content of pages. |
| `tabs` | Reading the address of open tabs, including the browser's own pages that host access does not cover, so that rules apply to tabs that are already open and the browser's extension and settings pages can be protected. | Reading the content of tabs. |
| `webNavigation` | Noticing page changes that the filters cannot see: single-page sites, the back and forward buttons, changes of the part of the address after `#`, and blocked requests when access to sites is missing. | Keeping a history of navigations. |
| `webRequest` | Reading the `Date` header of top-level pages that the browser loads anyway, for the clock check. | Blocking, changing or storing a request. |
| `alarms` | Waking WebHandbrake when a schedule, limit, break or session changes, and once a minute for maintenance. | — |
| `idle` | Stopping time counting when you are inactive or the screen is locked. | — |
| `scripting` | Adding the page script that shows the timer, reminders, filters and the grace period and counts active time, on the sites described in [What WebHandbrake reads](#what-webhandbrake-reads). | Reading the text you type outside the page, or storing page content. |
| `contextMenus` | The right-click menu that blocks a site or starts a focus session (on a computer). | — |
| `notifications` (optional) | Showing the system notifications you turn on; the browser asks for it when you turn them on in **Settings › Feedback**. | Showing notifications you did not turn on. |
| `<all_urls>` (access to all sites) | Checking the address of each page against your rules, redirecting a restricted page before it loads, running the page script and reading the `Date` header. Without it, restricted pages can only be blocked with the browser's error page. | Sending anything anywhere. |
| `web_accessible_resources` | Letting the browser show the intervention page (`intervention.html` and the script, style sheet and icons it loads) in place of a restricted page. | — |
| `incognito` (Chrome only) | Set to "spanning": one background process serves normal and private windows. | Running in private windows without your permission. |

## Store declarations

- **Firefox Add-ons**: the extension's manifest declares its data collection as
  <!-- fact: manifest.dataCollection|code -->`none`<!-- /fact -->, because WebHandbrake collects and
  transmits nothing.
- **Chrome Web Store**: the use of information complies with the
  [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies),
  including the Limited Use requirements. Data is handled only on this device, and is never sold
  or transferred.

## Your choices

- **Export** your data in **Settings › Data**.
- **Delete statistics** for a period, a site or everything in **Insights › Data › Delete data**,
  or all at once in **Settings › Privacy › Delete all statistics**.
- **Reset rules and settings** in **Settings › Data**. This follows your protection level like any
  loosening, and it keeps your statistics and pages saved for later.
- **Turn off** the decision log (**Settings › Diagnostics › Keep a log**) and the clock check
  (**Settings › Time › Detect a manipulated system clock**).
- **Uninstall** WebHandbrake, which removes everything it stored, the automatic backups included.
  Export first if you want to keep your rules.

## Children

WebHandbrake collects no data from anyone, children included. The addresses in the sensitive
ready-made lists
(<!-- fact: templates.sensitive -->Gambling, Adult<!-- /fact -->) are hidden unless you choose to
see them.

## Changes to this policy

Every change to what WebHandbrake reads, stores or sends, or to its permissions, updates
this policy, its "Last updated" date and the list below. The full history is in the
[history of this file](https://github.com/fabiomolignoni/WebHandbrake/commits/main/PRIVACY.md).

- 2026-10-08: First published version.
