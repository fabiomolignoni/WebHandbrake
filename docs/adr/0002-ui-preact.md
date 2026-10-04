# ADR 0002 — Preact for the user interface

- Status: accepted
- Requirements: D3, PERF-06, MAINT-01

## Context

The popup must open fast and the dashboard is a sizeable single-page application. Candidates were
Svelte, Preact, Lit and plain DOM code.

## Decision

Preact with hooks and TSX, bundled by esbuild into one script per surface. Styles are a single
hand-written design-system stylesheet with CSS custom properties (no CSS framework, no remote
fonts).

## Consequences

- Small runtime (a few kilobytes), familiar component model for contributors, no compiler plugin.
- Typing relies on Preact's JSX types; components live in `src/ui` and are shared by the popup,
  dashboard and intervention page.
