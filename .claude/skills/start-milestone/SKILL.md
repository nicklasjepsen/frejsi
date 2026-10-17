---
name: start-milestone
description: Start a Frejsi milestone release and take it to production: list what the milestone still owes, propose 4–6 vertical-slice lanes, get an OK, create a worktree per lane, then run the ship-milestone workflow (build, gate, merge, tag, deploy, GitHub release). Use when the owner says "start v0.2.0", "ship the milestone", "start the rest of v0.3.0", "what of v0.2.0 is still free". Not for one issue in the current session: that is ordinary work under CLAUDE.md.
---

# start-milestone

A milestone is a release. This skill starts its remaining work as parallel lanes and, when they are
all merged, releases it. Nothing is created before the owner says OK to the split.

Run from the repository root of a clean checkout on `main`, in the main session: the Workflow tool is not
available inside a subagent (`docs/agent-workflow.md` §11).

## 1. See what the milestone owes

```
git fetch -q origin
gh api repos/nicklasjepsen/frejsi/milestones --jq '.[] | "\(.number) \(.title) open=\(.open_issues) closed=\(.closed_issues)"'
gh issue list --milestone "<vX.Y.Z>" --state open --json number,title,labels,body
gh pr list --state open --json number,title,headRefName,isDraft,labels
git branch -r | grep gh-
ls ~/dev/frejsi-lanes 2>/dev/null
```

The milestone title is the version and must look like `vX.Y.Z`; stop if it does not. If the milestone
does not exist, the plan has not gone through `/create-issues`; do that first.

Classify each open issue:

- **in flight**: an open PR or a branch `*/gh-<n>-*` exists for it. Read the branch's last commits
  before calling a plannable issue free; a branch named for one issue often carries a second.
- **gated**: carries `needs-owner`. The owner decides it; never a lane.
- **blocked**: its "Depends on" names an issue that is not closed.
- **plannable**: everything else.

If every issue is closed and nothing is in flight, skip to step 4 (`/release`).

## 2. Propose the lanes

Read each plannable issue's "Owns" and "Depends on". Then group into **vertical slices**: a lane is
the adapter, the poller change, the API route and the screen that shows it, not one layer of it. One
or two issues per lane, grouped by file ownership, never by theme alone.

- Two lanes never own the same directory. Shared append-only files (`docs/agent-workflow.md` §3) do
  not count.
- `migration`: the next Prisma migration number for the first lane labelled `schema`, the next after
  that for the second, `null` otherwise.
- Four to six lanes. Fewer, larger PRs: the gate agents read every line.
- `model`: leave it out. The implementer runs on Opus by default (`docs/agent-workflow.md` §2); set
  `"model": "fable"` only on a lane that rewrites the Prisma schema or touches the hard rules across
  several packages, and say why in the board. A top-level `"models": { "<role>": "<model>" }` changes
  a role for the whole run.

Write the split to the scratchpad as the workflow's `args`:

```json
{
  "milestone": "v0.2.0",
  "base": "main",
  "lanes": [
    {
      "name": "dexcom-live",
      "issues": [12, 13],
      "branch": "feat/gh-12-dexcom-live",
      "worktree": "/home/nick/dev/frejsi-lanes/gh-12-dexcom-live",
      "owns": ["shared/src/glucose/dexcom-share/", "poller/src/", "web/app/api/spaces/[id]/readings/", "fixtures/dexcom/"],
      "shared": ["shared/src/index.ts", "web/messages/da/index.ts", "web/messages/en/index.ts"],
      "migration": "0003",
      "notes": "Fixtures are recorded JSON; never a live call in tests.",
      "model": "fable"
    }
  ]
}
```

Show the board: lane, issues, branch, owns, migration, model (Opus unless the lane sets one); above it
the in-flight, gated and blocked lists. Ask for an OK with one question. Change the file and show again on any objection.

## 3. Create the worktrees and ship

For each lane, from the repository root:

```
git worktree add "<worktree>" -b "<branch>" origin/main
```

Make sure every issue in the split carries the milestone (`gh issue edit <n> --milestone "<vX.Y.Z>"`),
then:

```
Workflow({ name: 'ship-milestone', args: <the split> })
```

The workflow builds each lane (TDD, PR), gates it (guardian, reviewer, copy), runs one fix round,
lets the lane merge itself when green, watches `main`'s CI after each merge, and when every lane is
merged and the milestone has no open issues, runs the release (tag, `release.yml`, GitHub release).
It returns a board per lane and the release result.

On the claude-agents VM, a lane that should outlive this session can instead be an
`rc-session launch "frejsi-<slug>" "<worktree>" --prompt-file <brief>` with the implementer brief
as the prompt; run `/release` by hand once its PR is merged.

## 4. Report

One message: the board with PR links and final state per lane; the gated and blocked issues left
out; the release result (tag, run URL, GitHub release URL) or why it did not release; and what the
owner has to do, which is usually nothing or one `production-infra` approval. Remove merged lanes'
worktrees (`git worktree remove <worktree>`); each one holds disk and, on the VM, memory.
