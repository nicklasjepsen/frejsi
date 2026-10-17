export const meta = {
  name: 'ship-milestone',
  description: 'Take a Frejsi milestone to production: build and merge every lane via build-lanes, then tag the version and watch release.yml create the GitHub release',
  whenToUse: 'After /start-milestone has shown the lane split and got an OK and created the worktrees. Pass { milestone, base, lanes } as args.',
  phases: [
    { title: 'Lanes', detail: 'build-lanes: build, gate, fix, merge, watch main' },
    { title: 'Release', detail: 'tag vX.Y.Z, watch release.yml, GitHub release' },
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
  plumbing: 'sonnet',
}
const ROLE_EFFORT = { lookup: 'low' }
const as = (role, opts) => {
  const model = ((args && args.models) || {})[role] || ROLE_MODELS[role]
  return { ...(model ? { model } : {}), ...(ROLE_EFFORT[role] ? { effort: ROLE_EFFORT[role] } : {}), ...opts }
}

// args: { milestone: 'v0.2.0', base: 'main', lanes: [...], models?: {...} }  (same lanes and models shape as build-lanes)
if (!args || !args.milestone || !/^v\d+\.\d+\.\d+$/.test(args.milestone)) throw new Error('args.milestone must look like v0.2.0')
if (!Array.isArray(args.lanes) || !args.lanes.length) throw new Error('args.lanes is required')

const RELEASE_SCHEMA = {
  type: 'object',
  properties: {
    released: { type: 'boolean' },
    tag: { type: 'string' },
    runUrl: { type: 'string' },
    releaseUrl: { type: 'string' },
    waitingOnOwner: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['released', 'tag', 'summary'],
}

phase('Lanes')
const lanes = await workflow('build-lanes', { base: args.base || 'main', lanes: args.lanes, milestone: args.milestone, models: args.models })
const board = (lanes && lanes.board) || []
const unmerged = board.filter((b) => b.final !== 'merged')
if (unmerged.length) {
  log(`${unmerged.length} lane(s) not merged: ${unmerged.map((b) => `${b.lane} (${b.final})`).join(', ')}; not releasing`)
  return { milestone: args.milestone, released: false, board, reason: 'lanes not merged' }
}

phase('Release')
const release = await callAgent(
  `Release milestone ${args.milestone} of nicklasjepsen/frejsi by following the "release" skill in .claude/skills/release/SKILL.md exactly: ` +
  `verify (milestone has zero open issues, no open PR carries it, main CI green, tag absent), tag origin/main, push the tag, watch release.yml to the end, and report. ` +
  `If the milestone still has open issues that no lane in this run owned, do not tag: set released=false and list them in summary. ` +
  `If the run is waiting on the production-infra environment, set waitingOnOwner=true and keep watching until it ends or 50 minutes pass. ` +
  `Never move or delete a tag, never rerun more than once, never deploy by any other path.`,
  as('plumbing', { label: `release:${args.milestone}`, phase: 'Release', schema: RELEASE_SCHEMA }),
)

log(release && release.released ? `${args.milestone} released: ${release.releaseUrl || release.runUrl || ''}` : `${args.milestone} not released`)
return { milestone: args.milestone, released: !!(release && release.released), board, release }
