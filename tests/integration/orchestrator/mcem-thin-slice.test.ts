import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateMcemProgress } from '../../../packages/agents/mcem-coach/index.js'
import { contractVersion, mcemResponseSchema } from '../../../packages/common/index.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'

const mcemConnector = () => new LocalPdfMcemGuidanceConnector(resolve('docs/knowledge/MCEM Overview.pdf'))

describe('MCEM Coach thin slice', () => {
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
      expect.arrayContaining(['Specialist', 'Account Executive'])
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
})