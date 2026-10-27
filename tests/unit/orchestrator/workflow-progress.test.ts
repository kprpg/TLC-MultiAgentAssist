import { describe, expect, it, vi } from 'vitest'
import {
    InitialWorkflowResultAssembler, SharedWorkflowHost, WorkflowRegistry, WorkflowRuntime, initialWorkflowDefinitions,
    type WorkflowConnectorExecutionContext, type WorkflowConnectorExecutor, type WorkflowConnectorResult
} from '../../../packages/orchestrator/workflows/index.js'

function result(count: number, partial = true): WorkflowConnectorResult {
    return {
        state: partial ? 'partial' : 'complete',
        data: Array.from({ length: count }, (_, index) => ({
            id: `opp-${index}`, accountId: 'account-1', name: `Opportunity ${index}`, closeDate: '2026-08-01'
        })),
        rowCount: count, truncated: partial,
        lineage: { connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'page-evidence' },
        sourceHealth: {
            source: 'dataverse-mcp', state: partial ? 'partial' : 'live', detail: 'Delegated fixture rows.',
            checkedAt: '2026-10-24T10:00:00.000Z'
        }
    }
}

function harness(execute: WorkflowConnectorExecutor['execute'], onStepError = vi.fn()) {
    const definition = initialWorkflowDefinitions.find((definition) => definition.id === 'WF-001')!
    const registry = new WorkflowRegistry([{
        ...definition, connectorPlan: [{ connector: 'dataverse-mcp', operation: 'read_query', required: true }]
    }])
    const runtime = new WorkflowRuntime(registry, { execute }, { resultAssembler: new InitialWorkflowResultAssembler(), onStepError })
    const host = new SharedWorkflowHost(registry, runtime)
    const run = host.start({ contractVersion: '1.0', workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: { asOf: '2026-10-24' } })
    return { runtime, host, run, read: () => host.get({ contractVersion: '1.0', runId: run.runId }) }
}

describe('workflow page progress', () => {
    it('publishes validated partial output before the connector finishes and replaces it without duplicate steps', async () => {
        let release!: (value: WorkflowConnectorResult) => void
        const execute: WorkflowConnectorExecutor['execute'] = async (_step, context) => {
            context.onProgress?.(result(20))
            return new Promise((resolve) => { release = resolve })
        }
        const { runtime, run, read } = harness(execute)
        await vi.waitFor(() => expect(read().output?.queueItems).toHaveLength(20))
        const first = read()
        expect(first.run).toMatchObject({ status: 'running', telemetry: { firstResultMs: expect.any(Number) } })
        expect(first.run).not.toHaveProperty('state')
        expect(first.output?.sourceHealth[0]?.state).toBe('partial')

        release(result(25, false))
        await runtime.wait(run.runId)

        expect(read().run).toMatchObject({ status: 'completed', state: 'complete' })
        expect(read().output?.queueItems).toHaveLength(25)
        expect(first.output?.queueItems).toHaveLength(20)
        expect(runtime.getResult(read().run.resultRef!)?.steps).toHaveLength(1)
    })

    it('cannot overwrite cancellation with a late page or late completion', async () => {
        let context!: WorkflowConnectorExecutionContext
        let release!: (value: WorkflowConnectorResult) => void
        const { runtime, host, run, read } = harness(async (_step, execution) => {
            context = execution
            context.onProgress?.(result(20))
            return new Promise((resolve) => { release = resolve })
        })
        await vi.waitFor(() => expect(read().output?.queueItems).toHaveLength(20))
        host.cancel({ contractVersion: '1.0', runId: run.runId })
        const cancelled = read()

        context.onProgress?.(result(40))
        release(result(50, false))
        await runtime.wait(run.runId)
        await Promise.resolve()

        expect(read()).toEqual(cancelled)
        expect(read().run.status).toBe('cancelled')
        expect(() => host.prepareGuidance({
            contractVersion: '1.0', runId: run.runId, queueItemId: 'WF-001:opp-0', capability: 'account-pulse'
        })).toThrow('completed workflow result')
    })

    it('keeps failed runs visibly failed while retaining only the already published incomplete data', async () => {
        const onStepError = vi.fn()
        const { runtime, run, read } = harness(async (_step, context) => {
            context.onProgress?.(result(20))
            throw new Error('Source failed.')
        }, onStepError)
        await runtime.wait(run.runId)

        expect(read().run.status).toBe('failed')
        expect(read().output?.queueItems).toHaveLength(20)
        expect(read().output?.sourceHealth[0]?.state).toBe('partial')
        expect(onStepError).toHaveBeenCalledWith(expect.objectContaining({ required: true, message: 'Source failed.' }))
    })

    it('does not retain earlier page data after a required source revokes access', async () => {
        const { runtime, run, read } = harness(async (_step, context) => {
            context.onProgress?.(result(20))
            return {
                ...result(0), state: 'unauthorized',
                sourceHealth: { source: 'dataverse-mcp', state: 'unauthorized', detail: 'Access unavailable.', checkedAt: '2026-10-24T10:00:00.000Z' }
            }
        })
        await runtime.wait(run.runId)

        expect(read().run).toMatchObject({ status: 'completed', state: 'unauthorized' })
        expect(read().output?.queueItems).toEqual([])
    })

    it('clears earlier page data when a required connector throws a permission failure', async () => {
        const { runtime, run, read } = harness(async (_step, context) => {
            context.onProgress?.(result(20))
            throw Object.assign(new Error('Access revoked.'), { code: 'scope_denied' })
        })
        await runtime.wait(run.runId)

        expect(read().run).toMatchObject({ status: 'completed', state: 'unauthorized' })
        expect(read().output?.queueItems).toEqual([])
        expect(read().output?.sourceHealth[0]?.state).toBe('unauthorized')
    })
})
