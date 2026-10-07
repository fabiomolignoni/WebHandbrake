# ADR 0007 — Interface terms differ from code names

- Status: accepted
- Date: 2026-10-06
- Recorded: 2026-10-07
- Requirements: USAB-04

## Context and problem statement

The engine models a `Group`: a set of site entries (`Target`) with an ordered list of `Policy`
items, each with an optional schedule, an optional `Budget` and an intervention. The
[glossary](../glossary.md) lists these model names next to the interface terms.

The interface first showed this object as a "group". The word names a container, not what the
object does: a set of sites plus when and how they are slowed down, from only counting time to a
block. The obvious alternative, "rule", already had a second meaning in the interface: the
browser's own declarativeNetRequest rules, listed in Diagnostics. Unrestricted states were called
"Free", which also reads as "free of charge" next to "free software".

People rarely agree on a name: in the studies of Furnas et al., two people chose the same term for
the same object with a probability below 0.20
([Furnas et al. 1987](../principles.md#ref-furnas1987)). No single label fits everyone, so the
choice is about the best fit plus keeping the words people search for where they look.

Two questions follow: which words does the interface use, and do the code, the routes and the
stored data follow them?

## Considered options

For the main object:

1. **Groups.** Accurate for every configuration and already the code's name. It says nothing about
   what the object does.
2. **Rules.** Says what the object does in every configuration (block, ask, wait, only count), and
   matches existing copy such as "your rules" and the protection levels. It needs two more words to
   stay unambiguous: one for the lines inside a rule and one for the browser's rules.
3. **Blocks.** Familiar from blocking tools. Wrong for rules that ask, wait or only count, it
   clashes with the **Block** intervention ("Block → Block"), and it frames every rule as a wall,
   against principle G1.
4. **Limits.** Familiar from screen-time tools. It clashes with time limits, which appear in
   conditions, Help, privacy texts and protection.
5. **Brakes.** On brand, but a metaphor that tells a newcomer little.

For the code:

- **Rename the code, routes and stored data too.** One vocabulary everywhere, at the cost of a
  migration of stored configurations and export files, and churn across the engine and the tests.
- **Keep the model names in code, routes and data.** No migration; the two vocabularies are mapped
  in one place.

## Decision outcome

Chosen: **Rules**, with the model names kept in code, routes and data.

- The interface says **rule** for `Group`, **condition** for `Policy`, **limit** for `Budget`, and
  **Browser blocking filters** for the browser's declarativeNetRequest rules, so that no interface
  word means two things. The glossary lists the other terms.
- **Allowed** replaces "Free" for unrestricted states, and **Time counted** names the state of a
  rule that only counts time.
- Code, routes (`#/groups`), storage keys and export files keep the model names. The glossary is
  the single mapping between the two vocabularies.
- The words people search for stay where they look: **Block site** in the popup, "Block, limit or
  slow down the sites you choose" under **Rules**, the **Block** option in every intervention
  picker, and search over rule names and sites.

## Consequences

Good:

- Interface words describe what each object does, and none has two meanings.
- Stored configurations and export files did not change, so nothing had to be migrated.

Bad:

- There are two vocabularies. Contributors translate between them through the glossary; code,
  comments and test titles use the model names.
- Code terms can leak into interface text and user-facing documents; a check guards against it
  (below).
- The vocabulary problem remains for some people: no word is found by everyone, which is why the
  search words stay in place.

## Confirmation

- The `words` check of `npm run docs:check` fails when a user-facing document uses a word that the
  glossary marks to avoid, and when a message in `src/locales/en.json` contains the words group,
  groups, DNR or declarativeNetRequest.
- Not automated: a reviewer checks that a new label uses the glossary's interface term.
