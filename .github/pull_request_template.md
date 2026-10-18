## What and why

<!-- One paragraph. Link the issue: Closes #n -->

## Hard rules (tick honestly; the spec-guardian checks the same list)

- [ ] No insulin dosing: nothing computes, suggests or lets anyone enter insulin (no input field, calculation, ratio, correction or "you should" in code, copy, prompts, schemas or tests); pump history (the time and delivered units of a bolus the pump recorded) stays read-only, in its own copy files, never to a viewer or an AI model
- [ ] Anything from OFF, Frida, AI or free text is created `verified: false`
- [ ] Every glucose value travels with its timestamp and renders with its age
- [ ] `viewer` never receives glucose, enforced in the API layer
- [ ] Raw readings never go to an AI call; photos and text only on an explicit user action; daily cap in place
- [ ] Every write to space data goes through `emit(spaceId, type, payload)`
- [ ] External sources stay behind `GlucoseSource` / `FoodSource` / `AiProvider`; nothing Danish hard-coded
- [ ] Glucose sources are read-only: nothing is sent to a CGM or glucose service (no uploads, no follower or alert changes); the Dexcom adapter calls only its allow-listed endpoints
- [ ] No secrets, no real people, no PII in code, fixtures, seeds or logs
- [ ] UI strings in both `da` and `en`; Danish reads like a kind nurse

## Docs

<!-- Update docs in this PR. List the paths actually changed, one per bullet (backticks or links).
     Counts: README.md, CONTRIBUTING.md, CLAUDE.md, AGENTS.md, docs/** except docs/design/** and
     docs/superpowers/plans/**, infra/README.md, poller/README.md, .env.example.
     If no counted docs changed and none need changing, write:
     None needed: <a concrete reason, not a placeholder>. -->

## Tests

<!-- Which acceptance criteria have a test, and where. Fixtures used. -->

## Codex review

<!-- Findings declined, with the reason. "None declined" is fine. -->

## For the owner

<!-- Anything you had to decide on their behalf, or left for them. "Nothing" is fine. -->
