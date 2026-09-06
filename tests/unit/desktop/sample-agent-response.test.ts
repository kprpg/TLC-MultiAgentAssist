import { describe, expect, it } from 'vitest'
import { buildSampleAgentResponse } from '../../../apps/desktop/electron/main/sample-agent-response.js'
import type { AgentTaskContext } from '../../../packages/orchestrator/index.js'

const context = {
    opportunityContext: {
        account: { id: 'account-contoso', name: 'Contoso Energy', segment: 'Strategic' },
        opportunity: {
            id: 'opp-cloud-security-readiness',
            accountId: 'account-contoso',
            name: 'Cloud security readiness',
            recordedStage: 1,
            value: 900000,
            currency: 'USD',
            closeDate: '2027-02-26'
        },
        observations: [],
        retrievedAt: '2026-08-24T00:00:00.000Z',
        sourceHealth: { source: 'msx', state: 'sample', detail: 'Sample data.', checkedAt: '2026-08-24T00:00:00.000Z' }
    },
    guidance: {
        stage: 1,
        title: 'MCEM Stage 1 overview guidance',
        version: 'sample-1',
        effectiveDate: '2026-08-24',
        criteria: [],
        sourceHealth: { source: 'mcem', state: 'partial', detail: 'Local snapshot.', checkedAt: '2026-08-24T00:00:00.000Z' }
    },
    localEvaluation: {
        summary: 'The available evidence supports recorded Stage 1.',
        evidenceBasedStage: 1,
        criteria: [
            { id: 'budget', label: 'Budget availability', status: 'met', rationale: 'Funding is approved.', evidenceIds: ['msx-1'] },
            { id: 'approval', label: 'Approval process', status: 'missing', rationale: 'Sponsor is unknown.', evidenceIds: ['msx-1'] }
        ],
        recommendations: [
            { ownerRole: 'Account Executive', action: 'Identify the approval path.', confidence: 'high' }
        ],
        missingData: ['Approval process']
    }
} as unknown as AgentTaskContext

describe('sample agent response', () => {
    it('grounds capability guidance in the selected opportunity, criteria, and actions', () => {
        const response = buildSampleAgentResponse('account-pulse', context)

        expect(response).toContain('Focus this week on Cloud security readiness')
        expect(response).toContain('**Recorded / evidence-based stage:** 1 / 1')
        expect(response).toContain('**Budget availability: met**')
        expect(response).toContain('**Approval process: missing**')
        expect(response).toContain('| Account Executive | Identify the approval path. | high |')
        expect(response).toContain('Approval process')
    })

    it('describes complete current-stage evidence as advancement readiness', () => {
        const readyContext = structuredClone(context) as AgentTaskContext
        readyContext.localEvaluation.evidenceBasedStage = 2
        readyContext.localEvaluation.criteria = [
            { id: 'budget', label: 'Budget availability', status: 'met', rationale: 'Funding is approved.', evidenceIds: ['msx-1'] }
        ]
        readyContext.localEvaluation.missingData = []

        const response = buildSampleAgentResponse('account-pulse', readyContext)

        expect(response).toContain('confirming progression of Cloud security readiness to Stage 2')
        expect(response).toContain('all current-stage exit criteria are supported')
        expect(response).not.toContain('evidence gaps')
    })
})