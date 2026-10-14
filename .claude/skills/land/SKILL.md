---
name: land
description: Land the current Frejsi branch as a pull request the right way: full checks, signed-off conventional commits, Codex review, PR from the template, CI watched. Use when the owner says "land this", "open the PR", "ship it", or when an implementer reaches the end of its task. Never merges.
---

# land

1. **Branch.** You are not on `main` (`git branch --show-current`). If you are, create
   `<type>/gh-<n>-<slug>` first and move the changes there.
2. **Checks.** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Red is yours to fix; never
   `.skip`, never `--no-verify`. If `evals/` exists and the change touches prompts or AI schemas,
   run the evals too.
3. **Commits.** Small, conventional, signed off: `git commit -s -m "feat(poller): ..."`. English.
   The body says why. Add the attribution lines the session was given, if any.
4. **Codex review** (only where the Codex CLI is installed and signed in):
   `codex review --base main` from the repo root, timeout 600000. Check every finding against the
   code; fix the real ones; list the ones you decline, with reasons, for the PR body. Re-run at most
   once. If it answers "at capacity", wait a minute and run again; that was not a review.
5. **Push and open the PR** with the template (`.github/pull_request_template.md`): what and why,
   `Closes #<n>`, the hard-rules checklist ticked honestly, declined Codex findings listed. Draft
   plus label `needs-owner` if anything is left for the owner to decide.
6. **Watch CI.** Right after `gh pr create`, `gh pr checks <n> --watch` can exit at once with "no
   checks reported" before the check registers, so poll instead:
   `until [ "$(gh pr checks <n> --json name,state -q '.[] | select(.name=="ci") | .state')" = SUCCESS ]; do sleep 10; done`
   (bounded, in the foreground; a FAILURE is yours to fix). Codex reviews PRs on GitHub too: reply in
   each thread with the fix commit or the reason, then resolve it; branch protection requires every
   thread resolved.
7. **Merge, if this is a lane and the gates are green**: `gh pr merge <n> --rebase --delete-branch`.
   Never `--admin`; a refusal means a check or a thread is still open, so wait for it. Then watch
   `main`'s `ci` run. A PR that is not a lane (docs, config, a fix the owner asked for) merges the
   same way once `ci` is green. Report the PR URL, what is in it, which acceptance criteria have
   tests, and what is left for the owner.
