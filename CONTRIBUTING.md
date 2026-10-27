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
  `description` that explains each placeholder (and the context, when it is not obvious), and
  ICU plurals for every number before a noun. A sentence is one message: never join translated
  pieces; a field or a link inside a sentence is a placeholder (`parts()` and `Fields`). Pass a
  moment with `whenParams()`, and format dates, times and numbers with `src/shared/format.ts`.
  Use the interface terms (rule, condition, limit, browser blocking filters), never the code
  words (group, policy, budget, DNR). `npm run i18n` checks most of this.
- Keep the interface accessible: keyboard use, labels, contrast, no meaning carried by colour
  alone, reduced motion respected.
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

English is the source language, in two files in the WebExtension JSON layout (`message` and
`description`, which Weblate can read as “WebExtension JSON” with its `icu-message-format` check):
`src/locales/en.json` for the interface, in ICU MessageFormat, and `src/_locales/en/messages.json`
for the name, description and shortcuts that the browser and the stores show. To add a language:

1. Copy `src/locales/en.json` to `src/locales/<code>.json` and translate each `message`. The
   descriptions are for you: a translation file needs only the messages.
2. Copy `src/_locales/en/messages.json` to `src/_locales/<code>/messages.json` (the folder uses an
   underscore: `pt_BR`).
3. Add the language to `AVAILABLE_LOCALES` in `src/i18n/i18n.ts`.
4. Run `npm run i18n`: it checks the keys, the ICU syntax, the plural categories, the
   placeholders and the store limits of your files. A message you leave out shows in English.
5. Look at it: `npm run build` and load `dist/<browser>`, with the language chosen in
   Settings › General.

How to write the messages:

- **Context.** The description of a message says where it appears and what each `{placeholder}`
  holds. Keep the placeholders, with their names, and put them where your sentence needs them.
  Keys say where a message is: `iv.*` the block page, `popup.*` the popup, `today.*`, `focus.*`,
  `later.*`, `insights.*`, `protection.*` and `settings.*` the dashboard pages, `wizard.*` and
  `editor.*` the rule editor, `overlay.*` the timer and messages on web pages, `help.*` Help.
- **Plurals.** Write every plural category of your language (`one`, `few`, `many`, `other`…, as in
  [CLDR](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)), and
  always `other`; `#` is the number.
- **Moments.** `{when}` is a moment written for English: “17:00”, “tomorrow 17:00”, “Thu 17:00”.
  If the words around it change with the day in your language, choose them with
  `{day, select, today {… {time}} tomorrow {… {time}} other {… {date} {time}}}`.
- **Sentences with fields or links.** Messages ending in `Fields` and `targets.guide.more` are a
  whole sentence around a field or a link: move the placeholder, not the words around it.
- **Pieces of other messages.** A description that starts “Inside …” names the message that
  receives it: check the sentence it ends up in.
- **Typography.** Use the quotation marks and apostrophes of your language (`common.quote` sets the
  quotes around names and reasons). In ICU an ASCII apostrophe quotes syntax (`'{n,}'`), so an
  apostrophe in your text is ’.
- **Dates, times and numbers** are written by the browser in your language: do not type formats
  into messages.
- **Not translated:** WebHandbrake, product and policy names, addresses and code examples.
- **Length.** Labels wrap rather than overflow, but keep buttons and choices short; a badge holds
  4 characters; the extension name 50 and its description 132. The sentences people type to
  confirm (`emergency.phrase`, `pending.phrase`) must be easy to type on your keyboards.

`npm run build:pseudo` builds `dist-pseudo/` with every message pseudo-translated: accented, 40%
longer and between ⟦ ⟧. Text without ⟦ ⟧ there cannot be translated, and ⟦…⟧ ⟦…⟧ side by side is a
sentence built from pieces: both are bugs to report.

## Site lists

The ready-made lists are plain data in `src/data/templates.ts`; a pull request can add or correct
sites without touching any other code. An entry belongs in a list when people open it to spend time
the way the list says, in many countries or in a large one. Its comment at the top of the file says
how entries are written: addresses people open (no content delivery domains), each site once,
every country domain written out instead of `name.*`, and exceptions for the work tools around a
distraction. Say in the pull request how you checked each address (that it answers, and where it
redirects); `npm test` checks the rest.

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
