# ADR 0004 — Classifying configuration changes as units

- Status: accepted
- Requirements: PRO-02, PRO-03, PRO-12

## Context

Strengthening must always be immediate while weakening follows the protection level, and a single
save (or an import) often mixes both.

## Decision

The background diffs the proposed configuration against the current one into small units (a
target added or removed, a group field changed, a setting changed…). Each unit is classified
independently and conservatively: if a change cannot be proven stricter it is weakening (for
example any reordering of policies, or wider windows on a policy that is not the most severe).
Strengthening and neutral units are applied at once; weakening units are routed by level. Pending
units keep their base value and are dropped when the configuration changed meanwhile.

## Consequences

- Imports, restores and resets are protected by construction.
- Some harmless edits are treated as weakening; under Strict they wait for the cooling-off. This is
  accepted in favour of never letting a loosening through by mistake.
