# ADR 0008 — Active choice in first run and the rule wizard

- Status: accepted
- Date: 2026-10-06
- Recorded: 2026-10-07
- Requirements: ONB-01, ONB-08, ONB-09

## Context and problem statement

Every rule needs an intervention, and first run needs to know what the person wants to change.
WebHandbrake does not know why it was installed, and the right step differs between people:
restrictive lockouts change behaviour more than warnings but frustrate, and strict blocking helps
some people while it stresses others
([Strictness is chosen, with an emergency exit](../principles.md#strictness-is-chosen-with-an-emergency-exit)).

The original specification proposed a default for ready-made lists: a wait with an intention
question for tempting sites, and a block for explicit time windows and sessions. A pre-selected
option reads as a recommendation, which the product is in no position to make.

The question: what should first run and the rule wizard pre-select, if anything?

## Considered options

1. **Pre-select friction** (**Ask what I want to do** or **Wait**).
   - Good: one click less; it starts in the middle of the ladder.
   - Bad: it reads as advice; it is wrong for people who want only to count time or to block a site
     completely.
2. **Pre-select Block.**
   - Good: it matches what people expect of a blocker and is the simplest to explain.
   - Bad: a wall for everyone, against principle G1; restrictive settings frustrate when contexts
     vary.
3. **Active choice:** nothing that depends on the person is pre-selected, and the next step opens
   once a choice is made.
   - Good: requiring an active decision suits preferences that differ widely
     ([Carroll et al. 2009](../principles.md#ref-carroll2009)); choosing supports autonomy
     ([Ryan & Deci 2000](../principles.md#ref-ryan2000)); each option can state what it does before
     it is chosen ([Keller et al. 2011](../principles.md#ref-keller2011)).
   - Bad: one more decision for a newcomer, who may not know which step to take.

## Decision outcome

Chosen: option 3, active choice ([Active choice in setup](../principles.md#active-choice-in-setup)).

- **First run** pre-selects no goal and no intervention, and labels nothing as recommended. The
  goals "Block some sites completely" and "Just see where my time goes" imply the intervention and
  skip that step.
- **The rule wizard** pre-selects no option of **What should happen?**.
- **Settings of the chosen intervention** keep their defaults (`defaultIntervention()` in
  `src/engine/defaults.ts`). Only a redirect asks for its address, because no default fits it.
- **Ready-made lists** (`TEMPLATES` in `src/data/templates.ts`) bring sites, a name, a colour and an
  icon, but no intervention.
- **Firmness:** first run offers **Soft**, **Balanced** and **Strict**, with the current level
  selected because it is the extension's state. **Locked** is offered only on the **Protection**
  page, after a preview.
- **The full rule editor** is for people who know the concepts and keeps starting points: a rule
  opened there without a choice starts with one condition that asks what the person wants to do
  (`frictionIntervention()` in `src/engine/defaults.ts`), and its buttons add a time window or a
  time limit that blocks, or friction at all times.

## Consequences

Good:

- No hidden recommendation. The plan sentence at the end of the wizard and of first run states
  the step the person chose.
- A choice can be changed at any time: making a rule stricter applies at once, and loosening it
  follows the protection level.

Bad:

- Setup asks for one more decision. The Help topic
  [Choosing friction and firmness](../user-guide.md#choosing-friction-and-firmness) has to guide
  it, and each option shows its description (and, in first run, a miniature) once picked.
- The wizard's **When** step starts on **Every time**: only the goal and what happens are active
  choices.
- The wizard and the full editor start differently, so the two ways to create a rule are not
  identical.

## Confirmation

- The end-to-end scenarios in `tests/e2e/dashboard.spec.ts` assert that nothing is checked
  (`aria-checked="true"` counts zero) when the wizard's **What should happen?** step opens and when
  the goal step of first run opens.
- Not automated: a reviewer checks that no option is labelled as recommended.
