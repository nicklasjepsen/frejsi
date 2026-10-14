---
name: create-issues
description: Turn an approved Frejsi implementation plan (docs/superpowers/plans/*.md) into GitHub issues, one per task, every one carrying the release milestone (vX.Y.Z, created if missing), with owned paths and acceptance criteria. Use when the owner says "create the issues for <plan>", "break the plan into issues", "put v0.2.0 on the board". Not for a single ad-hoc issue; write that with gh issue create --milestone.
---

# create-issues

A plan becomes a board of tasks that lanes can pick up. The `plan-to-issues` workflow does the
reading, the checking and the creating; this skill (`create-issues`) is the procedure around it.

1. **Confirm the plan is approved.** The plan file says so in its status line, or the owner said it in
   this conversation. An unapproved plan does not go on the board.
2. **Know the milestone.** The plan names its release (`vX.Y.Z`); if it does not, ask the owner for
   the version with one question. The milestone is the release: the tag with the same name deploys it.
3. **Run the workflow** with the plan path and the milestone:

   ```
   Workflow({ name: 'plan-to-issues', args: { plan: '<path>', milestone: 'v0.2.0' } })
   ```

   It fans out: `planner` emits the tasks, two critics check path collisions and spec coverage, and
   only if both are clean does it create one issue per task (duplicates by title are skipped).
4. **If the critics found problems**, the workflow returns them and creates nothing. Fix the plan
   (or the task split) with the owner and rerun. Do not create issues around a problem.
5. **Rewrite dependencies.** The issues' "Depends on" lines carry task numbers. Map them to the
   created issue numbers and edit each body (`gh issue edit <n> --body-file`).
6. **Report** the board: one line per issue with number, title, area, owns, and `needs-owner` where
   the task is a decision. Link the plan and the milestone.

Nothing in this skill creates worktrees or starts lanes; that is `/start-milestone`.
