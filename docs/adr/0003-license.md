# ADR 0003 — GPL-3.0-or-later

- Status: accepted
- Date: 2026-10-04
- Requirements: MAINT-04

## Context and problem statement

WebHandbrake asks for access to every site and sees every address the browser opens. People who
install it have to trust that it does only what it says, and the way to earn that trust is code
that anyone can read, check and rebuild. The same should hold for versions that other people
distribute.

Which licence keeps WebHandbrake, and the versions derived from it, open to that inspection?

## Considered options

1. **MIT.**
   - Good: the simplest terms, and compatible with almost every other licence.
   - Bad: anyone may distribute a modified version without its source, so a fork that asks for the
     same access to every site can be closed.
2. **MPL-2.0.**
   - Good: modified files stay open, while the code can be combined with code under other licences.
   - Bad: the copyleft covers files, not the whole extension: a fork can add closed files that do
     anything with the data.
3. **GPL-3.0-or-later.**
   - Good: whoever distributes the extension or a modified version must offer its complete source
     under the same licence. "Or later" lets the code be used under later versions of the GPL too,
     without asking every contributor.
   - Bad: code under GPL-incompatible licences cannot be included, and some companies avoid GPL
     code.

## Decision outcome

Chosen: option 3, GPL-3.0-or-later, because only whole-work copyleft keeps every distributed
version of an extension with this much access open to inspection.

- `LICENSE` holds the text of the GNU General Public License version 3, and the `license` field of
  `package.json` is `GPL-3.0-or-later`.
- Contributions are accepted under the same licence, without a contributor licence agreement
  ([CONTRIBUTING.md](../../CONTRIBUTING.md#licence)).
- WebHandbrake's code is written for this project. The only third-party code in the packages is
  Preact (MIT licence, [ADR 0002](0002-ui-preact.md)).

## Consequences

Good:

- Every distributed fork must publish its source under the same terms.
- Offering the source is simple: the packages contain readable, unminified code
  ([ADR 0011](0011-auditable-build.md)), and `npm run package:source` makes the source archive of a
  release.

Bad:

- Every dependency that ends up in the packages must have a GPL-compatible licence. Preact's MIT
  licence is compatible.
- MIT asks that Preact's copyright and permission notice accompany copies of its code. The build
  does not copy that notice into the packages, which is a gap to close before publishing
  ([before the first release](../roadmap.md#before-the-first-release)).
- WebHandbrake's code cannot be reused in projects that stay under a permissive or a
  GPL-incompatible licence.

## Confirmation

- The `toolchain` check of `npm run docs:check` fails when the `license` field of `package.json`
  is not `GPL-3.0-or-later`.
- Not automated: a reviewer checks the licence of every new runtime dependency and of any code
  copied into the repository.
