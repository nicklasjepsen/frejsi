---
name: housekeeping
description: Background triage and cleanup for Frejsi, run daily by the housekeeping GitHub Actions workflow (not part of PR CI) and on demand. Triages untouched issues and PRs with the triage agent, merges green Dependabot minors, marks stale PRs, deletes fully merged branches, fixes milestone hygiene, and keeps one "Waiting on the owner" issue current. Use when the owner says "run housekeeping", "triage the backlog", "clean up branches", "what's waiting on me". Never closes an issue a person opened; never merges a lane PR.
---

# housekeeping

The procedure is written so one headless session can run it top to bottom with `gh` and no
questions. In an interactive session the `housekeeping-sweep` workflow (`.claude/workflows/housekeeping-sweep.js`)
runs the same steps with the sweeps in parallel; use it when the Workflow tool is available, otherwise
follow the steps below. Today's date comes from the prompt (unattended) or from `date -I`.

Repo: `nicklasjepsen/frejsi`. Markers: a comment this procedure writes starts with an HTML comment
(`<!-- frejsi-triage -->`, `<!-- frejsi-stale -->`, `<!-- frejsi-milestone -->`) so a later run sees it
and never comments twice.

## 1. Triage

List open issues and PRs with neither `triaged` nor `task`, author not Dependabot, and for PRs a head
branch not matching `*/gh-<n>-*` (lanes are never touched):

```
gh issue list --state open --limit 200 --json number,labels,author
gh pr list --state open --limit 100 --json number,labels,author,headRefName
```

For each number, run the `triage` subagent (Agent tool, `subagent_type: triage`) with
"Triage #<n>. Today is <date>." If subagents are unavailable, apply `.claude/agents/triage.md` yourself,
one number at a time, with its limits.

## 2. Dependabot

`gh pr list --author app/dependabot --state open --json number,title,statusCheckRollup,mergeable`.
A minor or patch bump with every check green and `mergeable`: `gh pr merge <n> --rebase --auto`.
Never `--admin`. A major bump: label `needs-owner`. A red check: leave it, note it.

## 3. Stale pull requests

`gh pr list --state open --json number,title,updatedAt,isDraft,labels,headRefName`. Skip lanes.
Not updated for 14 days and not labelled `stale`: add `stale` and one comment
(`<!-- frejsi-stale -->`) saying the owner will close it if nothing happens in 7 days. Never close.
Labelled `stale` but updated since: remove the label.

## 4. Branches

```
git fetch -p -q origin
git branch -r --format '%(refname:short)' | grep -v -e 'origin/main$' -e HEAD
```

For each: if `git merge-base --is-ancestor <branch> origin/main` succeeds and
`gh pr list --head <name> --state open` is empty, `git push origin --delete <name>`. A branch with
commits not on `main` is never deleted; report it with its last commit date and whether a PR exists.
(Worktrees on the owner's VM are not this procedure's business; `/start-milestone` removes merged
ones.)

## 5. Milestones

`gh api repos/nicklasjepsen/frejsi/milestones?state=all --paginate` and `git fetch -q --tags origin`.

- An open issue in a closed milestone: move it to the lowest open `vX.Y.Z` milestone and comment
  once (`<!-- frejsi-milestone -->`, moved from the old one because it was released without this);
  no open milestone: label `needs-owner` instead.
- A closed issue with no milestone that a merged PR closed
  (`gh issue view <n> --json closedByPullRequestsReferences`): find the merge commit,
  `git tag --contains <sha> | sort -V | head -1`; if that tag names a milestone, set it, so release
  notes are right. No tag yet: the lowest open milestone.
- An open PR whose linked issue has a milestone but the PR has none: set the same milestone.

## 6. Waiting on the owner

Collect: open issues and PRs labelled `needs-owner` or `security` (number, title, days idle), and the
latest `release.yml` run if it failed (`gh run list --workflow release.yml --limit 1 --json conclusion,url,displayTitle`).

Keep exactly one issue titled `Waiting on the owner` (label `needs-owner`, pinned). Find it with
`gh issue list --search "Waiting on the owner in:title" --state open --json number`; create it if
missing (`gh issue create --title "Waiting on the owner" --label needs-owner --body-file ...` then
`gh issue pin <n>`). Replace its body with today's list, one line per item, newest first, and the
date. An empty list is written as "Nothing. <date>". Never comment on it; the body is the state.

Security items appear on that list by number and title only; the report is never quoted.

## 7. Report

Write the run summary to `$GITHUB_STEP_SUMMARY` when it exists (triage lines, actions, the owner list),
otherwise print it. Nothing happened is one line.

## Limits

- Triage labels and comments once; it never closes, assigns, edits or retitles. The owner closes.
- Lane PRs and lane branches (`*/gh-<n>-*` with an open PR) are never touched.
- No deletes except branches whose every commit is on `main`. No force, no `--admin`, no `az`.
- Unattended: nobody answers questions. When unsure, label `needs-owner` and move on.
