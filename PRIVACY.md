# Privacy policy

Last updated: 2026-10-26

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
If you think WebHandbrake exposes your data, report it privately as a vulnerability through the
[private reporting form](https://github.com/fabiomolignoni/WebHandbrake/security/advisories/new).

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
  filters and the grace period.
- **The text of the field you are typing in**, inside the page only. It is used to know whether
  you are typing when a restriction starts, so that you get the grace period, and for the **Copy my draft** button
  of the grace period. It is never sent to the rest of WebHandbrake and never stored.
- **Whether the device is idle or locked**, to stop counting time.

The page script runs on the sites of your active rules. It runs on every site when **Track time on
all sites** is on, when an active rule has a regular expression, when an active rule has an
address with `*` in the site name other than a leading `*.`, such as `amazon.*`, or when it has an
address without a site name, such as `*news*` or `*` (every website). The ready-made lists contain
no such address.

## What is stored

Everything is stored in the browser's extension storage on this device (`storage.local`), never in
the browser's sync storage. The names in the first column are the ones that **Settings › Privacy ›
What is stored** shows, with their sizes.

| Item | What it contains | Kept for | How to delete it | In exports and backups |
|---|---|---|---|---|
| Rules and settings | Your rules and settings. The passwords of rules are kept only as salted hashes; the secret of a rule's partner code is kept as it is, because codes are checked on this device. After an update that changes the data format, a copy of the previous version is also kept until the next save. | Until you change them | **Settings › Data › Reset rules and settings…**, which waits as long as the emergency exit when it loosens an active rule | Exports: yes, the password hashes and the partner codes only if you tick **Include the passwords and the partner codes of the rules**. Backups: yes, including them. |
| Automatic backups | Copies of your rules and settings, including the password hashes and the partner codes: one before each of the last 20 changes and one a day for 30 days. | Until newer copies replace them | Only by uninstalling WebHandbrake. **Reset** and the emergency exit do not remove them. | Not exported |
| Breaks, sessions, pending changes and protection events | Breaks and accesses in progress (an access to a single page with its address), the last 1000 breaks taken (with the reasons that earlier versions asked for), focus sessions, pending changes, the limits you used up early with **Stop now**, an emergency exit you requested, the detected clock difference, and the last 200 protection events: clock changes, settings restored from a backup, removed access to all sites or to private windows, browser blocking filters that did not match your settings, times WebHandbrake was not running, and the steps of the emergency exit. | Until they end or newer records replace them | Deleting all statistics removes the reasons of breaks | Not in exports or backups. Insights' JSON export includes the breaks. |
| Visit tracking | For each rule and each site of a rule that you are visiting: when you were last active. | Until the visit ends | Ends by itself | Not exported |
| Daily statistics | For each day: the time and visits per rule, per site of a rule and per site (the site name, never a full address), the time and visits in private windows (one total, without the sites), the time on limited sites per hour, and counters of intervention pages shown, of times you continued or left, of breaks and of focus sessions. Sites outside your rules appear only with **Track time on all sites**, which also keeps one total of the time outside your rules. Deleting one site keeps its time among the other sites, without its name. | 730 days by default, changed in **Settings › Time › Keep daily statistics for** | **Insights › Data › Delete data**, or **Settings › Privacy › Delete all statistics** | Exports: only if you tick **Include statistics**. **Insights › Data** also exports them as CSV or JSON. Not in backups. |
| Minute-by-minute time | Time and visits per minute, per rule and per site of a rule, for limits that start again every so many minutes or hours. | 48 hours, removed by a daily clean-up, so up to about one day longer | Ends by itself | Not exported |
| Pages saved for later | The full address and title of each page you save, also from private windows, with its rule and the time you saved it. The newest 1000 are kept. | Until you remove them | **Later › Remove** | Exports: yes. Not in backups. |
| Sites for focus sessions | The addresses you list on **Focus** for **A few sites** and **Everything except a few sites**, and the choice you last made under **What to block**. | Until you change them | **Focus › Clear the list** | Exports: yes. Not in backups. |
| Reasons for going in | The reason you type when WebHandbrake asks what you want to do, with the rule, the time and the minutes you chose. The newest 500 are kept. | Until you delete them | Deleting all statistics | Not in the export of **Settings › Data**. Insights' JSON export includes them. |
| Technical information | The installation time, the version, when the daily maintenance last ran, the self-test result, when the settings were last restored from a backup, the rule that **Block this site** last added a site to, and whether WebHandbrake was allowed in private windows. | Until you uninstall WebHandbrake | Only by uninstalling | Not exported |

Some data is kept only in the browser's memory (`storage.session`) and disappears when the browser
closes. **Settings › Privacy** does not list it.

- **Recent decisions**: the last 200 pages
  that WebHandbrake restricted, with their full address, what happened, the rule and the time,
  private windows included, only if you turn on **Settings › Diagnostics › Keep a log** (it is off
  by default). **Clear the log** empties it.
- **Costs in progress**: a wait, challenge or confirmation that you have started. Each expires
  after 60 minutes.
- Which reasons for going in have already been recalled on the page, and a marker that WebHandbrake is
  running.
- In Chrome, with private windows open: the last message passed each way between their background
  and the main one (it can hold the address of a private tab), the numbers of the private tabs and
  the items of the right-click menu (see [Private windows](#private-windows)).

Deleting statistics never refills a limit. The totals that your limits use (per rule and per site
of a rule), the number of times you continued past an intervention, and the dates of breaks
without their reasons are kept for 92 days.

## Private windows

WebHandbrake runs in private windows only if you allow it in the browser. When it runs there:

- no statistics per site are kept, but the totals that your limits need are counted, per rule and
  per site of a rule. For an address with `*` in the site name or a regular expression, that site
  is the site you visit. Insights also counts your time and visits there, as one total without
  the sites (on limited sites, or on every site with **Track time on all sites**). The sites you
  visit are held in memory only, at most until the browser closes, to count the visits;
- pages you save for later keep their address and title;
- **Recent decisions** includes private windows until the browser closes.

In Chrome, private windows have a background process of their own, so that the intervention page
can open there. It keeps nothing: it passes the addresses of their tabs and the messages of
WebHandbrake's pages there to the main process through the browser's memory (`storage.session`),
where each message is replaced by the next one and all are gone when the browser closes. The main
process keeps the data, as for normal windows.

## Files you create

These files are not encrypted, and what happens to them is up to you.

- **Exports** (**Settings › Data › Export**): your rules, settings, pages saved for later and sites
  for focus sessions. Statistics and the secrets (the password hashes and the partner codes of the rules) are
  included only if you tick them.
- **Statistics exports** (**Insights › Data**): daily statistics as CSV, or as JSON together with
  the breaks (with any reasons given in earlier versions) and the reasons you gave for going in.
- **Shared rules** (**Share** in a rule's menu): one rule, never its password or its partner
  code.
- **Diagnostic reports** (**Settings › Diagnostics › Copy diagnostic report**): the version, the
  browser and its user-agent string, the numbers of rules and sites, the kind of protection
  of each rule (without its password hash or partner secret), the state of the browser blocking
  filters and of the permissions, the
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
probe it.

## Permissions

These are the permissions that WebHandbrake asks for, what it uses each one for and what it never
does with it.

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
| `scripting` | Adding the page script that shows the timer, filters and the grace period and counts active time, on the sites described in [What WebHandbrake reads](#what-webhandbrake-reads). | Reading the text you type outside the page, or storing page content. |
| `contextMenus` | The right-click menu that blocks a site or starts a focus session (on a computer). | — |
| `notifications` (optional) | Showing the system notifications you turn on; the browser asks for it when you turn them on in **Settings › Feedback**. | Showing notifications you did not turn on. |
| `<all_urls>` (access to all sites) | Checking the address of each page against your rules, redirecting a restricted page before it loads, running the page script and reading the `Date` header. Without it, restricted pages can only be blocked with the browser's error page. | Sending anything anywhere. |
| `web_accessible_resources` | Letting the browser show the intervention page (`intervention.html` and the script, style sheet and icons it loads) in place of a restricted page. | — |
| `incognito` (Chrome only) | Set to "split": private windows have a background process of their own, which Chrome needs to show the intervention page there. It keeps nothing and passes everything to the main one. | Running in private windows without your permission. |

## Store declarations

- **Firefox Add-ons**: the extension's manifest declares its data collection as
  `none`, because WebHandbrake collects and
  transmits nothing.
- **Chrome Web Store**: the use of information complies with the
  [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies),
  including the Limited Use requirements. Data is handled only on this device, and is never sold
  or transferred.

## Your choices

- **Export** your data in **Settings › Data**.
- **Delete statistics** for a period, a site or everything in **Insights › Data › Delete data**,
  or all at once in **Settings › Privacy › Delete all statistics**.
- **Reset rules and settings** in **Settings › Data**. When it loosens an active rule, it waits as
  long as the emergency exit, then you confirm it by typing a sentence; it keeps your statistics
  and pages saved for later.
- **Turn off** the decision log (**Settings › Diagnostics › Keep a log**) and the clock check
  (**Settings › Time › Detect a manipulated system clock**).
- **Uninstall** WebHandbrake, which removes everything it stored, the automatic backups included.
  Export first if you want to keep your rules.

## Children

WebHandbrake collects no data from anyone, children included.

## Changes to this policy

Every change to what WebHandbrake reads, stores or sends, or to its permissions, updates
this policy, its "Last updated" date and the list below. The full history is in the
[history of this file](https://github.com/fabiomolignoni/WebHandbrake/commits/main/PRIVACY.md).

- 2026-10-26: Daily statistics keep the visits in private windows too, and their time on every
  site with **Track time on all sites**, still as one total without the sites; that setting also
  keeps one total of the time outside your rules. Deleting one site keeps its time without its
  name. In Chrome, private windows have a background process of their own, which passes what
  happens there to the main one through the browser's memory.
- 2026-10-25: The log of recent decisions is off until you turn it on. Daily statistics also keep
  the time on limited sites per hour, and in private windows as one total without the sites. The
  sites you list for focus sessions are stored and exported. Breaks no longer ask for a reason,
  visit tracking keeps only when you were last active, and the cool-downs of limits on continuous
  use are gone with those limits.
- 2026-10-19: Shared lists and the Always allowed list are no longer stored or exported: their
  sites are now part of the rules. Reset is described as it works: a reset that loosens an active
  rule waits as long as the emergency exit.
- 2026-10-08: First published version.
