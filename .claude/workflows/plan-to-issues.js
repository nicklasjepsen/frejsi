export const meta = {
  name: 'plan-to-issues',
  description: 'Turn an approved implementation plan into one GitHub issue per task, checked for path collisions and spec coverage first',
  whenToUse: 'After the owner has approved a plan under docs/superpowers/plans/. Run via the plan-to-issues skill, which passes { plan, repo, milestone? } as args.',
  phases: [
    { title: 'Plan', detail: 'planner reads the plan and emits the task list' },
    { title: 'Check', detail: 'two critics: path collisions, spec coverage' },
    { title: 'Issues', detail: 'one issue per task, duplicates skipped' },
  ],
}

// Role agents: prefer the project subagent type (.claude/agents/<role>.md); if this session's registry
// does not know it (agents added after the session started are not loaded until a restart), fall back
// to a general-purpose agent told to read and follow that file.
const callAgent = async (prompt, opts = {}) => {
  if (!opts.agentType) return agent(prompt, opts)
  try {
    return await agent(prompt, opts)
  } catch (e) {
    if (!/not found/.test(String(e && e.message))) throw e
    const { agentType, ...rest } = opts
    return agent(
      `You act as the "${agentType}" agent of this repository. First read .claude/agents/${agentType}.md and follow it exactly as your operating instructions, including its limits on what you may edit or run. Then do this:\n\n${prompt}`,
      rest,
    )
  }
}

// args: { plan: 'docs/superpowers/plans/<file>.md', milestone: 'v0.2.0', repo?: 'nicklasjepsen/frejsi' }
// Every issue carries the milestone: the milestone is the release, its title is the version.
if (!args || !args.plan) throw new Error('args.plan (plan file path) is required')
if (!args.milestone || !/^v\d+\.\d+\.\d+$/.test(args.milestone)) throw new Error('args.milestone must look like v0.2.0')
const repo = (args && args.repo) || 'nicklasjepsen/frejsi'

const TASKS_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          title: { type: 'string' },
          kind: { type: 'string', enum: ['build', 'decision'] },
          spec: { type: 'string' },
          area: { type: 'string', enum: ['web', 'poller', 'shared', 'infra', 'ai', 'docs'] },
          owns: { type: 'array', items: { type: 'string' } },
          depends: { type: 'array', items: { type: 'integer' } },
          schema: { type: 'boolean' },
          acceptance: { type: 'array', items: { type: 'string' } },
          hardRules: { type: 'string' },
        },
        required: ['n', 'title', 'kind', 'spec', 'area', 'owns', 'depends', 'schema', 'acceptance'],
      },
    },
  },
  required: ['tasks'],
}

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'problems'],
}

const ISSUE_SCHEMA = {
  type: 'object',
  properties: {
    n: { type: 'integer' },
    url: { type: 'string' },
    skipped: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['n', 'url', 'skipped'],
}

phase('Plan')
const plan = await callAgent(
  `Read the approved plan at ${args.plan} and emit the task list. Follow your rules: one task per PR, owns paths as specific as possible, testable acceptance criteria citing the spec section, decisions the owner has not made as kind "decision".`,
  { label: 'planner', phase: 'Plan', agentType: 'planner', schema: TASKS_SCHEMA },
)
if (!plan || !plan.tasks.length) throw new Error('planner returned no tasks')
log(`${plan.tasks.length} tasks from ${args.plan}`)

// Barrier is correct here: both critics need the whole task list.
phase('Check')
const taskText = JSON.stringify(plan.tasks, null, 1)
const [collisions, coverage] = await parallel([
  () => callAgent(
    `Here is a task list for Frejsi:\n${taskText}\n\nFind every pair of tasks that would run in the same wave (neither depends on the other, directly or transitively) and own the same path or a parent/child of the same path. Shared append-only files (pnpm-workspace.yaml, shared/src/index.ts, web/messages/*.json, infra/main.bicep) do not count. Also flag a task whose owns list is empty or is a whole package root (web/, poller/, shared/, infra/). Set ok=false if you find any.`,
    { label: 'critic:collisions', phase: 'Check', schema: CRITIC_SCHEMA },
  ),
  () => callAgent(
    `Here is a task list derived from the plan ${args.plan}:\n${taskText}\n\nRead the plan. List every plan step, requirement or acceptance criterion that no task covers, and every task that is not in the plan. Then read CLAUDE.md's hard rules: for each task that touches glucose rendering, roles, AI, external sources or data writes, check that hardRules names the rule and a test. Set ok=false if anything is missing.`,
    { label: 'critic:coverage', phase: 'Check', schema: CRITIC_SCHEMA },
  ),
])
const problems = [...((collisions && collisions.problems) || []), ...((coverage && coverage.problems) || [])]
if (problems.length) {
  log(`${problems.length} problems found; no issues created`)
  return { created: [], tasks: plan.tasks, problems }
}

phase('Issues')
await callAgent(
  `Make sure milestone "${args.milestone}" exists in ${repo}: \`gh api repos/${repo}/milestones?state=all --jq '.[] | select(.title=="${args.milestone}") | .number'\`. ` +
  `If nothing is printed, create it: \`gh api -X POST repos/${repo}/milestones -f title="${args.milestone}" -f description="Release ${args.milestone} — plan: ${args.plan}"\`. Reply with the milestone number only.`,
  { label: 'milestone', phase: 'Issues' },
)
const created = await pipeline(
  plan.tasks,
  (task) => callAgent(
    `Create a GitHub issue in ${repo} for this task, or skip it if one already exists.\n\n` +
    `Task:\n${JSON.stringify(task, null, 1)}\n\n` +
    `1. Check for a duplicate: \`gh issue list -R ${repo} --state all --search "${task.title.replace(/"/g, '')}" --json number,title\`. ` +
    `If an issue with the same meaning exists, return skipped=true with its URL and reason.\n` +
    `2. Otherwise write the body in the shape of .github/ISSUE_TEMPLATE/task.yml (Spec, Change, Owns, Acceptance, Hard rules, Depends on) and run ` +
    `\`gh issue create -R ${repo} --title "<title>" --label task --label "area:${task.area}" ${task.kind === 'decision' ? '--label needs-owner ' : ''}${task.schema ? '--label schema ' : ''}--milestone "${args.milestone}" --body-file <file>\`. ` +
    `Write the body to a file in your scratchpad first. For "Depends on" use the task numbers; the caller rewrites them to issue numbers afterwards.\n` +
    `3. Return n=${task.n}, the issue URL, skipped=false.`,
    { label: `issue:${task.n}`, phase: 'Issues', schema: ISSUE_SCHEMA },
  ),
)

const ok = created.filter(Boolean)
log(`${ok.filter((c) => !c.skipped).length} issues created, ${ok.filter((c) => c.skipped).length} skipped`)
return { created: ok, tasks: plan.tasks, problems: [] }
