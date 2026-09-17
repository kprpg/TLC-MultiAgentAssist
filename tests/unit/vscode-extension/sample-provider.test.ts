import { describe, expect, it } from 'vitest'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import {
    buildSampleAgentResponse,
    buildSampleEvaluation,
    findSampleOpportunity,
    listSampleAccounts,
    listSampleMilestones,
    listSampleOpportunities
} from '../../../apps/vscode-extension/src/sample-data.js'

describe('vscode-extension sample data', () => {
    it('lists sanitized accounts and opportunities', () => {
        const accounts = listSampleAccounts()
        expect(accounts.length).toBeGreaterThan(0)
        const opportunities = listSampleOpportunities(accounts[0]!.id)
        expect(opportunities.every((opportunity) => opportunity.accountId === accounts[0]!.id)).toBe(true)
    })

    it('gives each opportunity several distinct milestones', () => {
        const opportunity = findSampleOpportunity('opp-grid-modernization')!
        const milestones = listSampleMilestones(opportunity.id)
        expect(milestones.length).toBeGreaterThanOrEqual(3)
        expect(new Set(milestones.map((milestone) => milestone.id)).size).toBe(milestones.length)
        expect(new Set(milestones.map((milestone) => milestone.name)).size).toBe(milestones.length)
        expect(milestones.every((milestone) => milestone.opportunityId === opportunity.id)).toBe(true)
    })

    it('builds a schema-valid MCEM evaluation', () => {
        const opportunity = findSampleOpportunity('opp-resilient-cloud-foundation')!
        const evaluation = buildSampleEvaluation(opportunity, () => '2026-09-15T00:00:00.000Z')
        expect(evaluation.state).toBe('complete')
        expect(evaluation.criteria.length).toBe(5)
    })

    it('builds a schema-valid agent response', () => {
        const opportunity = findSampleOpportunity('opp-grid-modernization')!
        const response = buildSampleAgentResponse('account-pulse', opportunity, 'What next?', () => '2026-09-15T00:00:00.000Z')
        expect(response.mode).toBe('sample')
        expect(response.content).toContain('## Summary')
        expect(response.content).toContain('## Recommended actions')
        expect(response.content).toContain(opportunity.name)
    })
})

describe('vscode-extension sample data provider', () => {
    it('runs a workflow to completion through the shared sample host', async () => {
        const provider = createSampleDataProvider()
        const run = await provider.startWorkflow({ workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: { asOf: '2026-09-15' } })
        let view = await provider.getWorkflowRun(run.runId)
        for (let attempt = 0; attempt < 50 && view.run.status !== 'completed'; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 10))
            view = await provider.getWorkflowRun(run.runId)
        }
        expect(view.run.status).toBe('completed')
        expect(view.output?.card).toBeDefined()
        await provider.dispose()
    })

    it('prepares a guidance handoff from a scoped queue item', async () => {
        const provider = createSampleDataProvider()
        const run = await provider.startWorkflow({ workflowId: 'WF-002', scope: { kind: 'portfolio' }, input: { asOf: '2026-09-15' } })
        let view = await provider.getWorkflowRun(run.runId)
        for (let attempt = 0; attempt < 50 && view.run.status !== 'completed'; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 10))
            view = await provider.getWorkflowRun(run.runId)
        }
        const item = view.output!.queueItems[0]!
        const handoff = await provider.prepareWorkflowGuidance(run.runId, item.id, 'mcem-coach')
        expect(handoff.capability).toBe('mcem-coach')
        expect(handoff.scope).toMatchObject({ kind: 'opportunity' })
        expect(handoff.scope.accountId.length).toBeGreaterThan(0)
        expect(handoff.scope.opportunityId.length).toBeGreaterThan(0)
        expect(handoff.context.evidenceIds.length).toBeGreaterThan(0)
        await provider.dispose()
    })

    it('advances a ready-to-advance opportunity and persists the stage', async () => {
        const provider = createSampleDataProvider()
        const result = await provider.transitionOpportunityStage('account-contoso', 'opp-resilient-cloud-foundation', 2)
        expect(result.disposition).toBe('advanced')
        expect(result.targetStage).toBe(2)
        expect(result.opportunity.recordedStage).toBe(2)
        const reloaded = (await provider.listOpportunities('account-contoso')).find((item) => item.id === 'opp-resilient-cloud-foundation')
        expect(reloaded?.recordedStage).toBe(2)
        await provider.dispose()
    })

    it('requires a reason to recycle a stage', async () => {
        const provider = createSampleDataProvider()
        await expect(provider.transitionOpportunityStage('account-contoso', 'opp-grid-modernization', 2)).rejects.toThrow()
        await provider.dispose()
    })

    it('updates and persists a milestone field', async () => {
        const provider = createSampleDataProvider()
        const target = (await provider.listMilestones('opp-ai-service'))[0]!
        const updated = await provider.updateMilestone('opp-ai-service', target.id, { status: 'Completed' })
        expect(updated.status).toBe('Completed')
        const reloaded = (await provider.listMilestones('opp-ai-service')).find((item) => item.id === target.id)
        expect(reloaded?.status).toBe('Completed')
        await provider.dispose()
    })

    it('updates opportunity comments', async () => {
        const provider = createSampleDataProvider()
        const updated = await provider.updateOpportunity('opp-ai-service', { comments: 'Reviewed with the account executive.' })
        expect(updated.comments).toBe('Reviewed with the account executive.')
        await provider.dispose()
    })
})
