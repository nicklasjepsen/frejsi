export const meta = {
  name: 'housekeeping-sweep',
  description: 'Interactive, parallel version of the housekeeping skill: triage untouched issues and PRs, merge green Dependabot minors, mark stale PRs, delete fully merged branches, fix milestone hygiene, and refresh the "Waiting on the owner" issue. The daily background run is the housekeeping GitHub Actions workflow.',
  whenToUse: 'From an interactive session when the owner asks for housekeeping now. Pass { today: "YYYY-MM-DD" } as args. The daily run on GitHub follows the skill without this script.',
  phases: [
    { title: 'Sweep', detail: 'list what needs attention, in parallel' },
    { title: 'Triage', detail: 'one triage agent per untouched issue or PR' },
    { title: 'Clean', detail: 'dependabot, stale, branches, milestones, owner issue' },
  ],
}

// args: { today: 'YYYY-MM-DD' (required; scripts cannot read the clock) }
if (!args || !args.today) throw new Error('args.today (YYYY-MM-DD) is required')
const today = args.today
const repo = 'nicklasjepsen/frejsi'

const LIST_SCHEMA = {
  type: 'object',
  properties: { numbers: { type: 'array', items: { type: 'integer' } }, note: { type: 'string' } },
  required: ['numbers'],
}
const DONE_SCHEMA = {
  type: 'object',
  properties: { changed: { type: 'boolean' }, actions: { type: 'array', items: { type: 'string' } }, forOwner: { type: 'array', items: { type: 'string' } } },
  required: ['changed', 'actions', 'forOwner'],
}

phase('Sweep')
const untriaged = await agent(
  `In ${repo}, list open issues and open pull requests that carry neither the label "triaged" nor the label "task" and whose author is not dependabot: ` +
  `\`gh issue list -R ${repo} --state open --limit 200 --json number,labels,author\` and \`gh pr list -R ${repo} --state open --limit 100 --json number,labels,author,headRefName\`. ` +
  `Exclude PRs on branches matching */gh-<n>-* (those are lanes). Return the numbers.`,
  { label: 'sweep:untriaged', phase: 'Sweep', schema: LIST_SCHEMA },
)
const numbers = (untriaged && untriaged.numbers) || []
log(`${numbers.length} untriaged`)

phase('Triage')
const triaged = await pipeline(
  numbers,
  (n) => agent(`Triage #${n} in ${repo}. Today is ${today}.`, { label: `triage:${n}`, phase: 'Triage', agentType: 'triage' }),
)

// Cleanups are independent of each other and of triage; parallel() is a barrier only because the
// report needs all of them, and they are all short.
phase('Clean')
const cleanups = await parallel([
  () => agent(
    `Dependabot PRs in ${repo}: \`gh pr list -R ${repo} --author app/dependabot --state open --json number,title,statusCheckRollup,mergeable\`. ` +
    `For each whose title says a minor or patch bump (not a major, not "x.0.0" from a lower major) and whose checks are all green and mergeable: \`gh pr merge <n> -R ${repo} --rebase --auto\`. ` +
    `Never --admin. A major bump: add the label "needs-owner" and leave it. A red check: leave it, note it. Return what you did.`,
    { label: 'clean:dependabot', phase: 'Clean', schema: DONE_SCHEMA },
  ),
  () => agent(
    `Stale pull requests in ${repo}, today ${today}: \`gh pr list -R ${repo} --state open --json number,title,updatedAt,isDraft,labels,author\`. ` +
    `A PR not updated for 14 days and not labelled "stale": add the label "stale" and one comment starting with "<!-- frejsi-stale -->" saying it will be closed by the owner if nothing happens in 7 days; never close it yourself. ` +
    `A PR labelled "stale" that was updated after the label: remove the label. Return what you did.`,
    { label: 'clean:stale', phase: 'Clean', schema: DONE_SCHEMA },
  ),
  () => agent(
    `Branches of ${repo}, working in the repo root. \`git fetch -p -q origin\`. ` +
    `List remote branches other than main: \`git branch -r --format '%(refname:short)' | grep -v -e 'origin/main$' -e HEAD\`. ` +
    `For each: if \`git merge-base --is-ancestor <branch> origin/main\` succeeds (every commit is already on main) and no open PR has it as head (\`gh pr list -R ${repo} --head <name> --state open\`), delete it: \`git push origin --delete <name>\`. ` +
    `A branch with commits not on main is never deleted: report it with its last commit date and whether a PR exists. Return what you did.`,
    { label: 'clean:branches', phase: 'Clean', schema: DONE_SCHEMA },
  ),
  () => agent(
    `Milestone hygiene in ${repo}, working in /home/nick/dev/frejsi with \`git fetch -q --tags origin\`. Milestones: \`gh api repos/${repo}/milestones?state=all --paginate --jq '.[] | {number,title,state,open_issues}'\`. ` +
    `1. An open issue in a closed milestone: move it to the lowest open vX.Y.Z milestone (\`gh issue edit <n> --milestone <title>\`) and comment once ("<!-- frejsi-milestone -->", moved from <old> because it was released without this) — or, if no open milestone exists, add the label "needs-owner" instead. ` +
    `2. A closed issue with no milestone that was closed by a merged PR (\`gh issue view <n> --json closedByPullRequestsReferences\`): find the merge commit, \`git tag --contains <sha> | sort -V | head -1\`; if a tag names a milestone, set that milestone on the issue so release notes are right. If no tag contains it yet, set the lowest open milestone. ` +
    `3. An open PR whose linked issue has a milestone but the PR has none: set the same milestone on the PR. ` +
    `Return what you did.`,
    { label: 'clean:milestones', phase: 'Clean', schema: DONE_SCHEMA },
  ),
  () => agent(
    `What waits on the owner in ${repo}, today ${today}: \`gh issue list -R ${repo} --label needs-owner --state open --json number,title,updatedAt\` and \`gh pr list -R ${repo} --label needs-owner --state open --json number,title,updatedAt,isDraft\`, plus the ones labelled "security". ` +
    `Also the latest release.yml run if it failed: \`gh run list -R ${repo} --workflow release.yml --limit 1 --json conclusion,url,displayTitle\`. ` +
    `Then keep the single pinned issue titled "Waiting on the owner" current as the housekeeping skill §6 describes (create and pin it if missing; replace its body with today's list or "Nothing. ${today}"). ` +
    `Return each item as one line "#<n> <title> (<days> days)" in forOwner; changed=true only if the body changed.`,
    { label: 'clean:owner-digest', phase: 'Clean', schema: DONE_SCHEMA },
  ),
])

const done = cleanups.filter(Boolean)
const actions = done.flatMap((d) => d.actions || [])
const forOwner = done.flatMap((d) => d.forOwner || [])
const changed = triaged.filter(Boolean).length > 0 || done.some((d) => d.changed)
log(`${triaged.filter(Boolean).length} triaged, ${actions.length} cleanup actions, ${forOwner.length} items for the owner`)
return { today, changed, triaged: triaged.filter(Boolean), actions, forOwner }
