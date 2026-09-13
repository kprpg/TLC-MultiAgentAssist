import { describe, expect, it, vi } from 'vitest'
import {
    WorkflowRegistry,
    WorkflowRuntime,
    WorkflowRuntimeError,
    type WorkflowConnectorExecutor,
    type WorkflowConnectorResult
} from '../../../packages/orchestrator/workflows/index.js'
import type { WorkflowDefinition } from '../../../packages/common/index.js'

const runId = '11111111-1111-4111-8111-111111111111'
const correlationId = '22222222-2222-4222-8222-222222222222'
const scope = { kind: 'portfolio' as const }

function definition(
    steps: WorkflowDefinition['connectorPlan'],
    executionMode: WorkflowDefinition['executionMode'] = 'deterministic'
): WorkflowDefinition {
    return {
        contractVersion: '1.0', id: 'WF-001', name: 'Pipeline review', version: '1.0.0', scope: 'portfolio',
        personaTargets: ['AE'], category: 'portfolio-hygiene', executionMode, connectorPlan: steps,
        inputSchemaRef: 'wf-001.input.v1', outputSchemaRef: 'wf-001.output.v1',
        sla: { targetMs: 1_000, timeoutMs: 5_000 },
        auth: { requiresDelegatedUser: true, allowedWrite: false },
        ui: { cardStyle: 'record-table', resultPriority: 'high', showInQuickLaunch: true }
    }
}

function runtime(steps: WorkflowDefinition['connectorPlan'], execute: WorkflowConnectorExecutor['execute'], options = {}) {
    const ids = [runId, correlationId]
    return new WorkflowRuntime(new WorkflowRegistry([definition(steps)]), { execute }, {
        createId: () => ids.shift()!,
        ...options
    })
}

describe('workflow runtime', () => {
    it('runs connector steps in declared order and records metadata plus first-result timing', async () => {
        let now = Date.parse('2026-09-12T10:00:00.000Z')
        const execute = vi.fn<WorkflowConnectorExecutor['execute']>().mockImplementation(async (step) => {
            now += 10
            return { state: 'complete', data: { operation: step.operation }, rowCount: 1, truncated: false }
        })
        const engine = runtime([
            { connector: 'dataverse-mcp', operation: 'read_query', required: true },
            { connector: 'msx-mcp', operation: 'list_pipeline', required: false }
        ], execute, {
            now: () => now,
            resultAssembler: { assemble: ({ steps }: { steps: unknown[] }) => ({ stepCount: steps.length }) }
        })

        const queued = engine.start({ workflowId: 'WF-001', scope, correlationId })
        expect(queued.status).toBe('queued')
        const completed = await engine.wait(runId)

        expect(execute.mock.calls.map(([step]) => step.connector)).toEqual(['dataverse-mcp', 'msx-mcp'])
        expect(completed).toMatchObject({
            status: 'completed', state: 'complete',
            telemetry: { correlationId, cacheHit: false, firstResultMs: 10 }
        })
        expect(completed.connectorCalls).toEqual([
            { connector: 'dataverse-mcp', operation: 'read_query', status: 'success', durationMs: 10, recordCount: 1, truncated: false },
            { connector: 'msx-mcp', operation: 'list_pipeline', status: 'success', durationMs: 10, recordCount: 1, truncated: false }
        ])
        expect(engine.getResult(completed.resultRef!)?.steps).toHaveLength(2)
        expect(engine.getResult(completed.resultRef!)?.output).toEqual({ stepCount: 2 })
        expect(completed).not.toHaveProperty('data')
    })

    it('completes partial when optional connectors fail or return partial data', async () => {
        const execute = vi.fn<WorkflowConnectorExecutor['execute']>()
            .mockResolvedValueOnce({ state: 'complete', data: ['required'], rowCount: 1, truncated: false })
            .mockRejectedValueOnce(new Error('optional unavailable'))
            .mockResolvedValueOnce({ state: 'partial', data: ['limited'], rowCount: 1, truncated: true })
        const engine = runtime([
            { connector: 'msx-mcp', operation: 'list_pipeline', required: true },
            { connector: 'dataverse-mcp', operation: 'read_query', required: false },
            { connector: 'msx-mcp', operation: 'list_activities', required: false }
        ], execute)

        const completed = await engine.wait(engine.start({ workflowId: 'WF-001', scope }).runId)

        expect(completed.status).toBe('completed')
        expect(completed.state).toBe('partial')
        expect(completed.connectorCalls.map(({ status }) => status)).toEqual(['success', 'failed', 'partial'])
    })

    it('fails on a required connector error and stops the plan', async () => {
        const execute = vi.fn<WorkflowConnectorExecutor['execute']>().mockRejectedValue(new Error('offline'))
        const engine = runtime([
            { connector: 'msx-mcp', operation: 'list_pipeline', required: true },
            { connector: 'dataverse-mcp', operation: 'read_query', required: false }
        ], execute)

        const failed = await engine.wait(engine.start({ workflowId: 'WF-001', scope }).runId)
        expect(failed.status).toBe('failed')
        expect(failed.connectorCalls).toHaveLength(1)
        expect(execute).toHaveBeenCalledTimes(1)
    })

    it.each(['tool_denied', 'scope_required'])('completes unauthorized when a required connector reports %s', async (code) => {
        const denied = Object.assign(new Error('denied'), { code })
        const engine = runtime([{ connector: 'msx-mcp', operation: 'list_pipeline', required: true }],
            vi.fn<WorkflowConnectorExecutor['execute']>().mockRejectedValue(denied))

        const completed = await engine.wait(engine.start({ workflowId: 'WF-001', scope }).runId)
        expect(completed).toMatchObject({ status: 'completed', state: 'unauthorized' })
        expect(completed.connectorCalls[0]?.status).toBe('unauthorized')
    })

    it('cancels queued and running work without allowing late completion to overwrite it', async () => {
        let release!: (result: WorkflowConnectorResult) => void
        const pending = new Promise<WorkflowConnectorResult>((resolve) => { release = resolve })
        const execute = vi.fn<WorkflowConnectorExecutor['execute']>().mockReturnValue(pending)
        const engine = runtime([{ connector: 'msx-mcp', operation: 'list_pipeline', required: true }], execute)

        const queued = engine.start({ workflowId: 'WF-001', scope })
        const cancelled = engine.cancel(queued.runId)
        expect(cancelled.status).toBe('cancelled')
        expect(execute).not.toHaveBeenCalled()

        const secondIds = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']
        const runningEngine = new WorkflowRuntime(new WorkflowRegistry([definition([
            { connector: 'msx-mcp', operation: 'list_pipeline', required: true }
        ])]), { execute }, { createId: () => secondIds.shift()! })
        const running = runningEngine.start({ workflowId: 'WF-001', scope })
        await vi.waitFor(() => expect(runningEngine.get(running.runId)?.status).toBe('running'))
        runningEngine.cancel(running.runId)
        release({ state: 'complete', data: [], rowCount: 0, truncated: false })
        await Promise.resolve()
        expect((await runningEngine.wait(running.runId)).status).toBe('cancelled')
    })

    it('fails a run when the workflow timeout expires', async () => {
        vi.useFakeTimers()
        try {
            const never = new Promise<WorkflowConnectorResult>(() => { })
            const engine = runtime([{ connector: 'msx-mcp', operation: 'list_pipeline', required: true }],
                vi.fn<WorkflowConnectorExecutor['execute']>().mockReturnValue(never))
            const started = engine.start({ workflowId: 'WF-001', scope })
            await vi.advanceTimersByTimeAsync(5_000)
            expect((await engine.wait(started.runId)).status).toBe('failed')
        } finally {
            vi.useRealTimers()
        }
    })

    it('publishes a first-stage result while composite enrichment is still running', async () => {
        let releaseEnrichment!: (result: WorkflowConnectorResult) => void
        const enrichment = new Promise<WorkflowConnectorResult>((resolve) => { releaseEnrichment = resolve })
        const execute = vi.fn<WorkflowConnectorExecutor['execute']>()
            .mockResolvedValueOnce({ state: 'complete', data: [{ id: 'opp-1' }], rowCount: 1, truncated: false })
            .mockReturnValueOnce(enrichment)
        const ids = [runId, correlationId]
        const engine = new WorkflowRuntime(new WorkflowRegistry([definition([
            { connector: 'dataverse-mcp', operation: 'read_query', required: true },
            { connector: 'msx-mcp', operation: 'list_pipeline', required: false }
        ], 'composite')]), { execute }, {
            createId: () => ids.shift()!,
            resultAssembler: { assemble: ({ steps }) => ({ stepCount: steps.length }) }
        })

        const started = engine.start({ workflowId: 'WF-001', scope })
        await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))

        const progressive = engine.get(started.runId)
        expect(progressive).toMatchObject({ status: 'running', resultRef: expect.any(String) })
        expect(engine.getResult(progressive!.resultRef!)?.output).toEqual({ stepCount: 1 })

        releaseEnrichment({ state: 'complete', data: [], rowCount: 0, truncated: false })
        const completed = await engine.wait(started.runId)
        expect(completed).toMatchObject({ status: 'completed', state: 'complete', resultRef: progressive!.resultRef })
        expect(engine.getResult(completed.resultRef!)?.output).toEqual({ stepCount: 2 })
    })

    it('returns deterministic partial output when optional composite enrichment exceeds the timeout budget', async () => {
        vi.useFakeTimers()
        try {
            const execute = vi.fn<WorkflowConnectorExecutor['execute']>()
                .mockResolvedValueOnce({ state: 'complete', data: [{ id: 'opp-1' }], rowCount: 1, truncated: false })
                .mockReturnValueOnce(new Promise<WorkflowConnectorResult>(() => { }))
            const ids = [runId, correlationId]
            const engine = new WorkflowRuntime(new WorkflowRegistry([definition([
                { connector: 'dataverse-mcp', operation: 'read_query', required: true },
                { connector: 'msx-mcp', operation: 'list_pipeline', required: false }
            ], 'composite')]), { execute }, {
                createId: () => ids.shift()!,
                resultAssembler: { assemble: ({ steps }) => ({ stepCount: steps.length }) }
            })

            const started = engine.start({ workflowId: 'WF-001', scope })
            await vi.advanceTimersByTimeAsync(5_000)

            const completed = await engine.wait(started.runId)
            expect(completed).toMatchObject({ status: 'completed', state: 'partial' })
            expect(completed.connectorCalls.map(({ status }) => status)).toEqual(['success', 'failed'])
            expect(engine.getResult(completed.resultRef!)?.output).toEqual({ stepCount: 2 })
            expect(engine.getResult(completed.resultRef!)?.steps[1]).toMatchObject({
                connector: 'msx-mcp', operation: 'list_pipeline',
                sourceHealth: { state: 'unavailable' }
            })
        } finally {
            vi.useRealTimers()
        }
    })

    it('cancels composite enrichment after publishing the core result without late overwrite', async () => {
        let enrichmentSignal: AbortSignal | undefined
        let releaseEnrichment!: (result: WorkflowConnectorResult) => void
        const enrichment = new Promise<WorkflowConnectorResult>((resolve) => { releaseEnrichment = resolve })
        const execute = vi.fn<WorkflowConnectorExecutor['execute']>()
            .mockResolvedValueOnce({ state: 'complete', data: [{ id: 'opp-1' }], rowCount: 1, truncated: false })
            .mockImplementationOnce((_step, context) => {
                enrichmentSignal = context.signal
                return enrichment
            })
        const ids = [runId, correlationId]
        const engine = new WorkflowRuntime(new WorkflowRegistry([definition([
            { connector: 'dataverse-mcp', operation: 'read_query', required: true },
            { connector: 'msx-mcp', operation: 'list_pipeline', required: false }
        ], 'composite')]), { execute }, {
            createId: () => ids.shift()!,
            resultAssembler: { assemble: ({ steps }) => ({ stepCount: steps.length }) }
        })

        const started = engine.start({ workflowId: 'WF-001', scope })
        await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
        const progressive = engine.get(started.runId)
        expect(engine.getResult(progressive!.resultRef!)?.output).toEqual({ stepCount: 1 })

        const cancelled = engine.cancel(started.runId)
        expect(cancelled.status).toBe('cancelled')
        expect(enrichmentSignal?.aborted).toBe(true)
        releaseEnrichment({ state: 'complete', data: [{ id: 'opp-2' }], rowCount: 1, truncated: false })
        await Promise.resolve()

        expect((await engine.wait(started.runId)).status).toBe('cancelled')
        expect(engine.getResult(progressive!.resultRef!)?.output).toEqual({ stepCount: 1 })
    })

    it('rejects unknown workflows, scope mismatches, and evicts bounded results', async () => {
        const execute = vi.fn<WorkflowConnectorExecutor['execute']>().mockResolvedValue({
            state: 'complete', data: [], rowCount: 0, truncated: false
        })
        const ids = [
            '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
            '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'
        ]
        const engine = new WorkflowRuntime(new WorkflowRegistry([definition([
            { connector: 'msx-mcp', operation: 'list_pipeline', required: true }
        ])]), { execute }, { historyCapacity: 1, createId: () => ids.shift()! })
        expect(() => engine.start({ workflowId: 'WF-999', scope })).toThrow()
        expect(() => engine.start({ workflowId: 'WF-001', scope: { kind: 'account', accountId: 'a' } })).toThrow(WorkflowRuntimeError)

        const first = await engine.wait(engine.start({ workflowId: 'WF-001', scope }).runId)
        const second = await engine.wait(engine.start({ workflowId: 'WF-001', scope }).runId)
        expect(engine.get(first.runId)).toBeUndefined()
        expect(engine.getResult(first.resultRef!)).toBeUndefined()
        expect(engine.get(second.runId)?.status).toBe('completed')
    })
})