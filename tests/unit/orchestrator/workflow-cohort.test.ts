import { describe, expect, it, vi } from 'vitest'
import { loadDataverseEntityMap, type GuardedQueryRequest } from '../../../packages/common/index.js'
import {
    DataverseMcpReadAdapter,
    FixtureDataverseMcpBroker,
    type DataverseMcpQueryResult
} from '../../../packages/connectors/dataverse-mcp/index.js'
import {
    FixtureMsxMcpBroker,
    MsxMcpReadAdapter,
    type MsxReadConnector,
    type MsxReadResult
} from '../../../packages/connectors/msx-mcp/index.js'
import {
    InitialWorkflowConnectorExecutor,
    InitialWorkflowResultAssembler,
    WorkflowRegistry,
    WorkflowRuntime,
    initialWorkflowDefinitions,
    initialWorkflowOutputSchema,
    type InitialWorkflowId
} from '../../../packages/orchestrator/workflows/index.js'
import {
    compositeConflictScenario,
    compositeDataverseBrokerRows,
    compositeDataverseWorkflowRows,
    compositeMsxBrokerResults,
    compositeMsxForecastSnapshot,
    compositeMsxPipelineRows
} from '../../fixtures/mcp/composite-workflows.js'

const checkedAt = '2026-09-12T10:00:00.000Z'
const correlationId = '22222222-2222-4222-8222-222222222222'

const fixtures = compositeDataverseWorkflowRows as Record<InitialWorkflowId, Array<Record<string, unknown>>>

function input(workflowId: InitialWorkflowId): Record<string, unknown> {
    if (workflowId === 'WF-009') return { asOf: '2026-09-12', maximumActiveItems: 1 }
    return { asOf: '2026-09-12' }
}

function createHarness(options: { empty?: boolean; partial?: boolean; msxUnauthorized?: boolean; now?: () => number } = {}) {
    let activeWorkflow: InitialWorkflowId = 'WF-001'
    const dataverse = {
        query: vi.fn(async (query: GuardedQueryRequest): Promise<DataverseMcpQueryResult> => {
            void query
            return {
                state: options.partial ? 'partial' : 'complete',
                records: options.empty ? [] : fixtures[activeWorkflow],
                recordCount: options.empty ? 0 : fixtures[activeWorkflow].length,
                truncated: options.partial ?? false,
                sourceHealth: {
                    source: 'dataverse-mcp', state: options.partial ? 'partial' : 'live',
                    detail: 'Fixture Dataverse data.', checkedAt
                },
                lineage: { connector: 'dataverse-mcp', operation: 'read_query', toolCallId: `dv-${activeWorkflow}` }
            }
        })
    } satisfies Pick<DataverseMcpReadAdapter, 'query'>
    const msxResult = <T>(data: T): MsxReadResult<T> => ({
        state: options.msxUnauthorized ? 'unauthorized' : 'complete',
        data,
        rowCount: options.msxUnauthorized ? 0 : Array.isArray(data) ? data.length : data === null ? 0 : 1,
        truncated: false,
        sourceHealth: {
            source: 'msx-mcp', state: options.msxUnauthorized ? 'unauthorized' : 'live',
            detail: 'Fixture MSX data.', checkedAt
        },
        lineage: { connector: 'msx-mcp', operation: 'list_pipeline', toolCallId: `msx-${activeWorkflow}` }
    })
    const msx: MsxReadConnector = {
        getOpportunity360: vi.fn(async () => msxResult(null)),
        getAccount360: vi.fn(async () => msxResult(null)),
        listPipeline: vi.fn(async () => msxResult(compositeMsxPipelineRows)),
        getStakeholderMap: vi.fn(async () => msxResult(null)),
        listActivities: vi.fn(async () => msxResult([])),
        getForecastSnapshot: vi.fn(async () => msxResult(compositeMsxForecastSnapshot))
    }
    const executor = new InitialWorkflowConnectorExecutor(dataverse, msx, () => ({
        delegatedUserAccountIds: ['account-1'], delegatedUserOpportunityIds: ['opp-1']
    }))
    let idCounter = 0
    const runtime = new WorkflowRuntime(new WorkflowRegistry(initialWorkflowDefinitions), executor, {
        resultAssembler: new InitialWorkflowResultAssembler(),
        createId: () => `${String(++idCounter).padStart(8, '0')}-0000-4000-8000-000000000000`,
        ...(options.now ? { now: options.now } : {})
    })
    return { dataverse, msx, runtime, setActiveWorkflow: (id: InitialWorkflowId) => { activeWorkflow = id } }
}

describe('initial deterministic workflow cohort', () => {
    it.each([
        ['WF-001', 'record-table'],
        ['WF-002', 'action-list'],
        ['WF-003', 'exception-list'],
        ['WF-005', 'exception-list'],
        ['WF-006', 'record-table'],
        ['WF-007', 'record-table'],
        ['WF-009', 'metric-strip'],
        ['WF-010', 'action-list'],
        ['WF-012', 'action-list']
    ] as const)('runs %s through the shared runtime and emits its strict %s output', async (workflowId, cardKind) => {
        const harness = createHarness()
        harness.setActiveWorkflow(workflowId)
        const run = await harness.runtime.wait(harness.runtime.start({ workflowId, scope: { kind: 'portfolio' }, input: input(workflowId), correlationId }).runId)
        const output = initialWorkflowOutputSchema.parse(harness.runtime.getResult(run.resultRef!)?.output)

        expect(run.status).toBe('completed')
        expect(output.workflowId).toBe(workflowId)
        expect(output.card.kind).toBe(cardKind)
        expect(output.lineage[0]?.toolCallId).toBe(`dv-${workflowId}`)
        expect(output.sourceHealth[0]?.source).toBe('dataverse-mcp')
    })

    it('builds guarded workflow-specific queries before invoking Dataverse', async () => {
        const harness = createHarness()
        for (const workflowId of ['WF-001', 'WF-002', 'WF-003', 'WF-005', 'WF-006', 'WF-007', 'WF-009', 'WF-010', 'WF-012'] as const) {
            harness.setActiveWorkflow(workflowId)
            await harness.runtime.wait(harness.runtime.start({ workflowId, scope: { kind: 'portfolio' }, input: input(workflowId) }).runId)
        }
        const queries = harness.dataverse.query.mock.calls.map(([query]) => query)
        expect(queries.map(({ entity }) => entity)).toEqual([
            'opportunity', 'engagementMilestone', 'engagementMilestone', 'engagementMilestone', 'opportunity', 'activity', 'opportunity', 'activity', 'engagementMilestone'
        ])
        expect(queries[0]?.filter[0]).toEqual({ field: 'closeDate', operator: 'on-or-before', value: '2026-08-13' })
        expect(queries[5]?.filter).toContainEqual({ field: 'dueDate', operator: 'on-or-before', value: '2026-09-26' })
        expect(queries[7]?.filter).toContainEqual({ field: 'status', operator: 'ne', value: 'Completed' })
        expect(queries.every(({ top, expand }) => top === 500 && expand.length === 0)).toBe(true)
    })

    it('returns valid empty output without synthetic queue records', async () => {
        const harness = createHarness({ empty: true })
        harness.setActiveWorkflow('WF-002')
        const run = await harness.runtime.wait(harness.runtime.start({
            workflowId: 'WF-002', scope: { kind: 'portfolio' }, input: input('WF-002')
        }).runId)
        const output = initialWorkflowOutputSchema.parse(harness.runtime.getResult(run.resultRef!)?.output)
        expect(output.queueItems).toEqual([])
        expect(output.card).toMatchObject({ kind: 'action-list', actions: [] })
    })

    it('surfaces optional unauthorized enrichment and required truncation as partial runs', async () => {
        const unauthorized = createHarness({ msxUnauthorized: true })
        unauthorized.setActiveWorkflow('WF-001')
        const unauthorizedRun = await unauthorized.runtime.wait(unauthorized.runtime.start({
            workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: input('WF-001')
        }).runId)
        expect(unauthorizedRun.state).toBe('partial')
        expect(unauthorizedRun.connectorCalls.map(({ status }) => status)).toEqual(['success', 'unauthorized'])
        const unauthorizedOutput = initialWorkflowOutputSchema.parse(
            unauthorized.runtime.getResult(unauthorizedRun.resultRef!)?.output
        )
        expect(unauthorizedOutput.sourceHealth.map(({ state }) => state)).toEqual(['live', 'unauthorized'])

        const truncated = createHarness({ partial: true })
        truncated.setActiveWorkflow('WF-009')
        const truncatedRun = await truncated.runtime.wait(truncated.runtime.start({
            workflowId: 'WF-009', scope: { kind: 'portfolio' }, input: input('WF-009')
        }).runId)
        expect(truncatedRun.state).toBe('partial')
        expect(truncatedRun.connectorCalls[0]).toMatchObject({ status: 'partial', truncated: true })
    })

    it('uses stable due-date then ID ordering and measures representative P50 below six seconds', async () => {
        let now = Date.parse(checkedAt)
        const harness = createHarness({ now: () => { now += 25; return now } })
        const timings: number[] = []
        for (const workflowId of ['WF-001', 'WF-002', 'WF-003', 'WF-005', 'WF-006', 'WF-007', 'WF-009', 'WF-010', 'WF-012'] as const) {
            harness.setActiveWorkflow(workflowId)
            const run = await harness.runtime.wait(harness.runtime.start({
                workflowId, scope: { kind: 'portfolio' }, input: input(workflowId)
            }).runId)
            timings.push(run.telemetry.firstResultMs!)
            if (workflowId === 'WF-002') {
                const output = initialWorkflowOutputSchema.parse(harness.runtime.getResult(run.resultRef!)?.output)
                expect(output.queueItems.map(({ id }) => id)).toEqual(['WF-002:milestone-a', 'WF-002:milestone-b'])
            }
        }
        timings.sort((left, right) => left - right)
        expect(timings[Math.floor(timings.length / 2)]).toBeLessThan(6_000)
    })

    it('reconciles curated MSX fields over deduplicated Dataverse rows deterministically', () => {
        const definition = initialWorkflowDefinitions.find(({ id }) => id === 'WF-001')!
        const { dataverseRows, msxRows } = compositeConflictScenario
        const step = (connector: 'dataverse-mcp' | 'msx-mcp', data: unknown, toolCallId: string) => ({
            connector,
            operation: connector === 'dataverse-mcp' ? 'read_query' : 'list_pipeline',
            data,
            lineage: { connector, operation: connector === 'dataverse-mcp' ? 'read_query' : 'list_pipeline', toolCallId },
            sourceHealth: { source: connector, state: 'live' as const, detail: 'Fixture data.', checkedAt }
        })
        const assemble = (dataverse: typeof dataverseRows, msx: typeof msxRows) => new InitialWorkflowResultAssembler().assemble({
            definition,
            scope: { kind: 'portfolio' },
            input: input('WF-001'),
            generatedAt: checkedAt,
            steps: [step('dataverse-mcp', dataverse, 'dv-1'), step('msx-mcp', msx, 'msx-1')]
        })

        const output = assemble(dataverseRows, msxRows)
        expect(output.card).toMatchObject({
            kind: 'record-table',
            rows: [{ id: 'opp-1', accountId: 'account-1', name: 'Dataverse name', closeDate: '2026-10-15' }]
        })
        expect(output.queueItems).toHaveLength(1)
        expect(output.lineage.map(({ toolCallId }) => toolCallId)).toEqual(['dv-1', 'msx-1'])
        expect(output.sourceHealth.map(({ source }) => source)).toEqual(['dataverse-mcp', 'msx-mcp'])
        expect(assemble([...dataverseRows].reverse(), [...msxRows].reverse()).card).toEqual(output.card)
    })

    it('composes reusable samples through both MCP fixture brokers', async () => {
        const entityMap = await loadDataverseEntityMap('config/dataverse.entity-map.json')
        const dataverse = new DataverseMcpReadAdapter({
            entityMap,
            broker: new FixtureDataverseMcpBroker(compositeDataverseBrokerRows),
            now: () => new Date(checkedAt),
            createToolCallId: () => 'dv-fixture-call'
        })
        const msxBroker = new FixtureMsxMcpBroker(compositeMsxBrokerResults)
        const msx = new MsxMcpReadAdapter(msxBroker, () => new Date(checkedAt), () => 'msx-fixture-call')
        const executor = new InitialWorkflowConnectorExecutor(dataverse, msx, () => ({
            delegatedUserAccountIds: ['account-1'],
            delegatedUserOpportunityIds: ['opp-a', 'opp-b']
        }))
        const runtime = new WorkflowRuntime(new WorkflowRegistry(initialWorkflowDefinitions), executor, {
            resultAssembler: new InitialWorkflowResultAssembler()
        })

        const run = await runtime.wait(runtime.start({
            workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: input('WF-001'), correlationId
        }).runId)
        const output = initialWorkflowOutputSchema.parse(runtime.getResult(run.resultRef!)?.output)

        expect(run.status).toBe('completed')
        expect(output.card).toMatchObject({
            kind: 'record-table',
            rows: [
                { id: 'opp-a', name: 'Northwind AI transformation', closeDate: '2026-06-28' },
                { id: 'opp-b', name: 'Fabrikam cloud renewal', closeDate: '2026-07-01' }
            ]
        })
        expect(output.lineage.map(({ toolCallId }) => toolCallId)).toEqual(['dv-fixture-call', 'msx-fixture-call'])
        expect(msxBroker.calls).toMatchObject([{ serverId: 'msx', tool: 'list_pipeline' }])
    })

    it('fails closed on malformed workflow input before connector invocation', async () => {
        const harness = createHarness()
        const run = await harness.runtime.wait(harness.runtime.start({
            workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: { asOf: 'invalid' }
        }).runId)
        expect(run.status).toBe('failed')
        expect(harness.dataverse.query).not.toHaveBeenCalled()
    })
})