# WebHandbrake

**A handbrake for the web.** WebHandbrake is a browser extension that helps you use the sites you
choose *when* and *as much as* you decided — with graduated friction (a reminder, a question, a
short wait, a challenge) before the wall, serious protection against your own impulses, and
everything kept on your device.

It works on **Firefox** (desktop and Android) and **Chrome** (and other Chromium browsers) from a
single code base, with no account, no server and no telemetry.

## Highlights

- **Rules for the sites you choose**, created step by step, with precise targets: domains (subdomains included), single hosts, paths,
  exact pages, home pages, wildcards, query parameters, regular expressions, exceptions and
  exceptions of exceptions. Paste anything: URLs, lists, hosts files, uBlock Origin, AdGuard and
  uBlacklist syntax.
- **Rules that read like sentences**: "Mon–Fri 09:00–17:00 → Block", "Always, after 45 min per
  day → Wait 30 s". Overnight windows, time limits per hour/day/week/month/custom or rolling
  periods, visit limits, continuous-use limits with a mandatory stop, per-site budgets.
- **Graduated interventions**: count only, reminder, visual filter (grayscale, blur…), intention
  question with a chosen duration, wait, typed challenge, block, close or redirect. The healthy
  choice always comes first; pages can be saved for later.
- **Blocking before the network** with `declarativeNetRequest`: no page flash, no cookies,
  active from browser start-up. Single-page apps, back/forward cache, browser pages and files are
  covered too.
- **Breaks** per page, site, group or all, with duration, budget, cost (confirmation, wait,
  challenge, password) and reason; they end by themselves and re-apply at once.
- **Focus sessions** in two taps, with an allowlist mode and an optional "cannot be interrupted".
- **Protection levels** — Soft, Balanced, Strict, Locked: making rules stricter is always
  immediate, loosening them costs a confirmation, a wait, or a cooling-off period followed by a
  typed confirmation. An emergency exit always exists.
- **"Why?"** everywhere: which group, entry and rule apply, and when it changes.
- **Local statistics** (daily aggregates only), insights, CSV/JSON export, deletion in one click.
- **Import from LeechBlock NG**, export/import, automatic backups with integrity checks.
- **Accessible** (WCAG 2.2 AA checks in CI), light/dark/high-contrast themes, responsive down to
  phones, fully translatable (English source, ICU plurals).

The full requirements are in [`docs/requisiti.md`](docs/requisiti.md) (Italian); the status of
every v1 requirement is tracked in [`docs/traceability.md`](docs/traceability.md).

## Install from source

Requirements: Node.js 20 or newer.

```bash
npm ci
npm run build          # dist/chrome and dist/firefox
```

- **Chrome / Edge / Brave**: open `chrome://extensions`, enable *Developer mode*, *Load unpacked*
  and choose `dist/chrome`.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, *Load Temporary Add-on…* and choose
  `dist/firefox/manifest.json` — or run `npx web-ext run --source-dir dist/firefox`.
- **Firefox for Android**: `npx web-ext run -t firefox-android --source-dir dist/firefox
  --android-device <id>` (see the web-ext documentation).

Store packages: `npm run package` writes zip files to `web-ext-artifacts/`. The build is
reproducible (no minification, no timestamps, no remote code).

## Development

| Command | What it does |
| --- | --- |
| `npm run watch` | Rebuilds both targets on every change |
| `npm run typecheck` | TypeScript checks (sources and tests) |
| `npm run lint` | Biome lint and formatting checks |
| `npm run i18n` | Every message key used exists, ICU syntax is valid |
| `npm test` | Unit tests (rule engine, schedules, budgets, DNR compiler, change classifier, importers, store) |
| `npm run test:e2e` | End-to-end tests in Chromium with the built extension (Playwright) |
| `npm run test:firefox` | Smoke test in a real Firefox through WebDriver BiDi (`FIREFOX_BIN` required) |
| `npm run check` | Typecheck + lint + i18n + unit tests |

See [`docs/architecture.md`](docs/architecture.md) for how the pieces fit together and
[`docs/adr`](docs/adr) for the main decisions.

## Translating

English is the source language. Messages live in [`src/locales/en.json`](src/locales/en.json)
(WebExtension JSON format with a description for translators, ICU MessageFormat for plurals). To
add a language, copy the file to `src/locales/<code>.json`, translate the `message` values and add
the code to `AVAILABLE_LOCALES` in [`src/i18n/i18n.ts`](src/i18n/i18n.ts). Manifest strings are in
[`src/_locales`](src/_locales).

## Privacy

WebHandbrake makes no network requests of its own, has no analytics and stores everything in the
browser profile. Details in [`PRIVACY.md`](PRIVACY.md).

## Contributing

Issues, ideas and pull requests are welcome: please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and
the [code of conduct](CODE_OF_CONDUCT.md). Security issues: see [`SECURITY.md`](SECURITY.md).

## License

[GNU General Public License v3.0 or later](LICENSE).
