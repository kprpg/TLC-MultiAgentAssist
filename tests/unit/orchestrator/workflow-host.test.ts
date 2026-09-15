import { describe, expect, it, vi } from 'vitest'
import type { WorkflowDefinition } from '../../../packages/common/index.js'
import {
    SharedWorkflowHost,
    WorkflowRegistry,
    WorkflowRuntime,
    type WorkflowConnectorExecutor
} from '../../../packages/orchestrator/workflows/index.js'

const contractVersion = '1.0' as const
const runId = '11111111-1111-4111-8111-111111111111'
const correlationId = '22222222-2222-4222-8222-222222222222'
const definition: WorkflowDefinition = {
    contractVersion, id: 'WF-001', name: 'Pipeline review', version: '1.0.0', scope: 'portfolio',
    personaTargets: ['AE'], category: 'portfolio-hygiene', executionMode: 'deterministic',
    connectorPlan: [{ connector: 'dataverse-mcp', operation: 'read_query', required: true }],
    inputSchemaRef: 'wf-001.input.v1', outputSchemaRef: 'wf-001.output.v1',
    sla: { targetMs: 1_000, timeoutMs: 5_000 }, auth: { requiresDelegatedUser: true, allowedWrite: false },
    ui: { cardStyle: 'record-table', resultPriority: 'high', showInQuickLaunch: true }
}

function harness(options: { connectorState?: 'complete' | 'partial'; evidenceIds?: string[] } = {}) {
    const registry = new WorkflowRegistry([definition])
    const executor = {
        execute: vi.fn<WorkflowConnectorExecutor['execute']>().mockResolvedValue({
            state: options.connectorState ?? 'complete', data: [{ secretRawRow: true }], rowCount: 1, truncated: false,
            lineage: { connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'call-1' },
            sourceHealth: { source: 'dataverse-mcp', state: 'live', detail: 'Available.', checkedAt: '2026-09-12T10:00:00.000Z' }
        })
    }
    const ids = [runId, correlationId]
    const runtime = new WorkflowRuntime(registry, executor, {
        createId: () => ids.shift()!,
        resultAssembler: {
            assemble: () => ({
                contractVersion, workflowId: 'WF-001', generatedAt: '2026-09-12T10:00:00.000Z',
                scope: { kind: 'portfolio' },
                card: { kind: 'record-table', title: 'Pipeline review', evidenceIds: ['call-1'], columns: ['Name'], rows: [{ Name: 'Visible' }] },
                queueItems: [{
                    id: 'WF-001:opp-1', workflowId: 'WF-001', priority: 'P1', title: 'Review pipeline item',
                    accountId: 'account-1', opportunityId: 'opp-1', evidenceIds: options.evidenceIds ?? ['call-1'], status: 'new'
                }],
                lineage: [{ connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'call-1' }],
                sourceHealth: [{ source: 'dataverse-mcp', state: 'live', detail: 'Available.', checkedAt: '2026-09-12T10:00:00.000Z' }]
            })
        }
    })
    return { executor, host: new SharedWorkflowHost(registry, runtime), runtime }
}

describe('shared workflow host', () => {
    it('exposes the complete lifecycle through validated transport-neutral contracts', async () => {
        const { host, runtime } = harness()
        expect(host.listDefinitions({ contractVersion })).toEqual([definition])

        const queued = host.start({ contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: {} })
        const completed = await runtime.wait(queued.runId)
        const view = host.get({ contractVersion, runId: completed.runId })

        expect(view.run.status).toBe('completed')
        expect(view.output?.card).toMatchObject({ kind: 'record-table', rows: [{ Name: 'Visible' }] })
        expect(JSON.stringify(view)).not.toContain('secretRawRow')
        expect(host.listRuns({ contractVersion })).toHaveLength(1)
        expect(host.cancel({ contractVersion, runId: completed.runId }).status).toBe('completed')
    })

    it('derives a bounded evidence-backed guidance handoff from a completed queue item', async () => {
        const { host, runtime } = harness()
        const queued = host.start({ contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: {} })
        await runtime.wait(queued.runId)

        expect(host.prepareGuidance({
            contractVersion, runId: queued.runId, queueItemId: 'WF-001:opp-1', capability: 'account-pulse'
        })).toMatchObject({
            workflowId: 'WF-001', capability: 'account-pulse',
            scope: { kind: 'opportunity', accountId: 'account-1', opportunityId: 'opp-1' },
            context: { evidenceIds: ['call-1'], queueItemId: 'WF-001:opp-1' }
        })
    })

    it('allows partial workflow results while rejecting evidence outside result lineage', async () => {
        const partialHarness = harness({ connectorState: 'partial' })
        const partialRun = partialHarness.host.start({ contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: {} })
        expect((await partialHarness.runtime.wait(partialRun.runId)).state).toBe('partial')
        expect(partialHarness.host.prepareGuidance({
            contractVersion, runId: partialRun.runId, queueItemId: 'WF-001:opp-1', capability: 'account-pulse'
        }).context.evidenceIds).toEqual(['call-1'])

        const invalidHarness = harness({ evidenceIds: ['foreign-call'] })
        const invalidRun = invalidHarness.host.start({ contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: {} })
        await invalidHarness.runtime.wait(invalidRun.runId)
        expect(() => invalidHarness.host.prepareGuidance({
            contractVersion, runId: invalidRun.runId, queueItemId: 'WF-001:opp-1', capability: 'account-pulse'
        })).toThrow('Queue-item evidence does not belong to the workflow result.')
    })

    it('rejects malformed and unknown requests before exposing runtime data', () => {
        const { executor, host } = harness()
        expect(() => host.start({ contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' }, extra: true } as never)).toThrow()
        expect(() => host.get({ contractVersion, runId: 'not-a-uuid' })).toThrow()
        expect(() => host.get({ contractVersion, runId: '33333333-3333-4333-8333-333333333333' })).toThrow()
        expect(executor.execute).not.toHaveBeenCalled()
    })
})