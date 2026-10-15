# Contributing to WebHandbrake

Code, translations, site lists, bug reports and ideas are welcome.

## Where to start

- **Questions and ideas**: [GitHub Discussions](https://github.com/fabiomolignoni/WebHandbrake/discussions).
- **Bugs and accessibility problems**: an [issue](https://github.com/fabiomolignoni/WebHandbrake/issues/new/choose),
  after searching for duplicates.
- **Security problems**: the
  [private reporting form](https://github.com/fabiomolignoni/WebHandbrake/security/advisories/new),
  never a public issue.
- For a larger change, open a discussion first, so the design can be agreed before the code.

## Project rules

A change must keep these:

- No network requests of the extension's own, no analytics, no remote code.
- Everything is stored on the device; nothing leaves it unless the person exports it.
- One code base for Chrome, Firefox and Firefox for Android.
- Making rules stricter is always immediate; loosening them always goes through the protection
  of the rules they loosen.
- The interface is calm and non-judgemental, and the healthy choice comes first.

## Set up

You need Node.js (the version in `.nvmrc`; the `engines` field of `package.json` lists the
versions that work) and git.

```bash
npm ci
npm run watch          # rebuilds dist/chrome and dist/firefox on every change
npm run check          # typecheck, lint, strings, unit tests with coverage (report in coverage/)
npm test               # unit tests only
npm run browsers       # once: the browsers of the end-to-end tests
npm run test:e2e       # end-to-end scenarios in Chromium and Firefox
```

Load `dist/chrome` as an unpacked extension, or `dist/firefox` as a temporary add-on
([README](README.md#install)).

## Code

- TypeScript in strict mode; formatting and lint by Biome (`npm run format`, `npm run lint`).
- `src/engine/` is pure: no browser API, and every behaviour has a unit test.
- Every visible string goes through `t()` with a key in `src/locales/en.json`, with a
  `description` when the context is not obvious, and ICU plurals for counts. Use the interface
  terms (rule, condition, limit, browser blocking filters), never the code words (group, policy,
  budget, DNR).
- Keep the interface accessible: keyboard use, labels, contrast, no meaning carried by colour
  alone, reduced motion respected ([accessibility](README.md#accessibility)).
- A new behaviour comes with tests: unit tests for logic, an end-to-end scenario for a flow.
  Background modules are unit tested against the fake browser of `tests/unit/fake-browser.ts`;
  end-to-end scenarios are for what only a real browser shows: blocking filters, content
  scripts, the pages and their flows. A scenario moves the extension's clock (`h.clock`) rather
  than waiting for real time. A worker keeps its browser for the next scenario, with
  every tab closed and the extension installed again; a scenario with launch options of its own
  (`test.use({ launch })`) gets a new browser.
- Help text is in `src/dashboard/help-content.ts`.

## Documentation

The documents for people who use WebHandbrake are [README.md](README.md),
[PRIVACY.md](PRIVACY.md) and **Help** inside the extension. When a change affects them, update
them in the same pull request, and describe user-visible changes under `[Unreleased]` in
[CHANGELOG.md](CHANGELOG.md).

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

- Keep each pull request to one change, and say which issue it addresses.
- `npm run check` and `npm run test:e2e` pass, in both browsers.
- Fill in the checklist of the pull request template.

## Releases

A maintainer closes a version from an up-to-date `main`:

```bash
npm run release -- 1.2.0 --push
```

The version is `x.y.z`, or `patch`, `minor` or `major` to raise the one in `package.json`. The
command runs the checks, sets the version, turns `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md)
into the entry of the version, commits it and tags `v<version>`. `--push` pushes `main` and the
tag together, and the tag starts the release workflow, which builds the store packages and
drafts the GitHub release. Without `--push` nothing leaves your machine; `--dry-run` shows the
release without changing anything.

## Licence

WebHandbrake is licensed under the [GNU General Public License v3.0 or later](LICENSE). By
contributing, you agree that your contribution is licensed under the same terms.
