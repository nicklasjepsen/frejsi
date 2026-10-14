export const meta = {
  name: 'review-pr',
  description: 'Review one Frejsi PR with the three gate agents, then try to refute every finding before reporting it',
  whenToUse: 'On any open PR, before the owner reads it. Pass { pr: <number> } as args.',
  phases: [
    { title: 'Find', detail: 'spec-guardian, reviewer, copy-reviewer' },
    { title: 'Verify', detail: 'two refuters per finding; majority decides' },
  ],
}

if (!args || !args.pr) throw new Error('args.pr (PR number) is required')
const pr = args.pr

const FINDINGS_SCHEMA = {
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
          scenario: { type: 'string' },
        },
        required: ['severity', 'file', 'what'],
      },
    },
  },
  required: ['verdict', 'findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, why: { type: 'string' } },
  required: ['refuted', 'why'],
}

const GATES = [
  { key: 'guardian', agentType: 'spec-guardian', lens: 'hard rules' },
  { key: 'review', agentType: 'reviewer', lens: 'correctness' },
  { key: 'copy', agentType: 'copy-reviewer', lens: 'copy and i18n' },
]

const confirmed = await pipeline(
  GATES,
  (g) => agent(
    `Run your ${g.lens} review on PR #${pr} of nicklasjepsen/frejsi (gh pr diff ${pr}). Return verdict and findings in the schema. Hard-rule failures from spec-guardian are never downgraded.`,
    { label: `find:${g.key}`, phase: 'Find', agentType: g.agentType, schema: FINDINGS_SCHEMA },
  ),
  async (found, g) => {
    const findings = (found && found.findings) || []
    if (!findings.length) return []
    // Hard-rule fails are reported as-is: refuting them is the owner's call, not an agent's.
    if (g.key === 'guardian') return findings.map((f) => ({ ...f, from: g.key, verified: 'hard-rule' }))
    const judged = await parallel(findings.map((f) => async () => {
      const votes = await parallel([0, 1].map((i) => () => agent(
        `PR #${pr} of nicklasjepsen/frejsi. A ${g.lens} reviewer claims:\n${JSON.stringify(f, null, 1)}\n\n` +
        `Read the diff (gh pr diff ${pr}) and the surrounding code and try to refute this claim${i === 0 ? ' by showing the scenario cannot occur' : ' by showing the code already handles it or a test covers it'}. ` +
        `Default to refuted=true if you are not sure it is real.`,
        { label: `refute${i + 1}:${g.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
      )))
      const refutedCount = votes.filter(Boolean).filter((v) => v.refuted).length
      return refutedCount >= 2 ? null : { ...f, from: g.key, verified: `${2 - refutedCount}/2 upheld` }
    }))
    return judged.filter(Boolean)
  },
)

const all = confirmed.flat().filter(Boolean)
const order = { high: 0, medium: 1, low: 2 }
all.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))
log(`${all.length} findings survived verification`)
return { pr, findings: all }
