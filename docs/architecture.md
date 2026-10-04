# Architecture

WebHandbrake is a Manifest V3 extension built from one TypeScript code base for Chrome (service
worker) and Firefox desktop/Android (event page). This document explains how the pieces fit.

```
src/
  engine/       Pure rule engine: data model, matching, schedules, budgets, decisions,
                next change, DNR compiler, change classifier, validation, importers.
                No browser API — fully unit tested.
  background/   The single source of truth at run time: storage, accounting, enforcement,
                protection, tickets, pauses, sessions, statistics, data, diagnostics.
  content/      Content script for the groups' sites: active-time ticks, overlay timer,
                filters, grace period, back/forward cache re-checks.
  popup/        Toolbar popup.
  dashboard/    Full-page management UI (hash router, pages, editors).
  intervention/ The page shown instead of a restricted site.
  ui/           Shared Preact components, design system CSS, hooks.
  shared/       View models, typed RPC, formatting, natural-language summaries.
  i18n/         ICU message formatting and locale loading.
  platform/     Browser adapter and feature detection (Chrome/Firefox/Android).
  data/         Built-in templates (site lists as data).
  locales/      Messages (English source).
```

## Data model

`Config` (groups, shared lists, "Always allowed", settings) is the user's intent. Every entity has
a stable id, a revision and an update time, and deletions leave tombstones, so cross-device sync
(R3) can be added without changing the model. `RuntimeState` holds what changes over time: grants
(breaks and passes), focus sessions, pending changes, cool-downs, activity, tamper events. Usage is
stored as daily aggregates per group, per group site and per host, plus minute buckets for the
last 48 hours (hourly and rolling limits).

## Deciding what happens to a URL

`engine/decide.ts` implements the normative semantics of §6.2:

1. The global allowlist wins over everything (SEM-05).
2. In each group, the most specific matching entry decides; exceptions beat less specific blocks
   and ties go to the block (SEM-02, SEM-06). Exceptions never affect other groups (SEM-04).
3. Policies are evaluated in order; the first whose condition (schedule and, optionally, an
   exhausted budget) is true gives the intervention. Cool-downs and focus sessions can raise it;
   breaks and passes can lower it.
4. Across groups the most severe intervention wins, whatever the order (SEM-03). Allowlist focus
   sessions block every other web page.

`engine/next.ts` computes when the situation changes (SEM-07) by evaluating the decision at every
candidate instant (window boundaries, period ends, grant expiries, session ends…).

## Enforcement in layers

1. **declarativeNetRequest** (`engine/dnr.ts`, `background/dnr-sync.ts`). Every distinct target is
   a region; the engine decides what must happen to a representative URL of the region and a rule
   is emitted with a priority derived from the specificity. Redirect rules use
   `regexFilter: ^(.*)$` + `requestDomains` and a `regexSubstitution` to
   `intervention.html#<original URL>`, so plain domains of any number share one rule. Rules are
   dynamic, so they apply from browser start-up (ENF-08). Without host access, redirects become
   network blocks (ENF-12).
2. **Navigation checks** (`background/enforce.ts`): committed navigations, history API changes
   (single-page apps), browser pages and local files are re-checked; groups limited to normal or
   private windows are handled when the navigation starts.
3. **The intervention page** asks the background for the exact decision; if the rules were broader
   than the engine, it lets the page through with a short-lived hint (ENF-09).
4. **State changes** (window start, budget exhausted, break over) trigger a reconciliation that
   re-applies the decision to every open tab within a second, with a grace period when the user is
   typing (INT-13).

## Time accounting

The content script sends a tick about once per second only while the page is visible, focused and
the user is active (or media plays). The background credits each usage key with the time elapsed
since the previous credit of that key, capped to a few seconds: several tabs never count twice
(TIM-03) and sleeps or clock jumps never count (TIM-02). Counters are flushed at most every 10 s.

## Protection

Configuration changes are diffed into small units (`engine/changes.ts`) and classified as
strengthening, neutral or weakening — conservatively: when stricter cannot be proven, it is
weakening. `background/protection.ts` applies strengthening units at once and routes the others by
protection level: a confirmation (Soft), a wait (Balanced), a cooling-off with a typed confirmation
(Strict, refused while the group is active) or a refusal (Locked). All costs are **tickets**
verified in the background (`background/tickets.ts`), so editing an extension page cannot skip
them (PRO-14).

## Persistence and reliability

Storage is the source of truth (REL-01). The configuration is written with a checksum and every
write keeps the previous version (last 20 plus one per day for 30 days); a corrupted configuration
is restored from the latest valid snapshot at start-up (DAT-03). Schema migrations keep a copy of
the original data until they succeed (DAT-07). Unknown fields are always preserved.

## Messaging

UI pages call the background through a typed RPC (`shared/rpc.ts`). Content scripts can only call
the `cs.*` methods (SEC-05). Methods that change the configuration are serialised. The background
broadcasts a "changed" message so open pages refresh.

## Platform differences

| Concern | Chrome | Firefox desktop | Firefox for Android |
| --- | --- | --- | --- |
| Background | service worker | event page | event page |
| Context menu, shortcuts | yes | yes | not available (feature-detected) |
| Window focus | page focus + visibility (all platforms) | | |
| Minimum version | 121 | 140 | 142 |
