import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { evaluateMcemProgress } from '../../../packages/agents/mcem-coach/index.js'
import { agentTaskResponseSchema, contractVersion, mcemResponseSchema, type AgentCapability } from '../../../packages/common/index.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import {
  ThinSliceOrchestrator,
  type AgentTaskContext,
  type TaskAgentRegistry
} from '../../../packages/orchestrator/index.js'

const mcemConnector = () => new LocalPdfMcemGuidanceConnector(resolve('docs/knowledge/MCEM Overview.pdf'))

describe('MCEM Coach thin slice', () => {
  it('provides a sample portfolio across recorded Stages 1 through 4 with explicit criterion evidence', async () => {
    const connector = new FixtureMsxConnector()
    const accounts = await connector.listAccounts()
    const opportunities = (await Promise.all(accounts.map((account) => connector.listOpportunities(account.id)))).flat()

    expect(accounts).toHaveLength(2)
    expect(opportunities).toHaveLength(12)
    expect(new Set(opportunities.map((opportunity) => opportunity.recordedStage))).toEqual(new Set([1, 2, 3, 4]))

    for (const opportunity of opportunities) {
      const context = await connector.getOpportunityContext(opportunity.id)
      const statuses = new Set(context.observations.map((observation) => observation.status))
      expect(context.observations.length).toBeGreaterThanOrEqual(4)
      expect(statuses.has('met')).toBe(true)
    }
  })

  it.each([
    ['account-contoso', 'opp-resilient-cloud-foundation', 1, 2],
    ['account-fabrikam', 'opp-customer-data-platform', 2, 3],
    ['account-contoso', 'opp-predictive-maintenance-scale', 3, 4],
    ['account-fabrikam', 'opp-ai-store-operations', 4, 5]
  ])('shows %s / %s as ready to progress from Stage %i to Stage %i', async (accountId, opportunityId, recordedStage, supportedStage) => {
    const orchestrator = new ThinSliceOrchestrator(new FixtureMsxConnector(), mcemConnector())

    const result = await orchestrator.runMcemCoach({
      contractVersion,
      accountId,
      opportunityId,
      prompt: 'Is this opportunity ready to advance?'
    })

    expect(result.recordedStage).toBe(recordedStage)
    expect(result.evidenceBasedStage).toBe(supportedStage)
    expect(result.criteria.every((criterion) => criterion.status === 'met')).toBe(true)
    expect(result.missingData).toEqual([])
    expect(result.recommendations).toEqual([
      expect.objectContaining({
        id: 'recommendation-advance-stage',
        ownerRole: 'Account Executive',
        action: expect.stringContaining(`advance the opportunity to Stage ${supportedStage}`)
      })
    ])
  })

  it('keeps complete evidence capped at Stage 5', async () => {
    const connector = new FixtureMsxConnector()
    const context = await connector.getOpportunityContext('opp-ai-store-operations')
    const guidance = await mcemConnector().getStageGuidance(5)
    const result = evaluateMcemProgress({
      ...context,
      opportunity: { ...context.opportunity, recordedStage: 5 }
    }, guidance, '00000000-0000-4000-8000-000000000005')

    expect(result.evidenceBasedStage).toBe(5)
    expect(result.recommendations).toEqual([
      expect.objectContaining({
        id: 'recommendation-advance-stage',
        action: 'Continue validating value realization and maintain current evidence in MSX.'
      })
    ])
  })

  it('builds the automatic diagnostic locally without invoking a task agent', async () => {
    const invoke = vi.fn()
    const orchestrator = new ThinSliceOrchestrator(
      new FixtureMsxConnector(),
      mcemConnector(),
      { 'mcem-coach': { version: 'test-v1', agent: { invoke } } }
    )

    const result = await orchestrator.runMcemCoach({
      contractVersion,
      accountId: 'account-contoso',
      opportunityId: 'opp-grid-modernization',
      prompt: 'How do we move this opportunity to the next MCEM stage?'
    })

    expect(invoke).not.toHaveBeenCalled()
    expect(result).toMatchObject({ recordedStage: 3, evidenceBasedStage: 2 })
  })

  it('returns evidence-based divergence, owner actions, citations, and sample states', async () => {
    const orchestrator = new ThinSliceOrchestrator(
      new FixtureMsxConnector(),
      mcemConnector()
    )

    const result = await orchestrator.runMcemCoach({
      contractVersion,
      accountId: 'account-contoso',
      opportunityId: 'opp-grid-modernization',
      prompt: 'How do we move this opportunity to the next MCEM stage?'
    })

    expect(mcemResponseSchema.safeParse(result).success).toBe(true)
    expect(result.recordedStage).toBe(3)
    expect(result.evidenceBasedStage).toBe(2)
    expect(result.recommendations.map((recommendation) => recommendation.ownerRole)).toEqual(
      expect.arrayContaining(['Specialist / SSP', 'Account Executive'])
    )
    expect(result.recommendations.every((recommendation) => recommendation.evidenceIds.length > 0)).toBe(true)
    expect(result.evidence.map((evidence) => evidence.source)).toEqual(['msx', 'mcem'])
    expect(result.sourceHealth.map((source) => source.state)).toEqual(['sample', 'partial'])
    expect(result.evidence[1]?.url).toBeUndefined()
    expect('write' in orchestrator).toBe(false)
  })

  it('returns contract-valid evidence when live MSX has no criterion observations', async () => {
    const guidance = await mcemConnector().getStageGuidance(1)
    const result = evaluateMcemProgress({
      account: { id: 'account-live', name: 'Live account', segment: 'Live MSX' },
      opportunity: {
        id: 'opportunity-live',
        accountId: 'account-live',
        name: 'Live opportunity',
        recordedStage: 1,
        value: 0,
        currency: 'USD',
        closeDate: '2028-07-31'
      },
      observations: [],
      retrievedAt: '2026-08-24T00:00:00.000Z',
      sourceHealth: {
        source: 'msx',
        state: 'live',
        detail: 'Live MSX opportunity context loaded.',
        checkedAt: '2026-08-24T00:00:00.000Z'
      }
    }, guidance, '00000000-0000-4000-8000-000000000001')

    expect(mcemResponseSchema.safeParse(result).success).toBe(true)
    expect(result.evidence[0]?.excerpt).toBe('No criterion-level observations were available from MSX for this opportunity.')
  })

  it.each([
    'account-pulse',
    'mcem-coach',
    'pursuit-executive',
    'risk-solution-play'
  ] satisfies AgentCapability[])('routes %s through a versioned agent task response', async (capability) => {
    const invocations: AgentTaskContext[] = []
    const taskAgents: TaskAgentRegistry = {
      [capability]: {
        version: 'test-v2',
        agent: {
          invoke: async (context: AgentTaskContext) => {
            invocations.push(context)
            return `Grounded synthesis from ${capability}`
          }
        }
      }
    }
    const orchestrator = new ThinSliceOrchestrator(
      new FixtureMsxConnector(),
      mcemConnector(),
      taskAgents
    )

    const result = await orchestrator.runAgentTask({
      contractVersion,
      capability,
      accountId: 'account-contoso',
      opportunityId: 'opp-grid-modernization',
      prompt: 'Analyze the selected opportunity.'
    })

    expect(agentTaskResponseSchema.safeParse(result).success).toBe(true)
    expect(result).toMatchObject({
      capability,
      agentVersion: 'test-v2',
      mode: 'sample',
      state: 'partial',
      content: `**MSX Opportunity:** [Open opportunity in MSX](https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=opp-grid-modernization)\nGrounded synthesis from ${capability}`,
      sourceHealth: [
        expect.objectContaining({ source: 'msx', state: 'sample' }),
        expect.objectContaining({ source: 'mcem', state: 'partial' })
      ]
    })
    expect(invocations[0]).toMatchObject({
      request: { capability },
      opportunityContext: { opportunity: { id: 'opp-grid-modernization' } },
      guidance: { stage: 3 },
      localEvaluation: { evidenceBasedStage: 2 }
    })
  })

  it('places a clickable MSX opportunity link after the account line', async () => {
    const orchestrator = new ThinSliceOrchestrator(
      new FixtureMsxConnector(),
      mcemConnector(),
      {
        'account-pulse': {
          version: 'test-v2',
          agent: {
            invoke: async () => '# Account Pulse\n**Opportunity:** Grid modernization\n**Account:** Contoso\n**Recorded / evidence-based stage:** 3 / 2'
          }
        }
      }
    )

    const result = await orchestrator.runAgentTask({
      contractVersion,
      capability: 'account-pulse',
      accountId: 'account-contoso',
      opportunityId: 'opp-grid-modernization',
      prompt: 'Analyze the selected opportunity.'
    })

    expect(result.content.split('\n')).toEqual([
      '# Account Pulse',
      '**Opportunity:** Grid modernization',
      '**Account:** Contoso',
      '**MSX Opportunity:** [Open opportunity in MSX](https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=opp-grid-modernization)',
      '**Recorded / evidence-based stage:** 3 / 2'
    ])
  })
})