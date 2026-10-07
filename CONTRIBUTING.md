# Contributing to WebHandbrake

Thank you for helping! WebHandbrake is a community project: code, translations, site lists,
bug reports and ideas are all welcome.

## Before you start

- **Ideas and questions** go to GitHub Discussions; **bugs** to Issues (please search for
  duplicates first and use the templates).
- Changes should respect the project constraints: local-first, no telemetry, no network requests
  of the extension's own, no remote code, Firefox (desktop and Android) and Chromium from one code
  base. See [`docs/requisiti.md`](docs/requisiti.md) and the requirement IDs (e.g. `MAT-04`).

## Development setup

```bash
npm ci
npm run watch          # rebuilds dist/chrome and dist/firefox
npm run check          # typecheck, lint, i18n check, unit tests
npm run browsers       # once: Chromium, Firefox and geckodriver for the end-to-end tests
npm run test:e2e       # end-to-end scenarios in Chromium and Firefox
```

Load `dist/chrome` as an unpacked extension or `dist/firefox` with `web-ext run`.

## Code guidelines

- TypeScript, strict mode. Formatting and lint by [Biome](https://biomejs.dev) (`npm run format`).
- The **rule engine** (`src/engine`) is pure: no browser APIs, fully unit tested. Platform code
  lives in `src/background`, `src/platform` and the UI folders.
- Every user-visible string goes through `t()` with a key in `src/locales/en.json` (with a
  `description` when the context is not obvious). Use ICU plurals for counts.
- UI must stay accessible: keyboard navigation, labels, contrast (axe checks run in CI in both
  browsers), no information conveyed by colour alone, `prefers-reduced-motion` respected.
- Write in a calm, non-judgemental tone (see §8.5 of the requirements).
- New behaviour comes with tests: unit tests for the engine, end-to-end scenarios for flows. A
  scenario runs in both browsers; see [`docs/testing.md`](docs/testing.md) for the harness and
  how to write one.

## Site lists and templates

Built-in templates live in [`src/data/templates.ts`](src/data/templates.ts) as plain data: you can
propose additions without touching code.

## Pull requests

- Keep them focused; mention the requirement IDs they implement or the issue they fix.
- `npm run check` and `npm run test:e2e` must pass.
- Architectural decisions get a short ADR in `docs/adr`.

By contributing you agree that your contribution is licensed under the GPL-3.0-or-later.
