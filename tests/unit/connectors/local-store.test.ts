import { describe, expect, it } from 'vitest'
import {
  LocalStore,
  LocalStoreMsxConnector,
  formatCommentEntry,
  prependComment
} from '../../../packages/connectors/local-store/index.js'

function connector(): LocalStoreMsxConnector {
  return new LocalStoreMsxConnector(new LocalStore())
}

describe('local-store MSX connector', () => {
  it('seeds accounts across the portfolio including Zava and Adventure Works', async () => {
    const accounts = await connector().listAccounts()
    const names = accounts.map((account) => account.name)
    expect(names).toContain('Zava Inc.')
    expect(names).toContain('Adventure Works Cycles')
    expect(names).toContain('Contoso Energy')
    expect(accounts.length).toBeGreaterThanOrEqual(5)
  })

  it('exposes opportunities across MCEM stages 1-5', async () => {
    const msx = connector()
    const accounts = await msx.listAccounts()
    const opportunities = (await Promise.all(accounts.map((account) => msx.listOpportunities(account.id)))).flat()
    const stages = new Set(opportunities.map((opportunity) => opportunity.recordedStage))
    expect([1, 2, 3, 4, 5].every((stage) => stages.has(stage))).toBe(true)
  })

  it('covers every milestone pipeline status across the seed', async () => {
    const msx = connector()
    const accounts = await msx.listAccounts()
    const opportunities = (await Promise.all(accounts.map((account) => msx.listOpportunities(account.id)))).flat()
    const milestones = (await Promise.all(opportunities.map((opportunity) => msx.listMilestones(opportunity.id)))).flat()
    const statuses = new Set(milestones.map((milestone) => milestone.status))
    for (const status of ['On Track', 'At Risk', 'Blocked', 'Completed', 'Cancelled', 'Lost to Competitor', 'Hygiene/Duplicate']) {
      expect(statuses.has(status)).toBe(true)
    }
  })

  it('resolves owner ids to display names', async () => {
    const msx = connector()
    const opportunities = await msx.listOpportunities('account-contoso')
    const grid = opportunities.find((opportunity) => opportunity.id === 'opp-grid-modernization')
    expect(grid?.owner).toBe('Avery Johnson')
  })

  it('persists milestone injects (status + commitment) in the store', async () => {
    const msx = connector()
    const updated = await msx.updateMilestone('opp-grid-modernization', 'ms-grid-security', {
      status: 'Completed',
      customerCommitment: 'Committed'
    })
    expect(updated.status).toBe('Completed')
    expect(updated.commitment).toBe('Committed')
    const reread = (await msx.listMilestones('opp-grid-modernization')).find((milestone) => milestone.id === 'ms-grid-security')
    expect(reread?.status).toBe('Completed')
  })

  it('appends opportunity comments newest-first with the initials + date prefix', async () => {
    const msx = connector()
    const before = (await msx.listOpportunities('account-contoso')).find((opportunity) => opportunity.id === 'opp-grid-modernization')
    const updated = await msx.appendOpportunityComment('opp-grid-modernization', 'Follow-up scheduled with the CFO.')
    expect(updated.comments?.startsWith('GP ')).toBe(true)
    expect(updated.comments).toContain('Follow-up scheduled with the CFO.')
    // prior history preserved below the new entry
    expect(updated.comments).toContain(before?.comments ?? '')
  })

  it('builds the comment entry and prepend format deterministically', () => {
    const entry = formatCommentEntry('GP', 'Hello', new Date('2026-10-04T12:00:00'))
    expect(entry).toBe('GP 10/4/2026 Hello')
    expect(prependComment('OLD', entry)).toBe('GP 10/4/2026 Hello\nOLD')
    expect(prependComment(undefined, entry)).toBe(entry)
  })

  it('retains milestone access via milestone-team membership after leaving the deal team', async () => {
    const msx = connector()
    await msx.leaveDealTeam('opp-grid-modernization')
    // Independent membership: the seed keeps the user on milestone teams for this opportunity,
    // so the opportunity and its milestones remain reachable even without Deal Team membership.
    await expect(msx.listMilestones('opp-grid-modernization')).resolves.toEqual(expect.any(Array))
  })

  it('blocks access once the user has left both the deal team and all milestone teams', async () => {
    const msx = connector()
    await msx.leaveDealTeam('opp-grid-modernization')
    for (const milestone of await msx.listMilestones('opp-grid-modernization')) {
      await msx.leaveMilestoneTeam('opp-grid-modernization', milestone.id)
    }
    await expect(msx.listMilestones('opp-grid-modernization')).rejects.toThrow()
  })

  it('shows mixed milestone-team membership states in the seed', async () => {
    const milestones = await connector().listMilestones('opp-grid-modernization')
    // Seeded as a member of some milestones (shows "-") and not others (shows "+").
    expect(milestones.find((milestone) => milestone.id === 'ms-grid-outcome')?.onMilestoneTeam).toBe(true)
    expect(milestones.find((milestone) => milestone.id === 'ms-grid-technical')?.onMilestoneTeam).toBe(true)
    expect(milestones.find((milestone) => milestone.id === 'ms-grid-security')?.onMilestoneTeam).toBe(false)
  })

  it('keeps a milestone-team-only opportunity in the portfolio without Deal Team membership', async () => {
    const msx = connector()
    // opp-ms-only-showcase is excluded from the seed Deal Team but the user is on its milestone team.
    const opportunities = await msx.listOpportunities('account-contoso')
    expect(opportunities.some((opportunity) => opportunity.id === 'opp-ms-only-showcase')).toBe(true)

    const milestones = await msx.listMilestones('opp-ms-only-showcase')
    expect(milestones.find((milestone) => milestone.id === 'ms-only-review')?.onMilestoneTeam).toBe(true)

    // With no Deal Team fallback, leaving the milestone team removes it from the portfolio.
    await msx.leaveMilestoneTeam('opp-ms-only-showcase', 'ms-only-review')
    expect((await msx.listOpportunities('account-contoso')).some((opportunity) => opportunity.id === 'opp-ms-only-showcase')).toBe(false)
  })

  it('expands a greenfield discovery candidate and joins its milestone team without the Deal Team', async () => {
    const msx = connector()
    const discovered = (await msx.discoverOpportunities('ai-apps')).find((opportunity) => opportunity.id === 'disc-contoso-greenfield')
    expect(discovered?.onDealTeam).toBe(false)
    // Not in the portfolio until a milestone is joined.
    expect((await msx.listOpportunities('account-contoso')).some((opportunity) => opportunity.id === 'disc-contoso-greenfield')).toBe(false)

    const milestones = await msx.listDiscoverableMilestones('disc-contoso-greenfield')
    expect(milestones.map((milestone) => milestone.id)).toContain('ms-greenfield-outcome')
    expect(milestones.find((milestone) => milestone.id === 'ms-greenfield-outcome')?.onMilestoneTeam).toBe(false)

    await msx.joinMilestoneTeam('disc-contoso-greenfield', 'ms-greenfield-outcome')
    // Now in the portfolio via milestone membership, still NOT on the Deal Team.
    expect((await msx.listOpportunities('account-contoso')).some((opportunity) => opportunity.id === 'disc-contoso-greenfield')).toBe(true)
    expect((await msx.discoverOpportunities('ai-apps')).find((opportunity) => opportunity.id === 'disc-contoso-greenfield')?.onDealTeam).toBe(false)
    expect((await msx.listDiscoverableMilestones('disc-contoso-greenfield')).find((milestone) => milestone.id === 'ms-greenfield-outcome')?.onMilestoneTeam).toBe(true)
  })

  it('lists and creates milestone activities (Tasks) in the SQLite store', async () => {
    const msx = connector()
    // Seeded activities exist for the grid milestones.
    const seeded = await msx.listMilestoneActivities('opp-grid-modernization', 'ms-grid-outcome')
    expect(seeded.map((activity) => activity.id)).toContain('act-grid-outcome-1')
    expect(seeded[0]!.activityType).toBe('task')

    const created = await msx.createMilestoneActivity('opp-grid-modernization', 'ms-grid-outcome', {
      subject: 'Customer briefing', priority: 'High', taskCategory: 'Briefing', due: '2026-07-01', durationMinutes: 45, description: 'Prep deck.'
    })
    expect(created).toMatchObject({ subject: 'Customer briefing', priority: 'High', taskCategory: 'Briefing', due: '2026-07-01', durationMinutes: 45, status: 'Open', activityType: 'task' })
    expect(created.owner).toBe('Girish Pillai')

    const reread = await msx.listMilestoneActivities('opp-grid-modernization', 'ms-grid-outcome')
    expect(reread.some((activity) => activity.id === created.id)).toBe(true)
  })

  it('rejects activities for a milestone not in the opportunity', async () => {
    const msx = connector()
    await expect(msx.listMilestoneActivities('opp-grid-modernization', 'nope')).rejects.toThrow()
    await expect(msx.createMilestoneActivity('opp-grid-modernization', 'nope', { subject: 'x', priority: 'Normal' })).rejects.toThrow()
  })

  it('discovers opportunities across every SE domain', async () => {
    const msx = connector()
    for (const domain of ['infra', 'data', 'ai-apps', 'security', 'modern-work', 'biz-apps', 'devices', 'services'] as const) {
      const discovered = await msx.discoverOpportunities(domain)
      expect(discovered.length).toBeGreaterThan(0)
      expect(discovered.every((opportunity) => opportunity.domain === domain)).toBe(true)
      expect(discovered.every((opportunity) => typeof opportunity.accountName === 'string')).toBe(true)
    }
  })

  it('promotes a discovered opportunity into the portfolio on join', async () => {
    const msx = connector()
    const [candidate] = await msx.discoverOpportunities('security')
    expect(candidate?.onDealTeam).toBe(false)
    const result = await msx.joinDealTeam(candidate!.id)
    expect(result.onDealTeam).toBe(true)
    // now visible in the account portfolio and openable
    const opps = await msx.listOpportunities(candidate!.accountId)
    expect(opps.some((opportunity) => opportunity.id === candidate!.id)).toBe(true)
    await expect(msx.listMilestones(candidate!.id)).resolves.toBeDefined()
    // and reflected as onDealTeam in discovery
    const rediscovered = await msx.discoverOpportunities('security')
    expect(rediscovered.find((opportunity) => opportunity.id === candidate!.id)?.onDealTeam).toBe(true)
  })

  it('lists meeting activities linked to an opportunity', async () => {
    const activities = await connector().listActivities('opp-grid-modernization')
    expect(activities.length).toBeGreaterThanOrEqual(2)
    const review = activities.find((activity) => activity.id === 'act-grid-review')
    expect(review?.isOnlineMeeting).toBe(true)
    expect(review?.status).toBe('Scheduled')
    expect(review?.onlineMeetingJoinUrl).toContain('teams.microsoft.com')
  })

  it('links a transcript to its meeting activity with diarized segments', async () => {
    const transcripts = await connector().listTranscripts('opp-grid-modernization')
    const transcript = transcripts.find((candidate) => candidate.id === 'tr-grid-customer')
    expect(transcript?.activityId).toBe('act-grid-review')
    expect(transcript?.meetingType).toBe('customer')
    expect(transcript?.segments.length).toBe(3)
    // diarization + evidence timestamps are preserved
    expect(transcript?.segments[0]?.speakerRole).toBe('customer')
    expect(transcript?.segments.some((segment) => segment.speakerRole === 'internal')).toBe(true)
    expect(typeof transcript?.segments[0]?.startMs).toBe('number')
  })
})
