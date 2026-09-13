import { describe, expect, it, vi } from 'vitest'
import { WorkflowRunHistory } from '../../../packages/orchestrator/progress/index.js'
import { WorkflowRegistry, WorkflowRegistryError } from '../../../packages/orchestrator/workflows/index.js'
import type { WorkflowDefinition, WorkflowRun } from '../../../packages/common/index.js'

const definition = (id: string, scope: WorkflowDefinition['scope'] = 'portfolio'): WorkflowDefinition => ({
    contractVersion: '1.0', id, name: `Workflow ${id}`, version: '1.0.0', scope,
    personaTargets: ['AE'], category: 'portfolio-hygiene', executionMode: 'deterministic',
    connectorPlan: [{ connector: 'msx-mcp', operation: 'list_pipeline', required: true }],
    inputSchemaRef: `${id}.input.v1`, outputSchemaRef: `${id}.output.v1`,
    sla: { targetMs: 1_000, timeoutMs: 5_000 },
    auth: { requiresDelegatedUser: true, allowedWrite: false },
    ui: { cardStyle: 'record-table', resultPriority: 'high', showInQuickLaunch: true }
})

const run = (runId: string, workflowId: string): WorkflowRun => ({
    contractVersion: '1.0', runId, workflowId, status: 'queued', scope: { kind: 'portfolio' },
    connectorCalls: [], telemetry: { correlationId: runId, cacheHit: false }
})

describe('workflow registry', () => {
    it('strictly validates definitions and rejects duplicate ids', () => {
        expect(() => new WorkflowRegistry([{ ...definition('WF-001'), unexpected: true }])).toThrow()
        expect(() => new WorkflowRegistry([definition('WF-001'), definition('WF-001')])).toThrow(WorkflowRegistryError)
    })

    it('returns deterministic id ordering while preserving connector-plan precedence', () => {
        const second = definition('WF-002')
        second.connectorPlan = [
            { connector: 'dataverse-mcp', operation: 'read_query', required: false },
            { connector: 'msx-mcp', operation: 'list_pipeline', required: true }
        ]
        const registry = new WorkflowRegistry([second, definition('WF-001')])

        expect(registry.list().map(({ id }) => id)).toEqual(['WF-001', 'WF-002'])
        expect(registry.get('WF-002').connectorPlan).toEqual(second.connectorPlan)
    })

    it('replaces definitions atomically when validation fails', () => {
        const registry = new WorkflowRegistry([definition('WF-001')])
        expect(() => registry.replace([])).toThrow()
        expect(registry.get('WF-001').id).toBe('WF-001')
        expect(() => registry.get('WF-999')).toThrow(WorkflowRegistryError)
    })
})

describe('workflow run history', () => {
    it('evicts the oldest run at capacity and returns newest first', () => {
        const onEvicted = vi.fn()
        const history = new WorkflowRunHistory({ capacity: 2, onEvicted })
        const first = run('11111111-1111-4111-8111-111111111111', 'WF-001')
        const second = run('22222222-2222-4222-8222-222222222222', 'WF-002')
        const third = run('33333333-3333-4333-8333-333333333333', 'WF-003')

        history.set(first)
        history.set(second)
        history.set(third)

        expect(history.get(first.runId)).toBeUndefined()
        expect(history.list().map(({ runId }) => runId)).toEqual([third.runId, second.runId])
        expect(onEvicted).toHaveBeenCalledWith(first)
    })

    it('updates an existing run without changing creation order and isolates stored values', () => {
        const history = new WorkflowRunHistory({ capacity: 2 })
        const first = run('11111111-1111-4111-8111-111111111111', 'WF-001')
        const second = run('22222222-2222-4222-8222-222222222222', 'WF-002')
        history.set(first)
        history.set(second)
        first.workflowId = 'WF-999'

        expect(history.get(first.runId)?.workflowId).toBe('WF-001')
        history.set({ ...history.get(first.runId)!, status: 'running', startedAt: '2026-09-12T10:00:00.000Z' })
        const third = run('33333333-3333-4333-8333-333333333333', 'WF-003')
        history.set(third)
        expect(history.get(first.runId)).toBeUndefined()
    })

    it('filters by exact scope and validates capacity and limit', () => {
        const history = new WorkflowRunHistory()
        const accountRun = { ...run('11111111-1111-4111-8111-111111111111', 'WF-001'), scope: { kind: 'account' as const, accountId: 'account-1' } }
        history.set(accountRun)
        history.set(run('22222222-2222-4222-8222-222222222222', 'WF-002'))

        expect(history.list(accountRun.scope)).toEqual([accountRun])
        expect(() => history.list(undefined, 0)).toThrow()
        expect(() => new WorkflowRunHistory({ capacity: 0 })).toThrow()
    })
})