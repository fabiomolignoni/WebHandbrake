# Privacy policy

WebHandbrake is built to work entirely on your device (requirements VIN-02, VIN-03, PRIV-01…07).

## What WebHandbrake does not do

- It has **no account, no server and no telemetry or analytics**.
- It **makes no network requests of its own**. If you configure a redirect to an address of your
  choice, only your browser opens that address, as with any link.
- It loads **no remote code, fonts, scripts or images**.
- It never sells, shares or transmits data.

## What is stored, and where

Everything is kept in your browser profile (`storage.local`), never in the browser's sync
storage:

| Data | Content | Kept |
| --- | --- | --- |
| Groups and settings | Your sites, rules, protection settings; a password only as a salted PBKDF2 hash | Until you change them |
| Automatic backups | Previous versions of your groups and settings | Last 20 changes and 30 daily copies |
| Daily statistics | Seconds and visits per day, per group and per site (host name only, never full addresses) | 730 days by default (configurable) |
| Minute counters | Recent activity per group, for hourly and rolling limits | 48 hours |
| Breaks, intentions, pages saved for later | What you typed and the pages you saved | Until you delete them |
| Diagnostics log | Recent decisions, in session memory only | Until the browser closes |

For **private windows** no per-site statistics are kept; only the group totals needed for your
limits are counted.

## Permissions and why they are needed

| Permission | Why |
| --- | --- |
| Access to all sites, `declarativeNetRequest` | Stop the sites of your groups before they load and show the WebHandbrake page instead |
| `tabs`, `webNavigation` | Apply changes to open tabs, check single-page navigations and browser pages |
| `scripting` | Show the timer, filters and grace period on the sites of your groups only |
| `webRequest` (observe only) | Read the `Date` header of pages you already load to detect a manipulated system clock (optional, nothing stored) |
| `storage`, `unlimitedStorage` | Keep your settings, backups and statistics locally |
| `alarms`, `idle` | Apply time windows on time and stop counting when you are away |
| `contextMenus` | "Block this site" in the right-click menu (desktop) |
| `notifications` (optional) | Only if you turn notifications on |

Page content is read only to show the timer, filters and grace period, in memory, and is never
stored or sent anywhere.

## Your control

You can export all your data (Settings › Data), delete statistics for a period, a site or all at
once (Insights or Settings › Privacy) and reset everything. Uninstalling the extension removes all
its data.

Deleting statistics removes site details, counters, break reasons and intentions. The per-group
totals that your limits are computed from (and the dates of breaks taken) are kept for up to 90
days, so that deleting statistics never refills a limit.
