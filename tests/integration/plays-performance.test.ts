import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    dataverseEntityMapSchema, mcpServerRegistrySchema, mcpToolPolicySchema, type PerformanceEvent, type PerformanceReporter
} from '../../packages/common/index.js'
import entityMapJson from '../../config/dataverse.entity-map.json' with { type: 'json' }
import registryJson from '../../config/mcp.servers.json' with { type: 'json' }
import policyJson from '../../config/mcp.tool-policy.json' with { type: 'json' }
import { DataverseMcpReadAdapter } from '../../packages/connectors/dataverse-mcp/index.js'
import { MsxMcpReadAdapter } from '../../packages/connectors/msx-mcp/index.js'
import { McpToolBroker } from '../../packages/orchestrator/routing/mcp-tool-broker.js'
import {
    InitialWorkflowConnectorExecutor, InitialWorkflowResultAssembler, LIVE_PLAY_ROW_LIMIT,
    WorkflowRegistry, WorkflowRuntime, initialWorkflowDefinitions, initialWorkflowOutputSchema
} from '../../packages/orchestrator/workflows/index.js'

const databases: DatabaseSync[] = []
afterEach(() => { for (const database of databases.splice(0)) database.close() })

function harness(beforeQuery?: (page: number) => Promise<void>, performanceReporter?: PerformanceReporter) {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    database.exec(`
        CREATE TABLE opportunity (opportunityid TEXT PRIMARY KEY, parentaccountid TEXT, name TEXT);
        CREATE TABLE msp_dealteam (msp_parentopportunityid TEXT, msp_dealteamuserid TEXT, statecode INTEGER);
        CREATE TABLE msp_engagementmilestone (
            msp_engagementmilestoneid TEXT PRIMARY KEY, msp_opportunityid TEXT, msp_name TEXT,
            msp_milestonestatusname TEXT, msp_milestonestatus INTEGER, msp_milestonedate TEXT
        );
    `)
    const opportunity = database.prepare('INSERT INTO opportunity VALUES (?, ?, ?)')
    const membership = database.prepare('INSERT INTO msp_dealteam VALUES (?, ?, ?)')
    const milestone = database.prepare('INSERT INTO msp_engagementmilestone VALUES (?, ?, ?, ?, ?, ?)')
    for (let index = 0; index < 104; index += 1) {
        const id = String(index).padStart(3, '0')
        opportunity.run(`opp-${id}`, index === 100 ? 'account-hidden' : `account-${id}`, `Opportunity ${id}`)
        membership.run(`opp-${id}`, index === 101 ? 'other-user' : 'user-1', index === 102 ? 1 : 0)
        milestone.run(`ms-${id}`, `opp-${id}`, `Milestone ${id}`, index === 103 ? 'Completed' : 'At Risk',
            index === 103 ? 861980003 : 861980001, '2026-09-01')
    }
    const queries: string[] = []
    const registry = mcpServerRegistrySchema.parse(registryJson)
    const broker = new McpToolBroker({
        registry, policy: mcpToolPolicySchema.parse(policyJson),
        invokeTool: async (_server, tool, args) => {
            expect(tool).toBe('read_query')
            const sql = String(args['querytext'])
            queries.push(sql)
            await beforeQuery?.(queries.length)
            const match = /^SELECT TOP (\d+) (.*)$/s.exec(sql)
            if (!match) throw new Error('Expected a bounded SQL projection.')
            const limit = Number(match[1])
            expect(limit).toBeLessThanOrEqual(20)
            return { rows: database.prepare(`SELECT ${match[2]} LIMIT ${limit}`).all() }
        }
    })
    const executor = new InitialWorkflowConnectorExecutor(
        new DataverseMcpReadAdapter({
            entityMap: dataverseEntityMapSchema.parse(entityMapJson), broker, maximumRows: LIVE_PLAY_ROW_LIMIT,
            ...(performanceReporter ? { performanceReporter } : {})
        }),
        new MsxMcpReadAdapter(broker),
        () => ({
            currentUserId: 'user-1', delegatedUserAccountIds: [], delegatedUserOpportunityIds: [],
            excludedAccountIds: ['account-hidden']
        }),
        performanceReporter
    )
    const runtime = new WorkflowRuntime(new WorkflowRegistry(initialWorkflowDefinitions), executor, {
        resultAssembler: new InitialWorkflowResultAssembler()
    })
    return { runtime, queries, broker, registry }
}

describe('live Plays query regression (offline)', () => {
    it('reads 100 distinct parents in five calls, within the production budget, retaining scope and handoff data', async () => {
        const { runtime, queries, broker, registry } = harness()
        const run = await runtime.wait(runtime.start({
            workflowId: 'WF-002', scope: { kind: 'portfolio' }, input: { asOf: '2026-09-12' }
        }).runId)
        expect(run.status).toBe('completed')
        const output = initialWorkflowOutputSchema.parse(runtime.getResult(run.resultRef!)?.output)

        expect(queries).toHaveLength(5)
        expect(queries.length).toBeLessThanOrEqual(registry.servers.find((server) => server.id === 'dataverse')!.limits.maxToolCallsPerRequest)
        expect(output.queueItems).toHaveLength(100)
        expect(output.queueItems.every((item) => item.accountId && item.opportunityName && item.opportunityId)).toBe(true)
        expect(output.queueItems.some((item) => ['opp-100', 'opp-101', 'opp-102', 'opp-103'].includes(item.opportunityId ?? ''))).toBe(false)
        expect(run.connectorCalls[0]).toMatchObject({ recordCount: 100, truncated: true })
        expect(output.sourceHealth[0]?.state).toBe('partial')
        expect(broker.getJournal().filter((entry) => entry.serverId === 'dataverse').every((entry) => entry.outcome === 'success')).toBe(true)
    })

    it('makes the first page available after one round trip rather than after all five', async () => {
        vi.useFakeTimers()
        try {
            const { runtime, queries } = harness(async () => {
                await new Promise((resolve) => setTimeout(resolve, 1_000))
            })
            const queued = runtime.start({
                workflowId: 'WF-002', scope: { kind: 'portfolio' }, input: { asOf: '2026-09-12' }
            })
            await vi.advanceTimersByTimeAsync(1_000)
            const running = runtime.get(queued.runId)!
            const first = initialWorkflowOutputSchema.parse(runtime.getResult(running.resultRef!)?.output)

            expect(running.status).toBe('running')
            expect(running.telemetry.firstResultMs).toBe(1_000)
            expect(first.queueItems).toHaveLength(20)
            expect(first.sourceHealth[0]?.state).toBe('partial')
            expect(queries).toHaveLength(2)

            await vi.advanceTimersByTimeAsync(4_000)
            const completed = await runtime.wait(queued.runId)
            const final = initialWorkflowOutputSchema.parse(runtime.getResult(completed.resultRef!)?.output)
            expect(final.queueItems).toHaveLength(100)
            expect(completed.telemetry.firstResultMs).toBe(1_000)
            expect(Date.parse(completed.completedAt!) - Date.parse(completed.startedAt!)).toBe(5_000)
            expect(queries).toHaveLength(5)
        } finally {
            vi.useRealTimers()
        }
    })

    it('reports scope and per-page timing without recording query text or customer identifiers', async () => {
        const events: PerformanceEvent[] = []
        const { runtime } = harness(undefined, (event) => events.push(event))
        const queued = runtime.start({
            workflowId: 'WF-002', scope: { kind: 'portfolio' }, input: { asOf: '2026-09-12' }
        })
        await runtime.wait(queued.runId)

        expect(events.map((event) => event.operation)).toEqual(['plays.scope', ...Array<string>(5).fill('plays.dataverse.page')])
        expect(events.every((event) => event.outcome === 'success' && event.durationMs >= 0)).toBe(true)
        expect(JSON.stringify(events)).not.toMatch(/account-|opp-|user-|Opportunity|SELECT|querytext/)
    })
})
