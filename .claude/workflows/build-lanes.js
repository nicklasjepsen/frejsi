export const meta = {
  name: 'build-lanes',
  description: 'Build several Frejsi lanes in parallel: one implementer per lane in its own worktree, the three gate agents, one fix round, then the lane merges itself when green and main CI is watched',
  whenToUse: 'Called by ship-milestone, or on its own after a lane split has been OKed and the worktrees exist. Pass { lanes: [...], base, milestone? } as args.',
  phases: [
    { title: 'Build', detail: 'one implementer per lane, TDD, PR opened' },
    { title: 'Gate', detail: 'spec-guardian, reviewer, copy-reviewer on each PR' },
    { title: 'Fix', detail: 'one round addressing findings, then guardian again' },
    { title: 'Merge', detail: 'rebase-merge when green; watch main CI; fix forward if red' },
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

// One model per role (docs/agent-workflow.md §2). The session model is the most capable tier and
// overkill for most steps; args.models overrides any role for the run, e.g. { models: { implementer: 'fable' } }.
const ROLE_MODELS = {
  implementer: 'opus',
  'spec-guardian': 'opus',
  reviewer: 'opus',
  'copy-reviewer': 'sonnet',
  plumbing: 'sonnet',
  lookup: 'haiku',
}
const ROLE_EFFORT = { lookup: 'low' }
const as = (role, opts) => {
  const model = ((args && args.models) || {})[role] || ROLE_MODELS[role]
  return { ...(model ? { model } : {}), ...(ROLE_EFFORT[role] ? { effort: ROLE_EFFORT[role] } : {}), ...opts }
}

// args: {
//   base: 'main', milestone?: 'v0.2.0', gates?: true (Claude gate agents; off by default until the pre-1.0 audit),
//   models?: { implementer?: 'fable', plumbing?: 'opus', ... } (per-role model override, see ROLE_MODELS),
//   lanes: [{ name, issues: [n, ...], branch, worktree, owns: [...], shared: [...], migration: '0003' | null, notes, model? }]
// lane.model overrides the implementer model for that lane only (a schema rewrite or a hard-rule lane may want 'fable').
// }
if (!args || !Array.isArray(args.lanes) || !args.lanes.length) throw new Error('args.lanes is required')
const base = (args && args.base) || 'main'
const milestone = (args && args.milestone) || null

const PR_SCHEMA = {
  type: 'object',
  properties: {
    pr: { type: 'integer' },
    url: { type: 'string' },
    draft: { type: 'boolean' },
    blocked: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['pr', 'url', 'draft', 'blocked', 'summary'],
}

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          what: { type: 'string' },
        },
        required: ['severity', 'file', 'what'],
      },
    },
  },
  required: ['verdict', 'findings'],
}

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    merged: { type: 'boolean' },
    mainGreen: { type: 'boolean' },
    sha: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['merged', 'mainGreen', 'summary'],
}

const briefFor = (lane) =>
  `You are the implementer for lane "${lane.name}" of Frejsi${milestone ? `, milestone ${milestone}` : ''}.\n\n` +
  `Issue(s): ${lane.issues.map((n) => `#${n}`).join(', ')} (read them with gh issue view).\n` +
  `Worktree: ${lane.worktree}\nBranch: ${lane.branch} (already created from origin/${base})\n` +
  `You own: ${lane.owns.join(', ')}\n` +
  `Shared append-only files you may touch: ${(lane.shared || []).join(', ') || 'none beyond the defaults in docs/agent-workflow.md'}\n` +
  `Prisma migration number if you add one: ${lane.migration || 'none expected'} (renumber after origin/${base}'s highest before you open the PR)\n` +
  (lane.notes ? `Notes: ${lane.notes}\n` : '') +
  `\nThis lane is a vertical slice: build all of it, TDD, as one PR that closes the issue(s)` +
  `${milestone ? ` and carries milestone ${milestone}` : ''}. Return the PR number and URL. ` +
  `If you had to stop (needs-owner), open a draft PR, set blocked=true and say why in summary. ` +
  `The lanes of one run share the session scratchpad directory: name every temporary file with your lane ` +
  `(pr-body-${lane.branch.replace(/[^a-z0-9]+/gi, '-')}.md, never pr-body.md), and never git stash in the worktree (the stash list is shared).`

const gatePrompt = (role, pr) =>
  `Run your ${role} review on PR #${pr} of nicklasjepsen/frejsi (gh pr diff ${pr}). Return verdict and findings in the schema.`

const results = await pipeline(
  args.lanes,

  // Build. The worktree already exists, so no isolation here.
  (lane) => callAgent(briefFor(lane), as('implementer', { ...(lane.model ? { model: lane.model } : {}), label: `build:${lane.name}`, phase: 'Build', agentType: 'implementer', schema: PR_SCHEMA })),

  // Gate: three independent perspectives on the same PR. parallel() is right: the fix round needs all three.
  async (built, lane) => {
    if (!built || built.blocked) return { lane, built, gates: null }
    // Claude gates are off while v0.x is built (owner, 2026-10-15); pass { gates: true } to turn them on.
    // CI (with the dosing-vocabulary test) and Codex's GitHub review still gate every PR. The full gate
    // pass runs once over the whole codebase before v1.0.0 (issue in milestone v1.0.0).
    if (!(args && args.gates === true)) return { lane, built, gates: { guardian: null, review: null, copy: null } }
    const [guardian, review, copy] = await parallel([
      () => callAgent(gatePrompt('spec-guardian', built.pr), as('spec-guardian', { label: `guardian:${lane.name}`, phase: 'Gate', agentType: 'spec-guardian', schema: GATE_SCHEMA })),
      () => callAgent(gatePrompt('reviewer', built.pr), as('reviewer', { label: `review:${lane.name}`, phase: 'Gate', agentType: 'reviewer', schema: GATE_SCHEMA })),
      () => callAgent(gatePrompt('copy-reviewer', built.pr), as('copy-reviewer', { label: `copy:${lane.name}`, phase: 'Gate', agentType: 'copy-reviewer', schema: GATE_SCHEMA })),
    ])
    return { lane, built, gates: { guardian, review, copy } }
  },

  // Fix: one round, then the guardian once more. Never a second round; a lane still red waits for the owner.
  async (state) => {
    const { lane, built, gates } = state
    if (!gates) return { ...state, final: built && built.blocked ? 'blocked' : 'build-failed' }
    const findings = ['guardian', 'review', 'copy']
      .flatMap((k) => ((gates[k] && gates[k].findings) || []).map((f) => ({ ...f, from: k })))
    if (!findings.length) return { ...state, final: 'green' }

    log(`${lane.name}: ${findings.length} findings, one fix round`)
    const fixed = await callAgent(
      `${briefFor(lane)}\n\nThe PR #${built.pr} is open. Address every finding below in follow-up signed-off commits on the same branch, or reply in the PR thread with why not. Re-run the full checks before pushing.\n\n${JSON.stringify(findings, null, 1)}`,
      as('implementer', { ...(lane.model ? { model: lane.model } : {}), label: `fix:${lane.name}`, phase: 'Fix', agentType: 'implementer', schema: PR_SCHEMA }),
    )
    const recheck = await callAgent(gatePrompt('spec-guardian', built.pr), as('spec-guardian', { label: `guardian2:${lane.name}`, phase: 'Fix', agentType: 'spec-guardian', schema: GATE_SCHEMA }))
    const final = recheck && recheck.verdict === 'pass' ? 'green-after-fix' : 'red-needs-owner'
    return { ...state, fixed, recheck, findings, final }
  },

  // Merge: the lane merges itself when green, then watches main's CI. No queue, no lock, no owner.
  async (state) => {
    const { lane, built, final } = state
    if (final !== 'green' && final !== 'green-after-fix') {
      if (final === 'red-needs-owner' && built) {
        await callAgent(`Label PR #${built.pr} of nicklasjepsen/frejsi with needs-owner and post one comment summarising the unresolved findings: ${JSON.stringify(state.findings || [])}`, as('lookup', { label: `flag:${lane.name}`, phase: 'Merge' }))
      }
      return state
    }
    const merge = await callAgent(
      `You are the implementer for lane "${lane.name}" of Frejsi; your PR #${built.pr} has passed the gates. Merge it and keep main green:\n` +
      `1. Resolve every Codex review thread on the PR (reply with the fix commit or the reason, then resolve). If a thread raises a real defect, fix it first in a signed-off commit.\n` +
      `2. Wait for the ci check in the foreground: gh pr checks ${built.pr} --watch (bounded; if it is red, fix it, never skip).\n` +
      `3. Merge: gh pr merge ${built.pr} --rebase --delete-branch. Never --admin. If GitHub refuses because of a conflict with ${base}, rebase your branch on origin/${base} in your worktree, run the full checks, push, and merge.\n` +
      `4. Watch main: gh run list --workflow ci.yml --branch ${base} --limit 1, then gh run watch <id> --exit-status. If it is red because of your merge, fix forward on a new branch from ${base} through the normal PR, or revert your merge with gh pr revert / git revert and a PR, within this session. Report mainGreen honestly.\n` +
      `5. Return merged, mainGreen, the merge sha and a one-line summary.`,
      as('plumbing', { label: `merge:${lane.name}`, phase: 'Merge', agentType: 'implementer', schema: MERGE_SCHEMA }),
    )
    const merged = !!(merge && merge.merged)
    return { ...state, merge, final: merged ? (merge.mainGreen ? 'merged' : 'merged-main-red') : 'merge-failed' }
  },
)

const board = results.filter(Boolean).map((r) => ({
  lane: r.lane.name,
  issues: r.lane.issues,
  pr: r.built && r.built.url,
  final: r.final,
  findings: (r.findings || []).length,
}))
log(board.map((b) => `${b.lane}: ${b.final} ${b.pr || ''}`).join(' | '))
return { board, results }
