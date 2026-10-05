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

  it('blocks access to opportunities the user has left', async () => {
    const msx = connector()
    await msx.leaveDealTeam('opp-grid-modernization')
    await expect(msx.listMilestones('opp-grid-modernization')).rejects.toThrow()
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
