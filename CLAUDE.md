# Frejsi — instructions for Claude

**All communication in this repo is in English** — prompts, commits, code, comments, docs, issues. The product UI is Danish-first (`da`) with English (`en`); that is the only place Danish appears.

## What this is

An open-source (AGPL-3.0) web app for one person with diabetes and the people around them: carb lookup (Danish products, barcodes, own dishes), a child-friendly `simpleMode`, and meals shown on the live glucose curve. **Mobile and desktop are both first-class** — installable PWA on phones for logging in the moment, a full desktop layout for review and admin; one responsive codebase, layouts designed per breakpoint. **It never computes or suggests insulin.**

## Where things stand

- Application code and Azure resources exist. `main` includes the v0.1.0 foundation (passkeys, roles, settings, Dexcom Share and live glucose), v0.2.0 food/library/photos and meal logging, v0.3.0 meal curves, editing/comparison and day/week history, and v0.3.1 the Dexcom Clarity CSV import (`shared/src/glucose/import/`, owner-only, readings and carb entries only). AI and the community/portability features remain planned.
- A merge or a push to `main` runs fast CI and deploys nothing. A version tag runs `release.yml`: full suites, infrastructure when changed, deployment and smoke checks, then a GitHub release and milestone closure. Check published GitHub releases for shipped versions; a failed run can leave Azure resources and a tag without a published release. See `docs/agent-workflow.md` §4–6.
- `README.md` describes current features; `CONTRIBUTING.md` covers contributing; `docs/operations.md` is the runbook; `infra/README.md` covers Azure/fork setup and `poller/README.md` the timer, adapter wiring and local CLI.
- `docs/superpowers/specs/2026-10-14-frejsi-design.md` is the original design spec. **Read it before doing anything**, but distinguish its historical status and planned features from the implementation. `docs/ui-brief.md` is the original UI brief; `docs/design/` holds the hand-in and tokens; `docs/superpowers/plans/` holds versioned plans and the roadmap.

## Sequence for future milestones

1. **UI design in Claude Design** where new screens need it, building on `docs/design/` (exports, tokens, component list).
2. **Implementation plan** via the `writing-plans` skill from the spec + design. Save under `docs/superpowers/plans/`.
3. **Implement** milestone by milestone. Each plan names a milestone (`vX.Y.Z`); `/create-issues` puts it on the board, `/start-milestone` builds it as 4–6 vertical-slice lanes and releases it. TDD.

Do not skip to code before the plan exists and the owner has approved it.

## Working with agents

The operating model for building Frejsi with agent teams is `docs/agent-workflow.md`: who builds, who
reviews, what the owner decides. The pieces live in the repo:

- `.claude/agents/` — `planner`, `implementer`, `spec-guardian`, `reviewer`, `copy-reviewer`, `triage`.
- `.claude/workflows/` — `plan-to-issues`, `build-lanes`, `ship-milestone`, `review-pr`, `housekeeping-sweep` (run with the Workflow tool).
- `.claude/skills/` — `/create-issues`, `/start-milestone`, `/release`, `/gate-pr`, `/land`, `/housekeeping`: the procedures around them.
- `.github/workflows/ci.yml` — the fast suite, the only required check. `release.yml` — the only path to production, on a `vX.Y.Z` tag. `housekeeping.yml` — daily background triage and cleanup, outside PR CI.
- `.github/copilot-instructions.md` — the one set of review rules, shared by Codex, Copilot and the gate agents.

Codex lanes are always allowed to finish end to end (`docs/agent-workflow.md` §12). The Claude gate agents are off until the pre-1.0 audit; CI and Codex's review still gate every PR (`docs/agent-workflow.md` §5).

A milestone is a release: its title is the version, every issue carries it, and the tag with the same
name deploys production and creates the GitHub release. A lane owns only the paths its task names and
merges itself when the gates are green; nothing deploys on merge; anything labelled `needs-owner` waits
for the owner.

## Ad-hoc mode until v1.0.0

Decided 2026-10-15 to build faster before anyone uses the app (`docs/agent-workflow.md` §5):

- The owner, and an interactive Claude Code session running with the owner's `gh` credentials, may commit and push straight to `main`. The `main` ruleset keeps every rule for everyone else; only the Repository admin role bypasses it.
- Before any push, the local pre-push hook (`scripts/git-hooks/pre-push`, installed with `pnpm hooks:install`; needs gitleaks) runs the `ci.yml` gates: gitleaks on the pushed commits, typecheck, lint and unit tests on affected packages (including the dosing-vocabulary test), the docs checker tests and the Prisma schema check. About a minute. Never push to `main` with `--no-verify`.
- An ad-hoc commit still follows the conventions: conventional commit, DCO sign-off, tests next to code, docs updated in the same commit. The PR docs-declaration check does not run on a direct push, so check the docs list yourself. Codex review is optional for ad-hoc commits, required for lane PRs.
- The PR path stays for milestone lanes (`build-lanes`, implementer agents, `/land`), outside contributors, Dependabot and anything on the GitHub Actions token (`housekeeping.yml`, the triage agent).
- Nothing deploys from `main`. `release.yml` on a version tag is still the only path to production; the CI push job on `main` is the tripwire, and a red `main` is fixed forward within the hour or reverted.
- The mode ends at v1.0.0 with the pre-1.0 audit: the bypass is removed from the ruleset.

## Stack (decided)

pnpm monorepo: `web/` Next.js (App Router, TypeScript) on Azure Static Web Apps (Standard) · `poller/` Azure Function (Node 22, timer every 5 min) · `shared/` types and domain logic · `infra/` Bicep + GitHub Actions. Azure SQL **Basic** via Prisma. Azure Web PubSub for live push with an `events` table as source of truth. Key Vault + managed identity for all secrets. Blob Storage for photos. App Insights.

Azure: owner's Proxus subscription, **dedicated resource group `frejsi`** (West Europe), domain `frejsi.jepsen.ninja`. Nothing else goes in that resource group. The one exception to "everything in `frejsi`": the production database lives on an existing SQL server outside it (repository variable `SQL_SERVER_ID`), because Azure SQL is restricted in West Europe on the subscription (`infra/README.md`, "An existing SQL server"; issue #23).

## Hard rules

- **No insulin dosing anywhere.** No units, ratios, corrections or suggestions — not in code, not in AI output schemas, not in copy. A test asserts dosing vocabulary is absent from AI insight text.
- Anything from OFF, Frida, AI or free text is `verified: false` until a human ticks it. `simpleMode` shows verified foods only.
- A glucose value is never rendered without its age.
- `viewer` role never receives glucose data — enforce in the API, not the UI.
- Raw readings never go to an AI model; only computed statistics. Photos/text only on an explicit user action. Per-space daily cap on AI calls.
- No secrets in the repo; no real people in seed data or docs; no PII in logs.
- Glucose sources and food sources are plugins behind interfaces (`GlucoseSource`, `FoodSource`). Nothing Danish is hard-coded.
- Glucose sources are read-only: Frejsi never writes to a CGM or glucose service (no uploads, no follower or alert changes), even when the credential would allow it; the Dexcom adapter calls only allow-listed endpoints.
- Every write goes through `emit(spaceId, type, payload)` so it reaches the `events` table and Web PubSub.

## The owner's vault

Frejsi is the owner's personal project. Its note in the owner's SecondBrain vault is
`90-personal/projects/Frejsi.md`, on the personal side. Never create a work-side note (`10-projects/`),
never add it to the vault root's active-projects list, and never link it from a work-side note. A lane
that wants to log something appends one row to that personal note's `## Log` table, or leaves it to
the orchestrating session.

## Conventions

- TypeScript strict everywhere. Zod schemas in `shared/` are the contract between web, poller and AI output.
- Conventional commits, DCO sign-off (`git commit -s`).
- Tests next to code; fixtures for external APIs (Dexcom Share, OFF); AI evals under `evals/` run in CI.
- Update affected docs in the same PR as the code. Every PR has `## Docs`, listing doc paths its diff actually changes, or `None needed: <concrete reason>`; Dependabot is exempt. Docs are `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`, `docs/**` except `docs/design/**` and `docs/superpowers/plans/**`, `infra/README.md`, `poller/README.md` and `.env.example`. CI checks the declaration before installing dependencies; design exports and plans alone do not count.
- One PR per lane, and a lane is a vertical slice (adapter + poller + API + screen), not a layer. The gate agents read every line; the owner reads the PR summary and the gate reports. PR CI stays under five minutes; anything slower runs at release.
