#!/usr/bin/env bash
# Start one Codex lane end to end (docs/agent-workflow.md §12): worktree from origin/main, a brief,
# and `codex exec` unsandboxed in the background. Codex builds, commits, pushes, opens the PR and
# merges on green ci with every Codex thread resolved. Wait on it by pid from "$S/running"
# (`while kill -0 <pid>`), never `pgrep -f "codex exec"`, which matches the waiting shell itself.
#
# Environment: MS (milestone, default v0.2.0 — always pass it), PLAN (plan file for "task N"),
# CODEX_LANE_DIR (briefs, logs and final reports; default ~/.cache/frejsi-codex-lanes).
# Local SQL Server for release suites: container frejsi-sql on localhost:14330, sa password in
# ~/.config/frejsi/local-sql-sa (mode 600); never print or commit it.
# usage: lane.sh <issue> <slug> <plan-task-no> <area> "<owns>" "<adjacent allowed>" "<extra notes>"
set -e
S=${CODEX_LANE_DIR:-$HOME/.cache/frejsi-codex-lanes}
mkdir -p "$S"
N=$1; SLUG=$2; T=$3; AREA=$4; OWNS=$5; ADJ=$6; NOTES=$7
B=feat/gh-$N-$SLUG; W=${LANES_DIR:-$HOME/dev/frejsi-lanes}/gh-$N-$SLUG
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$REPO" && git fetch -q origin && git worktree add -q $W -b $B origin/main
cat > $S/brief-$N.md <<BRIEF
You are building one lane of Frejsi, an open-source diabetes carb-and-glucose web app (pnpm monorepo: web/ Next.js, poller/ Azure Function, shared/, infra/ Bicep), end to end: build, commit, push, PR, merge. The owner is not available; ask nothing. Small choices the spec leaves open: decide, and list them in the PR body under "For the owner" with the assumption you took. A genuine product, clinical-wording or cost decision that only the owner can make: build what does not depend on it, open the PR as a draft with the label needs-owner and the question in the body, and do NOT merge; that is how this lane finishes.

Lane: issue #$N (milestone ${MS:-v0.2.0}). Worktree: $W, branch $B, already created from origin/main. Read first: AGENTS.md, CLAUDE.md (hard rules: never violate them), docs/agent-workflow.md §3 and §12, \`gh issue view $N\`, the plan ${PLAN:-docs/superpowers/plans/2026-10-15-v0.2.0-food.md} task $T and the sections it cites, and the code on main you build on. UI work follows docs/design/ (README.md, tokens.json, artboards).

You own: $OWNS
You may also change, minimally, what the work needs next to it: $ADJ. Touch nothing else; never weaken an existing test.
$NOTES

TDD per acceptance criterion: failing test next to the code, code, refactor. External APIs never in tests: recorded fixtures under fixtures/ or a fake behind the interface. Fictional data only.
Before every commit: ~/.local/bin/pnpm install --frozen-lockfile (pnpm install and commit the lockfile if you add a dependency), then ~/.local/bin/pnpm -r typecheck && ~/.local/bin/pnpm -r lint && ~/.local/bin/pnpm -r test. Small conventional commits with sign-off (git commit -s). No Azure calls.

Land it: git push -u origin $B; gh pr create --base main --milestone ${MS:-v0.2.0} --label area:$AREA --body-file <file> from .github/pull_request_template.md (Closes #$N; hard-rules checklist ticked honestly; tests; For the owner). End the body with: Built by Codex (gpt-6.1-sol), orchestrated from Claude Code. Poll gh pr checks <n> --json name,state every 15 s until ci is SUCCESS (fix failures). Wait until the Codex GitHub review comment no longer says running; reply to every thread with the fix commit or the reason and resolve it. Then gh pr merge <n> --rebase --delete-branch. Never --admin, never force-push: if GitHub refuses because main moved, rebase, push $B-r2, open a replacement PR, close the old one.
Final message: PR URL, merged or not, what was built, tests, what was left out, owner questions.
BRIEF
cd $W && nohup codex exec -m gpt-6.1-sol -c model_reasoning_effort=high --dangerously-bypass-approvals-and-sandbox -C $W -o $S/final-$N.md "$(cat $S/brief-$N.md)" > $S/log-$N.txt 2>&1 &
echo "$N $!" >> $S/running
echo "started #$N pid $!"
