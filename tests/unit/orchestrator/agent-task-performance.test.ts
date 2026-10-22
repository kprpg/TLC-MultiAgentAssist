import { describe, expect, it, vi } from 'vitest'
import { contractVersion, type Milestone, type PerformanceEvent } from '../../../packages/common/index.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { FixtureMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'

const request = {
  contractVersion,
  capability: 'mcem-coach' as const,
  accountId: 'account-contoso',
  opportunityId: 'opp-grid-modernization',
  prompt: 'How do we move this opportunity to the next MCEM stage?'
}

describe('MCEM context preparation', () => {
  it.each(['diagnostic', 'agent'] as const)('overlaps independent guidance and milestone reads for the %s', async (operation) => {
    const msx = new FixtureMsxConnector()
    const guidance = new FixtureMcemGuidanceConnector()
    const milestones = await msx.listMilestones(request.opportunityId)
    let release!: (value: Milestone[]) => void
    vi.spyOn(msx, 'listMilestones').mockReturnValue(new Promise((resolve) => { release = resolve }))
    const readGuidance = vi.spyOn(guidance, 'getStageGuidance')
    const invoke = vi.fn(async () => 'Grounded MCEM guidance.')
    const core = new ThinSliceOrchestrator(msx, guidance, { 'mcem-coach': { version: 'test', agent: { invoke } } })
    const result = operation === 'agent' ? core.runAgentTask(request) : core.runMcemCoach(request)
    try {
      await vi.waitFor(() => expect(readGuidance).toHaveBeenCalledWith(3))
      expect(invoke).not.toHaveBeenCalled()
    } finally {
      release(milestones)
    }
    await expect(result).resolves.toMatchObject({ capability: 'mcem-coach' })
  })

  it('reports the previously unmeasured milestone phase and end-to-end agent duration without content', async () => {
    const events: PerformanceEvent[] = []
    const core = new ThinSliceOrchestrator(new FixtureMsxConnector(), new FixtureMcemGuidanceConnector(), {
      'mcem-coach': { version: 'test', agent: { invoke: async () => 'Grounded MCEM guidance.' } }
    }, (event) => events.push(event))

    await core.runAgentTask(request)
    expect(events.map((event) => event.operation)).toEqual(expect.arrayContaining([
      'agent.context.msx', 'agent.context.milestones', 'agent.context.mcem', 'agent.invoke.mcem-coach', 'agent.task.mcem-coach'
    ]))
    expect(events.at(-1)).toMatchObject({ operation: 'agent.task.mcem-coach', outcome: 'success' })
    for (const event of events) expect(Object.keys(event).sort()).toEqual(['durationMs', 'operation', 'outcome'])
  })

  it('reports failures and does not invoke the model if context preparation fails', async () => {
    const msx = new FixtureMsxConnector()
    vi.spyOn(msx, 'listMilestones').mockRejectedValue(new Error('Milestone access denied.'))
    const events: PerformanceEvent[] = []
    const invoke = vi.fn()
    const core = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), {
      'mcem-coach': { version: 'test', agent: { invoke } }
    }, (event) => events.push(event))

    await expect(core.runAgentTask(request)).rejects.toThrow('Milestone access denied.')
    expect(invoke).not.toHaveBeenCalled()
    expect(events).toContainEqual(expect.objectContaining({ operation: 'agent.context.milestones', outcome: 'failure' }))
    expect(events.at(-1)).toMatchObject({ operation: 'agent.task.mcem-coach', outcome: 'failure' })
  })

  it('checks account ownership before loading more context or invoking a model', async () => {
    const msx = new FixtureMsxConnector()
    const milestones = vi.spyOn(msx, 'listMilestones')
    const guidance = new FixtureMcemGuidanceConnector()
    const readGuidance = vi.spyOn(guidance, 'getStageGuidance')
    const invoke = vi.fn()
    const core = new ThinSliceOrchestrator(msx, guidance, { 'mcem-coach': { version: 'test', agent: { invoke } } })

    await expect(core.runAgentTask({ ...request, accountId: 'other-account' })).rejects.toThrow('does not belong')
    expect(milestones).not.toHaveBeenCalled()
    expect(readGuidance).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})
