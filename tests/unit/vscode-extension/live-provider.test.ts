import { describe, expect, it } from 'vitest'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { createSampleWorkflowHost } from '../../../packages/orchestrator/workflows/index.js'
import type { AgentCapability } from '../../../packages/common/index.js'
import { buildLiveDataProvider, buildLiveTaskAgents } from '../../../apps/vscode-extension/src/live-provider-core.js'
import { ExtensionMcemGuidanceConnector } from '../../../apps/vscode-extension/src/mcem-guidance.js'
import type { ExtensionDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'

const CAPABILITIES: readonly AgentCapability[] = ['account-pulse', 'mcem-coach', 'pursuit-executive', 'risk-solution-play']

function makeLiveProvider(): ExtensionDataProvider {
    const orchestrator = new ThinSliceOrchestrator(
        new FixtureMsxConnector(),
        new ExtensionMcemGuidanceConnector(),
        buildLiveTaskAgents()
    )
    return buildLiveDataProvider({
        orchestrator,
        host: createSampleWorkflowHost(),
        account: 'seller@contoso.com',
        dispose: async () => { /* nothing to dispose in the fixture wiring */ }
    })
}

async function firstOpportunity(provider: ExtensionDataProvider): Promise<{ accountId: string; opportunityId: string }> {
    const account = (await provider.listAccounts())[0]
    if (!account) throw new Error('Expected at least one fixture account.')
    const opportunity = (await provider.listOpportunities(account.id))[0]
    if (!opportunity) throw new Error('Expected at least one fixture opportunity.')
    return { accountId: account.id, opportunityId: opportunity.id }
}

describe('live data provider (Desktop/Web parity)', () => {
    it('reports live mode and the signed-in account', async () => {
        const provider = makeLiveProvider()
        expect(provider.mode).toBe('live')
        expect(await provider.getCurrentUserEmail()).toBe('seller@contoso.com')
    })

    it('runs MCEM Coach over live context instead of gating it', async () => {
        const provider = makeLiveProvider()
        const { accountId, opportunityId } = await firstOpportunity(provider)
        const evaluation = await provider.runMcemCoach(accountId, opportunityId)
        expect(evaluation.criteria.length).toBeGreaterThan(0)
        expect(evaluation.recordedStage).toBeGreaterThanOrEqual(1)
    })

    it('produces agent guidance for every capability instead of gating it', async () => {
        const provider = makeLiveProvider()
        const { accountId, opportunityId } = await firstOpportunity(provider)
        for (const capability of CAPABILITIES) {
            const response = await provider.runAgentTask(capability, accountId, opportunityId, 'What should we do next?')
            expect(response.capability).toBe(capability)
            expect(response.agentVersion).toBe('guidance-live-v1')
            expect(response.content).toContain('## Summary')
            expect(response.content).toContain('## Recommended actions')
        }
    })

    it('performs milestone writes through the orchestrator instead of gating them', async () => {
        const provider = makeLiveProvider()
        for (const account of await provider.listAccounts()) {
            for (const opportunity of await provider.listOpportunities(account.id)) {
                const milestone = (await provider.listMilestones(opportunity.id))[0]
                if (!milestone) continue
                const updated = await provider.updateMilestone(opportunity.id, milestone.id, { comments: 'Reviewed with the customer.' })
                expect(updated.comments).toContain('Reviewed with the customer.')
                return
            }
        }
        throw new Error('Expected at least one fixture milestone to update.')
    })

    it('lists Plays through the workflow host', async () => {
        const provider = makeLiveProvider()
        const definitions = await provider.listWorkflowDefinitions()
        expect(definitions.length).toBeGreaterThan(0)
    })
})
