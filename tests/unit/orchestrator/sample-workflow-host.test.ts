import { describe, expect, it, vi } from 'vitest'
import { createSampleWorkflowHost, initialWorkflowIds, initialWorkflowOutputSchema } from '../../../packages/orchestrator/workflows/index.js'

describe('sample workflow host', () => {
    it('completes WF-001 without delegated MCP access', async () => {
        const host = createSampleWorkflowHost()
        const started = host.start({
            contractVersion: '1.0',
            workflowId: 'WF-001',
            scope: { kind: 'portfolio' },
            input: { asOf: '2026-09-13', staleAfterDays: 30 }
        })
        await vi.waitFor(() => {
            expect(host.get({ contractVersion: '1.0', runId: started.runId }).run.status).toBe('completed')
        })
        const view = host.get({ contractVersion: '1.0', runId: started.runId })
        const output = initialWorkflowOutputSchema.parse(view.output)

        expect(view.run).toMatchObject({ status: 'completed', state: 'complete' })
        expect(output.card).toMatchObject({
            kind: 'record-table',
            rows: expect.arrayContaining([expect.objectContaining({ id: 'opp-grid-modernization' })])
        })
        expect(output.sourceHealth.every(({ state }) => state === 'sample')).toBe(true)
    })

    it.each(initialWorkflowIds)('completes %s from sanitized sample sources', async (workflowId) => {
        const host = createSampleWorkflowHost()
        const started = host.start({
            contractVersion: '1.0',
            workflowId,
            scope: { kind: 'portfolio' },
            input: { asOf: '2026-09-13' }
        })

        await vi.waitFor(() => {
            expect(host.get({ contractVersion: '1.0', runId: started.runId }).run.status).toBe('completed')
        })
        const view = host.get({ contractVersion: '1.0', runId: started.runId })

        expect(view.run.state).toBe('complete')
        expect(initialWorkflowOutputSchema.parse(view.output).workflowId).toBe(workflowId)
    })
})