# Contributing to Frejsi

Thank you. Frejsi is small and early; the best contributions right now are food-source plugins for your country, glucose-source adapters, translations, and corrections to the spec.

## Ground rules

- **No insulin dosing features.** Pull requests that compute, suggest or display insulin units, ratios or corrections will be closed. This is a product boundary, not a technical limitation.
- Everything that enters the food library from an external source or AI is unverified until a human ticks it. Keep it that way.
- No real people, no real health data in fixtures, seeds, screenshots or docs.

## Developer Certificate of Origin

We use the [DCO](https://developercertificate.org/) instead of a CLA. Sign off every commit:

```
git commit -s -m "feat: add matvaretabellen food source"
```

## Workflow

1. Open an issue first for anything bigger than a typo.
2. Branch from `main`, keep PRs small, add tests next to the code.
3. Conventional commit messages (`feat:`, `fix:`, `docs:` …).
4. English in code, comments, commits and docs. UI strings go through i18n (`da`, `en`).
5. Update affected docs in the same PR. Fill in `## Docs` with changed documentation paths, or `None needed: <concrete reason>`. CI rejects a missing/empty section or paths outside the PR's diff; Dependabot is exempt. See [the docs rule](docs/agent-workflow.md#13-docs-stay-current) for the files that count.

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
