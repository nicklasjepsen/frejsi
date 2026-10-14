# Frejsi — instructions for Claude

**All communication in this repo is in English** — prompts, commits, code, comments, docs, issues. The product UI is Danish-first (`da`) with English (`en`); that is the only place Danish appears.

## What this is

An open-source (AGPL-3.0) web app for one person with diabetes and the people around them: carb lookup (Danish products, barcodes, own dishes), a child-friendly `simpleMode`, and meals shown on the live glucose curve. **Mobile and desktop are both first-class** — installable PWA on phones for logging in the moment, a full desktop layout for review and admin; one responsive codebase, layouts designed per breakpoint. **It never computes or suggests insulin.**

## Where things stand

- `docs/superpowers/specs/2026-10-14-frejsi-design.md` — the design spec. Sections 1–5 are approved by the owner; 6–9 are not designed yet. **Read it before doing anything.**
- `docs/ui-brief.md` — brief for the UI design pass in Claude Design, which happens **before** implementation.
- No code exists yet. No Azure resources exist yet. The agent operating model, the GitHub pipeline (`ci`, `release`, `housekeeping`), branch protection on `main` and the two deployment environments are live; see `docs/agent-workflow.md` §4 and §11.

## Planned sequence

1. **UI design in Claude Design** from `docs/ui-brief.md`. Output goes into `docs/design/` (exports, tokens, component list).
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

A milestone is a release: its title is the version, every issue carries it, and the tag with the same
name deploys production and creates the GitHub release. A lane owns only the paths its task names and
merges itself when the gates are green; nothing deploys on merge; anything labelled `needs-owner` waits
for the owner.

## Stack (decided)

pnpm monorepo: `web/` Next.js (App Router, TypeScript) on Azure Static Web Apps (Standard) · `poller/` Azure Function (Node 22, timer every 5 min) · `shared/` types and domain logic · `infra/` Bicep + GitHub Actions. Azure SQL **Basic** via Prisma. Azure Web PubSub for live push with an `events` table as source of truth. Key Vault + managed identity for all secrets. Blob Storage for photos. App Insights.

Azure: owner's Proxus subscription, **dedicated resource group `frejsi`** (West Europe), domain `frejsi.jepsen.ninja`. Nothing else goes in that resource group.

## Hard rules

- **No insulin dosing anywhere.** No units, ratios, corrections or suggestions — not in code, not in AI output schemas, not in copy. A test asserts dosing vocabulary is absent from AI insight text.
- Anything from OFF, Frida, AI or free text is `verified: false` until a human ticks it. `simpleMode` shows verified foods only.
- A glucose value is never rendered without its age.
- `viewer` role never receives glucose data — enforce in the API, not the UI.
- Raw readings never go to an AI model; only computed statistics. Photos/text only on an explicit user action. Per-space daily cap on AI calls.
- No secrets in the repo; no real people in seed data or docs; no PII in logs.
- Glucose sources and food sources are plugins behind interfaces (`GlucoseSource`, `FoodSource`). Nothing Danish is hard-coded.
- Every write goes through `emit(spaceId, type, payload)` so it reaches the `events` table and Web PubSub.

## Conventions

- TypeScript strict everywhere. Zod schemas in `shared/` are the contract between web, poller and AI output.
- Conventional commits, DCO sign-off (`git commit -s`).
- Tests next to code; fixtures for external APIs (Dexcom Share, OFF); AI evals under `evals/` run in CI.
- One PR per lane, and a lane is a vertical slice (adapter + poller + API + screen), not a layer. The gate agents read every line; the owner reads the PR summary and the gate reports. PR CI stays under five minutes; anything slower runs at release.
