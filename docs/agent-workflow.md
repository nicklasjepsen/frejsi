# How agents build and ship Frejsi

Frejsi is built by AI agent teams with one human owner. This document is the operating model: what each
agent does, what runs in parallel, which gates a change passes, how a milestone becomes a production
release, and what only the owner decides. Everything here is in the repository so any agent (Claude
Code, Codex, Copilot) and any contributor sees the same rules.

The project rules live in `CLAUDE.md` and the design spec in
`docs/superpowers/specs/2026-10-14-frejsi-design.md`. This file never restates them; it says who checks
them and when.

## 1. The unit of work is a milestone

A **milestone is a release**. Its title is the version (`v0.2.0`), every issue in it carries the
milestone, and when its last issue closes the agents tag `v0.2.0`, which deploys production and creates
the GitHub release. There is no other way to reach production: every production deploy is a GitHub
release, and every GitHub release is a milestone shipped.

```
plan ──▶ milestone vX.Y.Z ──▶ issues ──▶ lanes (PRs) ──▶ main ──▶ tag vX.Y.Z ──▶ production + GH release
owner     create-issues        task label   build-lanes      lane merges    release skill    release.yml
approves                       + milestone  4–6 in parallel  when green     by an agent      closes milestone
```

| Stage | Who | Output | Owner decides |
|---|---|---|---|
| Spec and UI design | owner + Claude, Claude Design | `docs/superpowers/specs/`, `docs/design/` | approves |
| Implementation plan | `writing-plans` skill | `docs/superpowers/plans/<date>-<topic>.md`, names its milestone | approves |
| Issues | `/create-issues` → `plan-to-issues` workflow | one issue per task, label `task`, milestone set | nothing |
| Lanes | `/start-milestone` → `ship-milestone` workflow | one PR per lane, merged by the lane when green | approves the lane split |
| Release | the same workflow, `/release` on its own | tag, production deploy, GitHub release, milestone closed | one tap for infra changes |

Version numbers: `v0.x.y` until the owner's family uses it daily, `v1.0.0` then. A milestone that adds
features bumps minor; a fix-forward after a failed release bumps patch. The app shows its version from
the tag (`NEXT_PUBLIC_APP_VERSION`), so there is no version-bump commit and no bump PR.

## 2. The agents

Custom subagents live in `.claude/agents/`. Claude Code resolves them by name, for the Agent tool and
for `agentType` in a workflow script.

| Agent | Writes code? | Job |
|---|---|---|
| `planner` | no | Reads an approved plan and emits the task list: one task per lane, with the paths it owns, acceptance criteria and the spec section it implements. |
| `implementer` | yes | Builds one lane TDD in its own worktree, opens the PR, addresses gate findings, and merges it when the gates are green. Never touches paths outside its lane. |
| `spec-guardian` | no | Checks a diff against the hard rules only. One verdict per rule with file and line. A fail is never overridden by another agent. |
| `reviewer` | no | Correctness review: bugs, missing edge cases, broken contracts between `web/`, `poller/` and `shared/`, concurrency in the poller and live feed. |
| `copy-reviewer` | no | UI strings: both `da` and `en`, kind-nurse tone, no dosing vocabulary, glucose never without age, AI output labelled approx. |

Three narrow reviewers in parallel beat one broad one: each is an independent perspective on the same
diff, and the one that matters most here (the guardian) cannot be distracted by style.

## 3. Lanes are vertical slices, not small PRs

Learned on Scarecrow: twenty small PRs, each waiting 15–25 minutes for a preview deploy and an
end-to-end suite, then queueing one at a time behind a 12–57 minute test deploy per merge, with
"branches must be up to date" invalidating every other PR's checks on each merge. The lanes spent more
time in the queue than in the editor.

Frejsi does the opposite:

- **A lane is a vertical slice** of the milestone: adapter + poller + API + the UI that shows it, or
  the whole invite flow. Four to six lanes per milestone, each one PR of a few hundred to a couple of
  thousand lines. Fewer, larger PRs; the gate agents read every line so the owner does not have to.
- **Each lane names the paths it owns.** Two lanes never own the same directory. Shared append-only
  files any lane may touch: `pnpm-workspace.yaml`, `shared/src/index.ts` (exports),
  `web/messages/da/index.ts` and `web/messages/en/index.ts` (one import and one key per namespace,
  alphabetical), `infra/main.bicep` (module list). Append only; never reorder. This is what makes
  parallel lanes merge without conflicts.
- **UI strings live in one file per top-level namespace and locale**:
  `web/messages/da/<namespace>.json` and `web/messages/en/<namespace>.json`. A new screen adds its
  own namespace file in both locales (and its line in each `index.ts`) instead of appending to a
  shared file; a lane edits an existing namespace file only when it owns that screen.
- **Prisma migrations** are numbered in lane order; a lane renumbers to after `origin/main`'s highest
  before it merges.
- **A lane merges itself** when CI is green, the guardian passes, reviewer and copy findings are
  addressed or answered, and Codex's PR threads are resolved. Rebase merge, so DCO sign-offs survive.
  Nobody waits for the owner.
- A lane that cannot finish (a decision the spec does not make, a path another lane owns, an Azure
  resource or secret it lacks) opens its PR as a draft, labels it `needs-owner`, and stops.

Worktrees live under `~/dev/frejsi-lanes/<branch slug>`. Branch names: `<type>/gh-<n>-<slug>`.

## 4. CI that never queues

The rules that keep merges flowing, in order of importance:

1. **PR CI is fast or it is not PR CI.** `ci.yml` runs typecheck, lint, unit tests and the dosing
   vocabulary test, on the affected packages only, with a hard 10-minute timeout and a 5-minute target.
   No deploy, no database, no browser, no Azure login. Anything slower belongs in the release pipeline.
2. **Merging to main deploys nothing.** Main runs the same fast suite after a merge, as a tripwire.
   There is no test environment that every merge has to pass through, so there is nothing to serialize
   and no merge lock.
3. **No "branches must be up to date", no merge queue.** Lanes own disjoint paths, so a PR green
   against yesterday's main is green against today's. If a merge does break main, the last lane to
   merge fixes forward within the hour, or reverts its merge; `ship-milestone` watches for this.
4. **The slow suite runs once per release.** Prisma integration tests against a SQL Server container,
   Playwright on the `simpleMode` flows, the full AI evals, the production build. Fifteen
   to twenty minutes, once per milestone instead of once per PR.
5. **AI evals in PR CI only when prompts change** (path filter on `evals/` and prompt files); otherwise
   they run at release.
6. **Preview environments are opt-in.** Add the label `preview` to a PR and `preview.yml` (added by the
   infra scaffold task) deploys it to a Static Web App preview so the owner can look at a screen on a
   phone. Never required, never blocking.

Branch protection on `main` (live since 2026-10-14): pull request required, required check `ci`,
conversations resolved, no required reviewers, no up-to-date requirement, linear history, no force
pushes, auto-merge enabled, branches deleted on merge, rebase the only merge method.

## 5. Gates on every PR

> **Until v1.0.0 the Claude gate agents (items 2 and 3) are off** (owner, 2026-10-15): building fast
> matters more than per-PR rule review while nobody uses the app. CI, including the dosing-vocabulary
> test, and Codex's GitHub review still gate every PR. Before v1.0.0 is tagged, `spec-guardian`,
> `reviewer` and `copy-reviewer` run once over the whole codebase (the audit issue in milestone
> v1.0.0), and every finding is fixed or explicitly accepted. `build-lanes` runs them only with
> `{ gates: true }`; `/gate-pr` still works on any single PR on request.

1. **CI** (`ci.yml`): the fast suite.
2. **`spec-guardian`**: the hard rules. A red here is never overridden.
3. **`reviewer`** and **`copy-reviewer`**: findings go back to the implementer for one fix round, then
   the guardian checks again. A lane still red after one round is labelled `needs-owner`; there is no
   second automatic round.
4. **Codex review** (`codex review --base main`, per the owner's global instructions) before the PR is
   opened, and Codex's PR comments after. One set of review rules for every reviewer:
   `.github/copilot-instructions.md`.

`/gate-pr` runs gates 2 and 3 on any PR and refutes each finding twice before reporting it.

## 6. Release

`release.yml` runs on a pushed `v*` tag and nowhere else:

1. **Verify**: the tag names an existing milestone with zero open issues, and `main` is green.
2. **Full suite**: unit, Prisma integration against SQL Server, Playwright, evals, production build with
   `NEXT_PUBLIC_APP_VERSION=<tag>`.
3. **Infra** (`production-infra` environment): deploy `infra/main.bicep`. This environment has the
   owner as required reviewer: one tap approves cost-bearing changes. A release that changes no infra
   passes through without the tap. There is no what-if step: the Bicep diff in the PR is the review,
   and a what-if printed into a log nobody reads before the deploy gates nothing.
4. **Deploy** (`production` environment, no reviewer): poller package to the Function App, web build to
   the Static Web App, migrations with Prisma.
5. **Smoke**: `/api/health` on `frejsi.jepsen.ninja` reports the deployed version and a fresh reading.
6. **GitHub release** created only now, with notes generated from the milestone's closed issues and
   merged PRs. Then the milestone is closed.

A failed release creates no GitHub release and leaves the tag. The agent fixes forward and tags the
next patch; tags are never deleted or moved. Rollback is a redeploy of the previous release's tag via
`workflow_dispatch` on `release.yml`.

The `/release` skill is the agent-side procedure: verify, tag, watch the run, report. `ship-milestone`
calls it once all lanes are merged.

## 7. What the owner does

Two decisions per milestone, both one tap from a phone:

- **The lane split**, shown by `/start-milestone` before any worktree exists.
- **Infra changes at release**, via the `production-infra` environment approval. Releases without
  infra changes do not ask.

And whenever an agent raises `needs-owner`: a product or clinical wording decision, a cost-bearing
Azure change, a hard-rule fail the agent could not fix, a release that failed twice.

The owner reads PR summaries and gate reports, not every line. The gate agents and Codex read every
line.

## 8. Running it

```
# Plan approved → issues on the board, all carrying milestone v0.2.0
/create-issues docs/superpowers/plans/2026-10-20-glucose-live.md v0.2.0

# Lanes → PRs → merged → tagged → production → GitHub release
/start-milestone v0.2.0

# Only the gates, on any PR
/gate-pr 42

# Only the release, when the milestone is already merged
/release v0.2.0

# Land the current branch the right way (checks, sign-off, Codex, PR)
/land
```

The skills under `.claude/skills/` are the procedures; the workflow scripts under `.claude/workflows/`
(`plan-to-issues`, `build-lanes`, `ship-milestone`, `review-pr`, `housekeeping-sweep`) are what they run. A skill never
creates worktrees, issues, tags or PRs before showing the plan and getting an OK.

## 9. What agents must never do

- Force-push, delete or move a tag, or delete a branch they did not create.
- Merge a PR with a red required check or a guardian fail, or merge with `--admin`.
- Deploy production by any path other than `release.yml` on a tag. Never `az` from a session.
- Create Azure resources outside `infra/`. Infra is Bicep in a PR; the release pipeline applies it.
- Put secrets, real people or real health data anywhere in the repo, fixtures or logs.
- Add anything that computes, suggests or displays insulin. The test fails; the guardian fails; the
  PR is closed.
- Widen a lane. If the task is wrong, open an issue labelled `needs-owner` and say why.

## 10. Triage and housekeeping, in the background

Not part of PR CI. `housekeeping.yml` runs on GitHub Actions twice a day and on demand, with Claude
Code headless following the `housekeeping` skill. There is no run-on-issue-opened trigger: the action
refuses runs triggered by users without write access unless a setting the docs mark as risky is on,
and twelve hours is soon enough for triage.

- **Triage** every untouched issue or PR with the `triage` agent: classify, label by area, spot
  duplicates, route a reproducible bug to the next open milestone, mark product decisions and
  anything touching a hard rule as `needs-owner`, answer a question from the docs. One comment at
  most, never a close. A security report is labelled `security` and never discussed in public.
- **Dependabot**: minor and patch bumps merge on green; majors wait for the owner.
- **Stale PRs** get the label and one comment after 14 idle days; the owner closes.
- **Branches** are deleted only when every commit is already on `main` and no open PR uses them.
- **Milestones**: issues closed by a merged PR get the milestone of the release that shipped them, so
  release notes are right; open issues left in a closed milestone move to the next open one.
- **One pinned issue, "Waiting on the owner"**, is rewritten each run with everything labelled
  `needs-owner` or `security` and any failed release. That issue is the owner's inbox.

Lane PRs and lane branches are never touched by housekeeping; the lane or `/start-milestone` owns
them. The same procedure runs in an interactive session as the `housekeeping-sweep` workflow, with the
sweeps in parallel.

## 11. Working on GitHub: what the first days taught

Facts an agent needs that the docs of the tools do not say:

- **`gh pr checks <n> --watch` right after `gh pr create`** can exit at once with "no checks
  reported" before the `ci` check registers, and a merge chained after it is refused by branch
  protection. Poll `gh pr checks <n> --json name,state` until `ci` is `SUCCESS`, then merge.
- **The Claude Code GitHub action runs only the workflow file that is on `main`.** A run triggered
  from a branch (`gh workflow run ... --ref <branch>`) is skipped with "workflow validation failed"
  and reports success in two seconds. A change to `housekeeping.yml` must merge before it can be
  tested; test with `gh workflow run housekeeping.yml --ref main`.
- **A housekeeping run that ends after one turn at zero cost with `is_error: true`** is an API-level
  failure (auth, model, request), not a skill problem. The error text is in the run log because
  `show_full_output` is on; `terminal_reason` and `api_error_status` name it.
- **Agent types added to `.claude/agents/` after a session started are not in that session's
  registry**: the Agent tool and a workflow's `agentType` answer "agent type 'implementer' not
  found" until a new session. The workflow scripts therefore go through `callAgent`, which tries the
  project type and falls back to a general-purpose agent told to read and follow the role's file.
  The Workflow tool itself is only available in the main session; a subagent that needs a gate review
  spawns a general-purpose agent pointed at the agent file.
- **The housekeeping run log is public.** Agents in it refer to issues by number and title only.
- **Environments** `production-infra` (owner as required reviewer) and `production` accept
  deployments only from `v*` tags. Secrets present: `CLAUDE_CODE_OAUTH_TOKEN`, `CI_SQL_SA_PASSWORD`,
  `ALERT_EMAIL` (a secret, not a variable: variables print unmasked in these public logs). Variables
  present: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `SQL_SERVER_ID` (issue #23).
  Still to add: `ANTHROPIC_API_KEY_EVALS` (v0.4.0), `CUSTOM_DOMAIN` after the first release.
  Previews are off: `PREVIEWS_ENABLED` is unset and there is no `preview` federated credential
  (owner, 2026-10-15), so the `preview` label does nothing yet.
- **The repository uses GitHub's immutable OIDC subject**
  (`repo:nicklasjepsen@2478876/frejsi@1419802630:environment:<name>`). A new environment that needs
  Azure gets a federated credential with that form; the plain `repo:nicklasjepsen/frejsi:...` form
  alone does not match.

## 12. Codex lanes

The owner's Codex subscription builds lanes alongside Claude (owner, 2026-10-15). A Codex lane is
always allowed to finish: it runs `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high
--dangerously-bypass-approvals-and-sandbox -C <worktree>` in its own worktree under
`~/dev/frejsi-lanes/`, commits with sign-off, pushes, opens the PR, and rebase-merges on green `ci`
with every Codex review thread resolved, exactly like a Claude lane. Never stop a Codex lane halfway
to ask; questions go in its PR body.

- Give it the issue's owned paths **plus the adjacent files its tests need** (package exports and
  scripts, fixtures, the shared test files, `infra/main.bicep` wiring), touched minimally. Codex
  follows an owned-paths list literally; the first two Codex runs stopped short because the list was
  too narrow.
- Do not run it in the `workspace-write` sandbox: that makes a worktree's git metadata read-only and
  nothing gets committed.
- Wait on it by pid (`while kill -0 <pid>`), not `pgrep -f "codex exec"`, which matches the waiting
  shell itself.
- `gpt-6-astra` is for a lane that has failed twice.

## 13. Docs stay current

Every lane updates affected docs in the same PR as the code. Describe what is implemented, using
fictional examples; plans are not evidence that a feature exists. Every PR declares `## Docs` with
paths its diff actually changes, or `None needed: <concrete reason>` when no docs need changing.
Dependabot PRs are exempt. `scripts/check-docs.mjs` reads the PR event and its git diff without
dependencies or network calls; the `ci` job runs it before installing packages, and rechecks body edits.

Docs that count: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`, `docs/**` except
`docs/design/**` and `docs/superpowers/plans/**`, `infra/README.md`, `poller/README.md`, `.env.example`.
Design exports and implementation plans alone do not count. The implementer and `/land` check the
same rule; the PR template shows how to declare it. Run `pnpm test:scripts` for the checker's tests.

On Mondays, `/housekeeping` compares the README, CLAUDE.md's "Where things stand" and the operations,
infra and poller runbooks against `main` and the latest published release. It opens at most one
`docs: drift <date>` PR for stale facts. Before tagging, `/release` checks that the README status names
the version being cut and its implemented features; any correction lands in a PR first.
