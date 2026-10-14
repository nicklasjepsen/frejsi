export const meta = {
  name: 'ship-milestone',
  description: 'Take a Frejsi milestone to production: build and merge every lane via build-lanes, then tag the version and watch release.yml create the GitHub release',
  whenToUse: 'After /start-milestone has shown the lane split and got an OK and created the worktrees. Pass { milestone, base, lanes } as args.',
  phases: [
    { title: 'Lanes', detail: 'build-lanes: build, gate, fix, merge, watch main' },
    { title: 'Release', detail: 'tag vX.Y.Z, watch release.yml, GitHub release' },
  ],
}

// args: { milestone: 'v0.2.0', base: 'main', lanes: [...] }  (same lanes shape as build-lanes)
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
const lanes = await workflow('build-lanes', { base: args.base || 'main', lanes: args.lanes, milestone: args.milestone })
const board = (lanes && lanes.board) || []
const unmerged = board.filter((b) => b.final !== 'merged')
if (unmerged.length) {
  log(`${unmerged.length} lane(s) not merged: ${unmerged.map((b) => `${b.lane} (${b.final})`).join(', ')}; not releasing`)
  return { milestone: args.milestone, released: false, board, reason: 'lanes not merged' }
}

phase('Release')
const release = await agent(
  `Release milestone ${args.milestone} of nicklasjepsen/frejsi by following the "release" skill in .claude/skills/release/SKILL.md exactly: ` +
  `verify (milestone has zero open issues, no open PR carries it, main CI green, tag absent), tag origin/main, push the tag, watch release.yml to the end, and report. ` +
  `If the milestone still has open issues that no lane in this run owned, do not tag: set released=false and list them in summary. ` +
  `If the run is waiting on the production-infra environment, set waitingOnOwner=true and keep watching until it ends or 50 minutes pass. ` +
  `Never move or delete a tag, never rerun more than once, never deploy by any other path.`,
  { label: `release:${args.milestone}`, phase: 'Release', schema: RELEASE_SCHEMA },
)

log(release && release.released ? `${args.milestone} released: ${release.releaseUrl || release.runUrl || ''}` : `${args.milestone} not released`)
return { milestone: args.milestone, released: !!(release && release.released), board, release }
