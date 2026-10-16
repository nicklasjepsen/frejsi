# Contributing to Frejsi

Thank you. Frejsi is small and early; the best contributions right now are food-source plugins for your country, glucose-source adapters, translations, and corrections to the spec.

## Ground rules

- **Frejsi never calculates, suggests or displays insulin doses.** Pull requests that compute, suggest or display insulin units, ratios or corrections will be closed. This is a product boundary, not a technical limitation.
- Everything that enters the food library from an external source or AI is unverified until a human ticks it. Keep it that way.
- No real people, no real health data in fixtures, seeds, screenshots or docs.

### What is never accepted

Three things are closed without discussion, whoever sends them and however good the code is:

1. Anything that calculates, suggests or displays insulin: units, ratios, corrections, "typical" doses.
   It is not allowed in code, copy, prompts, schemas, fixtures or tests.
2. Data from an external source, an AI or free text marked `verified`. Only a person ticks that box.
3. Real people or real health data: a real glucose trace, a real name or address, a photo of a person,
   a secret or a credential, in the repository, a fixture, a screenshot or a log line.

## Developer Certificate of Origin

We use the [DCO](https://developercertificate.org/) instead of a CLA. Sign off every commit:

```
git commit -s -m "feat: add matvaretabellen food source"
```

## Add a source for your country

The most useful contributions are plugins, and each has a step-by-step guide with the files to create,
the lines to append, the fixtures to write and a pull request checklist:

- a food source (Open Food Facts for your country is already there; the roadmap names `usda`, `bls`
  and `matvaretabellen`): [docs/plugins/food-source.md](docs/plugins/food-source.md)
- a glucose source: [docs/plugins/glucose-source.md](docs/plugins/glucose-source.md)

[docs/architecture.md](docs/architecture.md) explains the packages and the hard rules a plugin keeps.
Open a task issue first, with the `plugin:food-source` or `plugin:glucose-source` label.

## Workflow

1. Open an issue first for anything bigger than a typo.
2. Branch from `main`, keep PRs small, add tests next to the code.
3. Conventional commit messages (`feat:`, `fix:`, `docs:` …).
4. English in code, comments, commits and docs. UI strings go through i18n (`da`, `en`).
5. Update affected docs in the same PR. Fill in `## Docs` with changed documentation paths, or `None needed: <concrete reason>`. CI rejects a missing/empty section or paths outside the PR's diff; Dependabot is exempt. See [the docs rule](docs/agent-workflow.md#13-docs-stay-current) for the files that count.

## How a pull request is reviewed

- **`.github/copilot-instructions.md` is the one set of review rules.** Codex, Copilot, Claude Code's
  gate agents and people all apply it: hard-rule violations and concrete bugs are blocking, style and
  "consider adding" are not reported.
- Agents do much of the building here. A lane owns a disjoint set of paths, so two pull requests do
  not edit the same file; if your change needs a file another open pull request owns, say so in the
  pull request and wait for it to merge.
- Today `ci` and Codex's GitHub review gate every pull request, and Codex reads every line. Claude
  Code's gate agents (a spec guardian, a reviewer and a copy reviewer) are off until the pre-1.0
  audit, when they run once over the whole codebase; they can still be asked for on a single pull
  request. The owner reads the summary. Answer each thread with the commit that fixes it or the
  reason it does not, and resolve it. See [the agent workflow](docs/agent-workflow.md).
- **`ci` (`.github/workflows/ci.yml`) is the only required check.** It is fast on purpose: typecheck,
  lint and unit tests on what changed. Slower suites run at release.
- Nothing deploys when a pull request merges. A version tag runs the release pipeline.

## Issues and labels

Use the issue templates: **Bug** (with a box for every hard rule it might touch) and **Task**
(spec section, change, the paths it owns, acceptance criteria). Labels you will meet:

- `plugin:food-source` and `plugin:glucose-source`: a new source for a country or a service.
- `area:web`, `area:poller`, `area:shared`, `area:ai`, `area:infra`, `area:docs`: where the change is.
- `good first issue`: small, well described, no hard rules involved.
- `needs-owner`: waits for a decision only the project owner can make (a product or clinical wording
  question, a paid account, a secret). Do not guess; comment on the issue.
- `security`: a possible vulnerability. Report it privately to the owner rather than in public.

## Local checks

Use Node 22 or newer and the pnpm version pinned in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r lint
pnpm test
```

`pnpm test` runs the root scripts' tests as well as all package unit tests. Unit tests use fictional fixtures and fakes; they need no database or Azure access. Database integration tests, browser flows and the production build run at release; local instructions are in [the operations runbook](docs/operations.md#run-the-release-suites-locally).

### The pre-push hook

`scripts/git-hooks/pre-push` runs the same checks as CI before a push leaves your machine: a gitleaks scan of the commits being pushed, then typecheck, lint and unit tests on the affected packages, the scripts' tests, the Prisma schema check when `shared/prisma` changed, and the dosing-vocabulary test. Docs-only changes skip the code checks, as in CI. Expect well under a minute for a small change.

Activate it once per clone:

```sh
pnpm hooks:install
```

It needs [gitleaks](https://github.com/gitleaks/gitleaks/releases) on your PATH and fails, rather than skipping the scan, when it is missing. `git push --no-verify` bypasses the hook; CI still runs on `main`.

## Licence

By contributing you agree your contribution is licensed under [AGPL-3.0](LICENSE).
