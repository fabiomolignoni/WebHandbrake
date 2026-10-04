# ADR 0001 — Manifest V3 everywhere, declarativeNetRequest first

- Status: accepted
- Requirements: D2, COMP-02, ENF-01, ENF-08, PERF-02

## Context

Chrome only supports Manifest V3. Firefox supports MV3 and still offers blocking `webRequest`.
One code base must serve Chrome, Firefox desktop and Firefox for Android.

## Decision

Use MV3 on both browsers. Blocking relies on dynamic `declarativeNetRequest` rules compiled by the
pure engine from the current decisions; navigation listeners and the intervention page re-check
every decision with the engine as a second layer. Blocking `webRequest` is not used.

Redirect rules carry the original URL with `regexFilter: ^(.*)$`, `requestDomains` and a
`regexSubstitution` to `intervention.html#\1`. Verified on Chromium and Firefox 157.

## Consequences

- No page flash and no request reaches blocked sites in the common cases; rules persist across
  restarts.
- Decisions that DNR cannot express exactly (groups limited to private or normal windows,
  regular-expression exceptions overlapping other groups) are handled by the second layer, with a
  possible brief page start.
- Rules must be recompiled on every state change; the compiler keeps the rule count low by merging
  plain domains.
