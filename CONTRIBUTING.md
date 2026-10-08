# Contributing to WebHandbrake

Code, translations, site lists, bug reports and ideas are welcome. Please follow the
[code of conduct](CODE_OF_CONDUCT.md).

## Where to start

- **Questions and ideas**: [GitHub Discussions](https://github.com/fabiomolignoni/WebHandbrake/discussions).
- **Bugs and accessibility problems**: an [issue](https://github.com/fabiomolignoni/WebHandbrake/issues/new/choose),
  after searching for duplicates.
- **Security problems**: [SECURITY.md](SECURITY.md), never a public issue.
- For a larger change, open a discussion first, so the design can be agreed before the code.

## Project rules

A change must keep these, which the [requirements](docs/requirements.md#constraints) state in full:

- No network requests of the extension's own, no analytics, no remote code.
- Everything is stored on the device; nothing leaves it unless the person exports it.
- One code base for Chrome, Firefox and Firefox for Android.
- Making rules stricter is always immediate; loosening them always goes through the protection
  level ([ADR 0004](docs/adr/0004-change-classification.md)).
- The interface is calm and non-judgemental, and the healthy choice comes first
  ([principles](docs/principles.md), [design](docs/design.md)).

## Set up

You need Node.js (the version in `.nvmrc`; the `engines` field of `package.json` lists the
versions that work) and git.

```bash
npm ci
npm run watch          # rebuilds dist/chrome and dist/firefox on every change
npm run check          # typecheck, lint, strings, unit tests, documentation checks
npm run browsers       # once: the browsers of the end-to-end tests
npm run test:e2e       # end-to-end scenarios in Chromium and Firefox
```

Load `dist/chrome` as an unpacked extension, or `dist/firefox` as a temporary add-on
([README](README.md#install)). The [testing guide](docs/testing.md) explains both test suites and
how to write a scenario; the [architecture](docs/architecture.md) explains the code.

## Code

- TypeScript in strict mode; formatting and lint by Biome (`npm run format`, `npm run lint`).
- `src/engine/` is pure: no browser API, and every behaviour has a unit test.
- Every visible string goes through `t()` with a key in `src/locales/en.json`, with a
  `description` when the context is not obvious, and ICU plurals for counts. Use the interface
  terms of the [glossary](docs/glossary.md).
- Keep the interface accessible: keyboard use, labels, contrast, no meaning carried by colour
  alone, reduced motion respected ([accessibility](docs/accessibility.md)).
- A new behaviour comes with tests: unit tests for logic, an end-to-end scenario for a flow. A
  test that verifies a requirement cites its ID in its title, for example `SEM-02`.
- Help text is in `src/dashboard/help-content.ts`; `npm run docs` regenerates
  [docs/user-guide.md](docs/user-guide.md) from it.

## Documentation

Documentation is checked like code. When a change affects it, update the document in the same
pull request: a requirement in [docs/requirements.md](docs/requirements.md), a decision as an ADR
in [docs/adr](docs/adr/README.md) (copy `docs/adr/0000-template.md`), user-visible changes under
`[Unreleased]` in [CHANGELOG.md](CHANGELOG.md). Then run `npm run docs` and `npm run docs:check`.
[How these documents stay correct](docs/README.md#how-these-documents-stay-correct) explains the
checks.

## Translate

English is the source language. To add a language:

1. Copy `src/locales/en.json` to `src/locales/<code>.json` and translate each `message`; leave the
   `{placeholders}` and the ICU structure as they are.
2. Copy `src/_locales/en/messages.json` to `src/_locales/<code>/messages.json` for the name and
   description shown by the browser.
3. Add the language to `AVAILABLE_LOCALES` in `src/i18n/i18n.ts`.
4. Run `npm run i18n`.

## Site lists

The ready-made lists are plain data in `src/data/templates.ts`; a pull request can add or correct
sites without touching any other code.

## Pull requests

- Keep each pull request to one change, and say which issue or requirement IDs it addresses.
- `npm run check` and `npm run test:e2e` pass, in both browsers.
- Fill in the checklist of the pull request template.

## Licence

WebHandbrake is licensed under the [GNU General Public License v3.0 or later](LICENSE)
([ADR 0003](docs/adr/0003-license.md)). By contributing, you agree that your contribution is
licensed under the same terms.
