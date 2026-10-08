# ADR 0004 — Classify every configuration change in the background

- Status: accepted
- Date: 2026-10-04
- Requirements: PRO-02, PRO-03, PRO-05, PRO-12, PRO-14, PRO-20

## Context and problem statement

Making the rules stricter must always apply at once, while loosening them follows the protection
level: a confirmation, a wait, a cooling-off or a refusal (PRO-02, PRO-03; the
[evidence](../principles.md#loosening-waits-tightening-is-instant)). Changes reach the
configuration through many paths: a save in the rule editor, the settings, an import, a restore
from a backup, a reset, the **Block site** command of the popup, the context menu and the keyboard
shortcut. One save often mixes both directions, for example a site added and another removed.

Where is a change judged, and in what units?

## Considered options

1. **Protect screens in the interface:** lock the editor and the settings while the rules are
   protected.
   - Good: simple to build and to explain.
   - Bad: imports, restores, resets and commands bypass the screens, and a check in a page can be
     removed with the browser's developer tools (PRO-14).
2. **Judge each save as a whole:** a save is either stricter or looser.
   - Good: one decision per save, easy to show.
   - Bad: a save that mixes both directions must be treated as loosening entirely, so adding a site
     would wait as long as removing one.
3. **Split each proposed configuration into small units in the background and judge each unit.**
   - Good: every path is protected by the same code, and each part of a mixed save gets its own
     treatment.
   - Bad: the classifier must know every field of the configuration, and it cannot always prove that
     a change is stricter.

## Decision outcome

Chosen: option 3.

- **Whole-configuration proposals.** Every change a person makes reaches the background as a
  complete proposed configuration (`proposeConfig()` in `src/background/protection.ts`). The
  emergency exit is the one exception: it is the designed way out and writes its changes directly.
- **Units.** `diffConfig()` in `src/engine/changes.ts` splits the difference into `ChangeUnit`s: a
  rule added, removed or with one field changed, a shared list linked to a rule or unlinked, a site
  entry added, removed or annotated, a shared list added, removed or renamed, the order of the
  rules, and one unit per setting. (Rule is the interface term for the code's `Group`; the
  [glossary](../glossary.md) maps the two vocabularies.)
- **Conservative classification.** `classify()` labels each unit stricter, neutral or loosening.
  When it cannot prove that a unit is stricter, the unit counts as loosening: any reordering of
  conditions, wider time windows on a condition that is not the most severe, and an addition to
  **Always allowed** are loosening. Most edits to disabled or archived rules are neutral, and so is
  the order of rules, which only decides between results of equal severity and strength. A
  setting without a rule in `classifySetting()` counts as loosening.
- **Routing.** Stricter units apply at once. Neutral units apply at once unless the settings
  password or the random code is set: then they cost those steps, and inside the times when
  settings cannot be loosened they are refused. Loosening units are refused inside those times;
  otherwise they follow the protection level that governs them: the strictest level among the
  rules they touch, or the global level for units that touch no rule.
- **Pending changes.** Under Strict, a loosening unit is refused while a rule it touches is
  active (any rule, for a unit that touches none), and otherwise waits for the cooling-off. It
  keeps the value it was based on and is dropped if the configuration has changed since.
  Confirming it checks the level again and asks for a typed code; it expires when it is not
  confirmed in time.
- **First run** (PRO-20). While there are no rules and no running or planned focus session,
  lowering the protection level is neutral, except from Locked.

The normative rules are in [the requirements](../requirements.md#change-classification).

## Consequences

Good:

- Imports, restores, resets and the commands are protected by construction (PRO-12).
- Removing a check from a page loosens nothing, because the background decides (PRO-14).
- The save result tells the person which units applied, which cost something, which wait and which
  were refused.
- A new setting that nobody classified errs on the strict side.

Bad:

- Some harmless edits count as loosening, such as reordering conditions, and under Strict they wait
  for the cooling-off. This is accepted, so that no loosening ever passes by mistake.
- Every new field of the configuration needs a classification rule and a unit test, or it is
  treated as loosening.

## Confirmation

- The unit tests in `tests/unit/changes.test.ts` ("change classification (PRO-02)", "policy
  comparison", "applying units") cover the direction of each kind of unit, the conservative cases
  and stale pending units.
- The PRO-01, PRO-02, PRO-03, PRO-05 and PRO-12 scenarios in `tests/e2e/protection.spec.ts` check
  the routing through the real interface in both browsers.
