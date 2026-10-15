---
name: release
description: Release a finished Frejsi milestone to production: verify the milestone has no open issues and main is green, push the version tag, watch release.yml (full suite, infra, deploy, smoke, GitHub release, milestone closed), and report. Use when the owner says "release v0.2.0", "ship it to prod", "tag the release", or when ship-milestone reaches the end. Never deploys by any other path.
---

# release

Production is reached only by `release.yml` on a `v*` tag. This skill pushes the tag and watches.

1. **Verify.** From a clean checkout on `main`, `git fetch -q origin && git status`:
   - the milestone `<vX.Y.Z>` exists and has `open_issues == 0`
     (`gh api repos/nicklasjepsen/frejsi/milestones --jq '.[] | select(.title=="<vX.Y.Z>")'`);
     if issues are open, stop and list them: the milestone is not done, and a release never ships
     half a milestone.
   - no open PR carries the milestone (`gh pr list --state open --search "milestone:<vX.Y.Z>"`)
   - the latest `ci` run on `main` is green (`gh run list --workflow ci.yml --branch main --limit 1`)
   - the tag does not exist yet (`git tag -l <vX.Y.Z>`); if it does, the release already ran or
     failed: read its run before doing anything, and fix forward with the next patch version, never
     by moving the tag.
2. **Docs before tagging.** Read the README on `origin/main`: its status line must name `<vX.Y.Z>`
   and the features actually implemented for that release. Compare with the code and merged PRs,
   not just the plan. It may say the release is pending; never claim a successful deployment before
   the pipeline finishes. If stale, update it on a docs branch and land a PR through `/land` first,
   with the normal template and `## Docs` listing `README.md`. Respect an explicit release freeze;
   leave the concrete PR ready for the orchestrator instead of tagging through the freeze. After
   the docs PR merges, fetch again and repeat step 1, including green CI on the new tip. Never
   commit directly to `main` or tag before the docs correction merges.
3. **Tag** the tip of `origin/main`, annotated and signed off:
   `git tag -a <vX.Y.Z> origin/main -m "release: <vX.Y.Z>" && git push origin <vX.Y.Z>`.
4. **Watch** the run in the foreground, bounded:
   `gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status`
   (timeout 600000; if it is still running, poll `gh run view <id>` in an `until` loop with a
   15-second sleep). A job waiting on the `production-infra` environment is waiting for the owner's
   tap: say so and keep watching.
5. **On failure**: read the failed job's log (`gh run view <id> --log-failed`). A flaky external
   call (SQL resume, Azure throttling) gets one `gh run rerun <id> --failed`. A real defect is fixed
   on a branch, landed through the normal PR gates, and released as `<vX.Y.Z+1>` with the same
   milestone retitled, or a new patch milestone. The failed tag stays; no GitHub release exists for it,
   which is correct.
6. **Report**: tag, run URL, GitHub release URL, the version `/api/health` reported, and whether the
   milestone closed. Then log the release in the owner's vault note for the project, if this session
   has vault access.
