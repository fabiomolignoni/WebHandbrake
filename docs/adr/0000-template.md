# ADR NNNN — <the decision, as a short phrase>

<!--
Copy this file to docs/adr/NNNN-<short-name>.md, using the next free number, and replace every
part in angle brackets. Delete this comment.

Header lines:
- Status: proposed (while the pull request is open), accepted, deprecated, or
  "superseded by ADR NNNN". When a new ADR replaces this one, set that status here and add
  "Supersedes: ADR NNNN" to the new one.
- Date: the day the decision was taken (YYYY-MM-DD).
- Recorded: only when the record is written after the decision; the day it was written.
- Requirements: the requirement IDs the decision serves, from docs/requirements.md.
- Supersedes: only when this ADR replaces an earlier one.

Once accepted, an ADR is not rewritten to record a different decision: write a new ADR that
supersedes it. Correcting a fact, a link or the wording is fine.

Keep the body between 30 and 120 lines. Record the reasons, not the rules: normative statements
belong in docs/requirements.md, and the ADR links them. Leave out timings, test counts and
browser build numbers.
-->

- Status: proposed
- Date: <YYYY-MM-DD>
- Requirements: <IDs, comma-separated>

## Context and problem statement

<The situation and the forces at play, in a few short paragraphs: what is needed, what constrains
the choice, and what is at stake. End with the question this record answers.>

## Considered options

<Every real alternative, the chosen one included. For each, its good and bad points.>

1. **<Option>.** <What it is, in one sentence.>
   - Good: <…>
   - Bad: <…>
2. **<Option>.** <…>
   - Good: <…>
   - Bad: <…>

## Decision outcome

Chosen: <option>, because <the reason that decided it>.

<What exactly is done, with the files, symbols or settings that carry the decision.>

## Consequences

Good:

- <What becomes easier or safer.>

Bad:

- <What becomes harder, what it costs, and what remains unsolved.>

## Confirmation

<The check or test that keeps the decision true, named so that a reader can run it: an npm
script, a check of the documentation tooling, or a test file and the requirement IDs in its
titles. Where nothing is automated, write "Not automated:" followed by what a reviewer checks.>
