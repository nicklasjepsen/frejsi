# Review rules for Frejsi

These rules apply to every reviewer of a pull request here: Codex, Copilot, Claude Code's gate agents
and people. They are the only place review rules live. The project's working rules are in `CLAUDE.md`;
the design spec is in `docs/superpowers/specs/2026-10-14-frejsi-design.md`.

## Report

1. **Hard-rule violations**, always, as blocking: insulin dosing in any form (units, ratios,
   corrections, suggestions, in code, copy, prompts, schemas or tests); data from an external source
   or AI created without `verified: false`; a glucose value without its timestamp or rendered without
   its age; the `viewer` role receiving glucose, or any role check done only in the UI; raw readings
   sent to an AI provider; a write to space data that does not go through `emit()`; a vendor API
   called outside its adapter; a glucose source that sends anything to its provider (an upload, a
   follower or alert change, any Dexcom endpoint outside the adapter's allow-list); a secret, a real
   person or PII anywhere.
2. **Bugs** with a concrete scenario: the input or state, and the wrong output or crash.
3. **Contract breaks** between `web/`, `poller/` and `shared/`: a Zod schema, event payload or Prisma
   model changed without every consumer following, or a migration out of order.
4. **Tests that do not test the claim**: mocking the unit under test, asserting a call happened, a
   test that would pass with the feature removed.
5. **Missing translation**: a UI string in one of `da` / `en` but not the other, or hard-coded in a
   component.

## Do not report

- Style, naming, formatting, import order, or anything a linter or formatter owns.
- "Consider adding" suggestions without a failure scenario.
- Comments or documentation wording, unless it states something false.
- Performance, unless the scenario is concrete (the poller over 100 spaces, the chart over a year).
- The absence of a feature the issue did not ask for.

## On a re-review

Check the threads you opened. Resolve each one the author fixed; reply once, briefly, on one they
declined if you still disagree; do not repeat a finding in a new thread. Do not re-review unchanged
code.

## Tone

Short, specific, file and line. No praise, no preamble. A reviewer here is one voice of several; say
what you found, not what the PR should be.
