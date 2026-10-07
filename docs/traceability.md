# Release R1 (v1.0) — requirement status

Status of every requirement in the R1 scope of [`requisiti.md`](requisiti.md) §9.1.
**✅ done · 🟡 partial (see notes) · ⏳ to be validated with users**. Tests: `U` unit
(`tests/unit`), `E` end-to-end scenarios run in both a real Chromium and a real Firefox
(`tests/e2e`, see [`testing.md`](testing.md)).

## Evaluation semantics

| ID | Status | Where / notes | Tests |
| --- | --- | --- | --- |
| SEM-01…SEM-04 | ✅ | `engine/decide.ts`: ordered severities, first matching policy, most severe group, exceptions per group | U, E |
| SEM-05 | ✅ | Global "Always allowed" prevails over groups and sessions | U, E |
| SEM-06 | ✅ | Specificity (host labels, literal segments, exact > prefix > pattern; ties → block) | U, E |
| SEM-07 | ✅ | `engine/next.ts`: "until" over all policies and groups | U, E |
| SEM-08 | ✅ | Visits: activity after a configurable gap (default 5 min) | U, E |
| SEM-09 | ✅ | Configurable day start for windows and daily limits | U, E |

## Targets (MAT)

| ID | Status | Notes | Tests |
| --- | --- | --- | --- |
| MAT-01…MAT-04 | ✅ | Domains with subdomains, host only, paths, exact pages, home page, exceptions | U, E |
| MAT-05 | ✅ | `*` / `**`; import of uBlock Origin, AdGuard, uBlacklist, hosts syntax | U, E |
| MAT-06 | ✅ | Regular expressions (advanced mode) with ReDoS checks; DNR when RE2-compatible | U, E |
| MAT-07 | ✅ | Query parameters; fragments matched only when written in the entry | U, E |
| MAT-08 | ✅ | `#` comments and per-entry notes | U |
| MAT-09 | ✅ | Local files and browser pages (checked at navigation; Chrome needs "Allow access to file URLs") | U |
| MAT-13 | ✅ | Optional blocking of embedded frames (`sub_frame`) | U, E |
| MAT-16 | ✅ | "Test a URL" in the editor, "Why?" in popup and intervention page | E |
| MAT-17 | ✅ | Popup, context menu, keyboard shortcut; granularity and group | E |
| MAT-18 | ✅ | Shared lists | E |
| MAT-19 | ✅ | Normal/private/both; such groups are checked when navigation starts (not by DNR) | U, E |
| MAT-22 | ✅ | Sort, de-duplicate, bulk paste, counts, text editing (advanced) | E |

## Schedules and limits

| ID | Status | Notes | Tests |
| --- | --- | --- | --- |
| SCH-01, SCH-03, SCH-04 | ✅ | Multiple windows per day, overnight windows, during/outside/always, ordered policies with natural-language summary | U, E |
| SCH-02 | ✅ | Presets, precise time fields, visual week grid (mouse and touch, 30-minute cells) | E |
| SCH-06 | ✅ | Local time with DST, week start, day start | U |
| SCH-07 | ✅ | Monotonic check (time never goes backwards) and HTTP `Date` header comparison | E |
| LIM-01…LIM-06 | ✅ | Time (hour/day/week/month, every N minutes or days with offset, rolling ≤ 24 h), per site, visits, continuous use + stop, duration chosen at the entry question + optional cool-down | U, E |
| LIM-09…LIM-11 | ✅ | Escalation through policies, remaining time in popup/badge/timer, "Stop for today" | U, E |

## Time measurement

| ID | Status | Notes | Tests |
| --- | --- | --- | --- |
| TIM-01…TIM-03 | ✅ | Visible + focused + active (idle 120 s), options for background media and inactive tabs; no double counting; gaps never counted | E |
| TIM-04 | ✅ | Page visibility (works on Android) | ⏳ device test |
| TIM-05 | ✅ | Counters flushed every 10 s | U, E |
| TIM-06, TIM-07 | ✅ | Error pages not counted, reader mode and view-source unwrapped; exceptions not counted | U, E |

## Interventions

| ID | Status | Notes | Tests |
| --- | --- | --- | --- |
| INT-01 | ✅ | Calm block page, note, group, until, "Why?", close/back first, save for later, break link with its cost | E |
| INT-02 | ✅ | Auto-continue, pause/restart on blur, hidden countdown, random and increasing delays, access for the visit or N minutes, site or group | E |
| INT-03 | ✅ | Intention question with suggestions and chosen duration; intention shown and logged | E |
| INT-04 | ✅ | Random text on canvas, phrase, calculation; paste and synthetic input refused | E |
| INT-05, INT-06 | ✅ | Filters with intensity, custom filter, mute; close tab; redirect | E |
| INT-07 | ✅ | Custom message per group, custom CSS (no remote resources), external URL with `{url}`/`{group}`/`{until}` | E |
| INT-09, INT-12, INT-14 | ✅ | Alternatives, "Later" list with notice and bulk reopen, single-page access | E |
| INT-13 | ✅ | Grace period with "Copy my draft" when typing | E |

## Enforcement

| ID | Status | Notes | Tests |
| --- | --- | --- | --- |
| ENF-01, ENF-08 | ✅ | DNR redirect before the request, persistent rules | E |
| ENF-02 | ✅ | All open tabs within ~1 s; per group: all / active / background tabs | E |
| ENF-03, ENF-10 | ✅ | History API navigation, back/forward cache | E |
| ENF-04, ENF-05 | ✅ | Original URL kept, "Reopen", auto-reopen option, bulk restore, survives session restore | E |
| ENF-07, ENF-09 | ✅ | Independent of page scripts; loop guard and redirect destinations excluded | E |
| ENF-11 | ✅ | Full screen left before replacing a page (when the content script is present) | — |
| ENF-12 | ✅ | Without host access: network block + intervention page after the error | E |

## Breaks, focus, protection

| ID | Status | Notes | Tests |
| --- | --- | --- | --- |
| BRK-01…BRK-10 | ✅ | Per group policy, scopes, durations, budgets per group and global, costs, reasons, expiry with immediate re-application, metered breaks, early end, badge/timer | E |
| FOC-01…FOC-05, FOC-07, FOC-09 | ✅ | Two-tap session, allowlist mode, cannot be interrupted (preview + consent), delayed start, extend instantly, end notification, no breaks option | E |
| PRO-01…PRO-04 | ✅ | Levels, automatic classification, cooling-off with confirmation and expiry, locked while active | U, E |
| PRO-05 | ✅ | Password (PBKDF2), random code, locked times; verified in the background | E |
| PRO-08, PRO-09 | ✅ | Browser extension/settings pages protected (best effort, not on Android); private window check and guidance | E |
| PRO-12…PRO-15 | ✅ | Protected import/reset, tamper log, background-enforced costs, emergency exit | U, E |
| PRO-16 | 🟡 | Per-group level and lock date; the password is global (per-group password not in v1) | — |
| PRO-18, PRO-19 | ✅ | Checklist; no uninstall URL, no dark patterns | — |

## Statistics, feedback, data, other

| ID | Status | Notes | Tests |
| --- | --- | --- | --- |
| STA-01…STA-04, STA-06, STA-07, MOT-01 | ✅ | Daily aggregates only, insights with comparison, attempts/impulses/breaks/sessions, neutral wording, CSV/JSON, deletion | E |
| NOT-01…NOT-04, NOT-06 | ✅ | Movable accessible timer, badge, warnings in page and as notifications, optional notifications, reduced motion, optional sound | E |
| LST-01, LST-03 | ✅ | 8 templates (data file), group sharing | E |
| DAT-01…DAT-04, DAT-06, DAT-07 | ✅ | Versioned JSON export, import of lists of sites with a report, backups with integrity check and restore, timestamped files, protected reset, migrations keeping unknown fields | U, E |
| DAT-02 | ✅ | Plain lists, hosts files, uBlock Origin / AdGuard and uBlacklist syntax, with a report of skipped lines | E |
| DAT-05 | ✅ | Download + file picker + "Copy as text" fallback | E (desktop), ⏳ device test |
| API-01, API-02 | ✅ | Shortcuts and context menu (desktop only, feature-detected) | E |
| ONB-01…ONB-05, ONB-07 | ✅ | 2-minute wizard, permission checks per browser, contextual help, validation, simple/advanced mode, just-in-time explanations | E |
| ONB-06 | 🟡 | Offline help included; "always allow the documentation site" not applicable until a site exists | — |
| DIA-01…DIA-03 | ✅ | Rule counts vs limits, permissions, decision log, counters, redacted report, self-test | E |
| SET-01…SET-05 | ✅ | Themes incl. high contrast and accent, language, formats, groups management, toggles | E |

## Non-functional requirements (Must)

| Area | Status | Notes |
| --- | --- | --- |
| PRIV-01…07 | ✅ | No network requests (checked end to end: the test server sees no request of the extension's own), `storage.local` only, optional permissions on demand, privacy page with sizes and deletion |
| SEC-01…05 | ✅ | PBKDF2-SHA256 600k, strict CSP, regex safety, import validation and size limit, sender checks |
| PERF-01, 02, 04 | ✅ | Event driven, one tick per second only for the active tracked tab, batched writes |
| PERF-03, 05, 06 | ⏳ | Content scripts only on group hosts; domain rules merged; memory and timings to measure on real hardware |
| REL-01…04 | ✅ | Idempotent reconciliation, feature detection, unit tests and end-to-end scenarios in Chromium and Firefox (restarts, stopped service worker, suspended event page), visible warnings |
| COMP-01…03 | ✅ | Chrome ≥ 121, Firefox ≥ 140, Firefox for Android ≥ 142; Edge best effort |
| A11Y-01…05 | ✅ | axe WCAG 2.2 AA checks in Chromium and Firefox (every page and state, light and dark), keyboard, focus, ARIA, moderated announcements, accessible challenge alternative |
| I18N-01, 03 | ✅ | All strings externalised (ICU, descriptions), English source. Italian translation not included in this version |
| I18N-02, 04 | 🟡 | Document direction from locale and mostly logical CSS; localized dates and numbers |
| USAB-01, 03 | ⏳ | Require usability tests with users |
| USAB-04, ETH | ✅ | No jargon in simple mode; calm wording; emergency exit |
| MAINT-01…05 | ✅ | TypeScript, pure engine, ADRs, reproducible build, GPL-3.0-or-later, community files, data files for sites |

## Known limitations of v1

- Groups limited to normal or private windows, and regular-expression exceptions overlapping other
  groups, are enforced right after the navigation starts (a page may appear briefly).
- Browser pages protection (PRO-08) cannot work on Firefox for Android and for pages opened from
  the command line.
- Time is not counted on pages where extensions cannot run (browser pages, the PDF viewer, the
  web stores).
- The visual week grid uses 30-minute cells; the time fields allow any minute.
