---
name: gate-pr
description: Review a Frejsi pull request with the three gate agents (spec-guardian for hard rules, reviewer for correctness, copy-reviewer for i18n and tone) and report only findings that survive a refutation attempt. Use when the owner says "review PR 42", "gate this PR", "is 42 ready to merge", or before opening a PR yourself. Pass --comment to post the result on the PR.
---

# gate-pr

```
Workflow({ name: 'review-pr', args: { pr: <number> } })
```

The workflow runs the three gates in parallel, then two refuters per non-hard-rule finding; a
finding is reported only if at most one refuter could knock it down. Hard-rule failures from the
guardian are reported as-is: refuting those is the owner's call.

Then:

1. Read each surviving finding against the diff yourself. Drop any you can show is wrong in one
   sentence; say that you dropped it.
2. Report, most severe first: file and line, what is wrong, the scenario. End with a one-line
   verdict: ready to merge, needs a fix round, or needs the owner (a hard-rule fail or a decision).
3. With `--comment`, post the same as one PR comment (`gh pr comment <n> --body-file`), never one
   comment per finding, and never a review approval: agents do not approve PRs here.
4. If CI is red or Codex left unresolved threads on the PR, say so in the verdict; those are gates
   too.
