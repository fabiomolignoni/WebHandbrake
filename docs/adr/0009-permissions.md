# ADR 0009 — Permissions and host access

- Status: accepted
- Date: 2026-10-04
- Recorded: 2026-10-08
- Requirements: PRIV-03, PERF-03, ENF-12, PRO-08, PRO-09, SCH-07, NOT-04, SEC-08

## Context and problem statement

WebHandbrake stops pages before they load, counts time on the sites of rules, protects the browser
pages that could switch it off and detects a manipulated clock, in Chrome and Firefox.
`scripts/manifest.mjs` declares the same permissions for both browsers. Each permission widens what
the extension can see, adds to the install warning and lengthens store review: the Chrome Web Store
reviews broad host permissions such as `<all_urls>` more thoroughly. PRIV-03 asks for the minimum.

This record was written after the permissions were chosen. The options below are the alternatives
a reviewer asks about; they are not a record of the original deliberation.
[PRIVACY.md](../../PRIVACY.md#permissions) tells users what each permission is used for.

Which permissions does WebHandbrake need, and how broad must they be?

## Considered options

**Access to sites.**

1. `activeTab`: access to the current tab after the person invokes the extension. No install
   warning, but no access before a navigation or to other tabs, so nothing can be stopped before
   it loads and time cannot be counted.
2. Optional host permissions, asked per site when a rule is created. Access is limited to the
   sites of rules, but a regular expression or a `name.*` entry cannot be written as a host
   pattern, **Track time on all sites** needs every site, and every new site needs the person's
   consent again.
3. `<all_urls>` as a required host permission. Redirects, content scripts and time counting work
   for every entry, at the cost of the broadest install warning.

**Network filtering.** `declarativeNetRequestWithHostAccess` adds no install warning, but then
every rule, blocking included, needs host access. `declarativeNetRequest` lets block rules work
without host access, which keeps a network block when access is withdrawn (ENF-12).

**Addresses of browser pages.** Host access reveals the address of web pages only, not of
`chrome://extensions` or `about:addons`. Without `tabs`, those pages could not be protected
(PRO-08). Closing or redirecting a tab needs no permission; `tabs` is for reading the address of
every tab.

**Content scripts.** Static `content_scripts` for `<all_urls>` would run in every page. `scripting`
registers the script at run time for the sites that need it (PERF-03).

**Clock check.** Without `webRequest` a clock set forward goes unnoticed (SCH-07). An optional
`webRequest`, asked when the person turns on **Detect a manipulated system clock**, would shrink
the permission set, but the check could no longer be on by default. A required, observe-only
`webRequest` reads the `Date` header of responses the browser receives anyway.

**The intervention page.** A DNR redirect (the "browser blocking filters" of the
[glossary](../glossary.md)) can load the page only if `web_accessible_resources` lists it. In
Chrome, `use_dynamic_url` would give the page an address that changes per session, so sites could
not probe it; whether DNR redirects work with that address has not been tested.

**Private windows (Chrome).** `incognito: split` would run a second background for incognito
windows, while the design has one background that owns the state, the rules and the timers;
Firefox does not support split mode. `spanning` shares one background.

## Decision outcome

Chosen: `<all_urls>` as a required host permission, `declarativeNetRequest`, `tabs`, `scripting`,
a required observe-only `webRequest`, a static web-accessible intervention page, and
`incognito: spanning` in Chrome. `use_dynamic_url` and an optional `webRequest` are
[roadmap candidates](../roadmap.md#candidates).

| Permission | What it is used for |
|---|---|
| `<all_urls>` (host) | Redirects to the intervention page, content scripts, time counting. Without it the extension blocks with network filters, shows a warning and records an event (ENF-12). |
| `declarativeNetRequest` | Stopping navigations before the request is sent ([ADR 0001](0001-manifest-v3-dnr-first.md)). |
| `webNavigation` | The second layer of ADR 0001: committed navigations, route changes in single-page applications, address fragments, errors of blocked requests. |
| `tabs` | Reading the address of every tab, browser pages included, to apply rules to open tabs and protect the browser's extension and settings pages (PRO-08). |
| `scripting` | Registering the content script for the hosts of the rules, or for every site when **Track time on all sites** is on or an entry cannot be a match pattern; injecting it into tabs that were already open. |
| `webRequest` | Reading the `Date` header of top-level responses to detect a clock set forward (SCH-07). Nothing is blocked or changed. |
| `storage` | The configuration, state and statistics in `storage.local`; short-lived state in `storage.session`. |
| `unlimitedStorage` | Statistics kept for the period chosen in the settings, and the automatic backups, so that saving never fails on Chrome's quota for `storage.local`. |
| `alarms` | Waking the background for schedule boundaries, expiries and periodic work, since a stopped background loses its timers. |
| `idle` | Stopping time counting when the person is idle or the screen is locked. |
| `contextMenus` | The context-menu items; detected at run time, since Firefox for Android has no context menus. |
| `notifications` (optional) | System notifications, asked for only when the person turns on **System notifications** (NOT-04). |
| `web_accessible_resources` | `intervention.html` and the files it loads, for every site, so that redirects can load the page. The page refuses to render inside a frame (SEC-08). |
| `incognito: spanning` (Chrome) | One background for normal and private windows. The person still has to allow private windows (PRO-09). |

## Consequences

Good:

- Every feature works on every site without asking again.
- When access to the sites is withdrawn, blocking degrades to network blocks, and the person is
  told.
- The content script stays off sites that no rule covers, unless the person or an entry needs it.

Bad:

- The install warning says that the extension can read and change data on all sites, and store
  review takes longer.
- Any site can tell that WebHandbrake is installed in Chrome by loading its intervention page at
  the fixed extension address ([Sjösten et al. 2017](../principles.md#ref-sjosten2017)). Firefox
  gives each installation a random address.
- One regular expression, or one ready-made list with `name.*` entries, makes the content script
  run on every site.
- `webRequest` stays required even when the clock check is turned off.

## Confirmation

- The `permissions` check of `npm run docs:check` fails when a permission, host permission,
  web-accessible resource or incognito setting of either manifest has no row in
  [PRIVACY.md](../../PRIVACY.md#permissions).
- Not automated: a reviewer checks that a change to the permissions in `scripts/manifest.mjs` comes
  with an ADR that supersedes this one.
