import { describe, expect, it, vi } from 'vitest'
import {
    FeatureFlaggedMsxReadConnector,
    FixtureMsxMcpBroker,
    MsxMcpAdapterError,
    MsxMcpReadAdapter,
    type MsxMcpContext,
    type MsxReadConnector,
    type MsxReadResult,
    type MsxToolBroker
} from '../../../packages/connectors/msx-mcp/index.js'

const account = { id: 'account-1', name: 'Contoso', segment: 'Enterprise' }
const opportunity = {
    id: 'opportunity-1', accountId: account.id, name: 'AI transformation', recordedStage: 3,
    value: 250_000, currency: 'USD', closeDate: '2026-06-30'
}
const stakeholder = { id: 'contact-1', name: 'Ada', role: 'Sponsor', influence: 'high' as const }
const activity = { id: 'activity-1', kind: 'email' as const, subject: 'Proof follow-up', occurredAt: '2026-04-01T12:00:00.000Z' }
const scope = { kind: 'opportunity' as const, accountId: account.id, opportunityId: opportunity.id }
const context: MsxMcpContext = { correlationId: 'correlation-1', capability: 'account-pulse' }
const fixtures = {
    get_opportunity_360: { opportunity, milestones: [], stakeholders: [stakeholder], activities: [activity], competitors: [], products: ['Azure'] },
    get_account_360: { account, opportunities: [opportunity], team: ['Ada'] },
    list_pipeline: [{ ...opportunity, forecastCategory: 'Best Case', probability: 60 }],
    get_stakeholder_map: { scope, stakeholders: [stakeholder] },
    list_activities: [activity],
    get_forecast_snapshot: { currency: 'USD', committed: 100, bestCase: 250, target: 300, gap: 50 }
}

describe('MSX MCP read adapter', () => {
    it('routes all curated reads through exact broker tools and arguments', async () => {
        const broker = new FixtureMsxMcpBroker(fixtures)
        const adapter = new MsxMcpReadAdapter(broker, () => new Date('2026-04-02T00:00:00.000Z'), () => 'tool-call-1')
        const filter = { accountId: account.id, stages: [2, 3], top: 25 }
        const window = { from: '2026-03-01T00:00:00.000Z', to: '2026-04-01T00:00:00.000Z' }

        const results = await Promise.all([
            adapter.getOpportunity360(opportunity.id, context),
            adapter.getAccount360(account.id, context),
            adapter.listPipeline(filter, context),
            adapter.getStakeholderMap(scope, context),
            adapter.listActivities(scope, window, context),
            adapter.getForecastSnapshot(filter, context)
        ])

        expect(broker.calls.map(({ serverId, tool, scope: scopeKind, arguments: arguments_ }) =>
            ({ serverId, tool, scope: scopeKind, arguments: arguments_ }))).toEqual([
                { serverId: 'msx', tool: 'get_opportunity_360', scope: 'opportunity', arguments: { opportunityId: opportunity.id } },
                { serverId: 'msx', tool: 'get_account_360', scope: 'account', arguments: { accountId: account.id } },
                { serverId: 'msx', tool: 'list_pipeline', scope: 'account', arguments: { filter } },
                { serverId: 'msx', tool: 'get_stakeholder_map', scope: 'opportunity', arguments: { scope } },
                { serverId: 'msx', tool: 'list_activities', scope: 'opportunity', arguments: { scope, window } },
                { serverId: 'msx', tool: 'get_forecast_snapshot', scope: 'account', arguments: { filter } }
            ])
        expect(results.every((result) => result.state === 'complete' && result.sourceHealth.state === 'live')).toBe(true)
        expect(results.every((result) => result.lineage?.connector === 'msx-mcp')).toBe(true)
    })

    it('parses MCP text content and rejects unknown or malformed response fields', async () => {
        const execute = vi.fn<MsxToolBroker['execute']>()
            .mockResolvedValueOnce({
                kind: 'untrusted-mcp-data',
                data: { content: [{ type: 'text', text: JSON.stringify(fixtures.get_account_360) }] },
                recordCount: 1,
                truncated: false
            })
            .mockResolvedValueOnce({
                kind: 'untrusted-mcp-data',
                data: { ...fixtures.get_account_360, unexpected: true },
                recordCount: 1,
                truncated: false
            })
        const adapter = new MsxMcpReadAdapter({ execute })

        await expect(adapter.getAccount360(account.id, context)).resolves.toMatchObject({ data: fixtures.get_account_360 })
        await expect(adapter.getAccount360(account.id, context)).rejects.toBeInstanceOf(MsxMcpAdapterError)
    })

    it('maps denied and unavailable calls without leaking untrusted payloads', async () => {
        const denied = Object.assign(new Error('denied'), { code: 'tool_denied' })
        const deniedAdapter = new MsxMcpReadAdapter({ execute: vi.fn<MsxToolBroker['execute']>().mockRejectedValue(denied) })
        const timeout = Object.assign(new Error('timed out'), { code: 'timeout' })
        const unavailableAdapter = new MsxMcpReadAdapter({ execute: vi.fn<MsxToolBroker['execute']>().mockRejectedValue(timeout) })

        await expect(deniedAdapter.listPipeline({}, context)).resolves.toMatchObject({
            state: 'unauthorized', data: [], sourceHealth: { state: 'unauthorized' }
        })
        await expect(unavailableAdapter.getAccount360(account.id, context)).resolves.toMatchObject({
            state: 'partial', data: null, sourceHealth: { state: 'unavailable' }
        })
    })

    it('marks row-limited broker responses as partial', async () => {
        const execute = vi.fn<MsxToolBroker['execute']>().mockResolvedValue({
            kind: 'untrusted-mcp-data', data: fixtures.list_pipeline, recordCount: 1, truncated: true
        })
        const adapter = new MsxMcpReadAdapter({ execute })

        await expect(adapter.listPipeline({}, context)).resolves.toMatchObject({
            state: 'partial', truncated: true, sourceHealth: { state: 'partial' }
        })
    })

    it('propagates cancellation', async () => {
        const aborted = Object.assign(new Error('cancelled'), { name: 'AbortError' })
        const adapter = new MsxMcpReadAdapter({ execute: vi.fn<MsxToolBroker['execute']>().mockRejectedValue(aborted) })
        await expect(adapter.listActivities(scope, { from: 'a', to: 'b' }, context)).rejects.toBe(aborted)
    })
})

describe('feature-flagged MSX read connector', () => {
    it.each([[true, 'mcp'], [false, 'direct']] as const)(
        'selects only the %s path for every read operation',
        async (enabled, selected) => {
            const mcp = connectorMock()
            const direct = connectorMock()
            const router = new FeatureFlaggedMsxReadConnector(() => enabled, mcp, direct)

            await router.getOpportunity360(opportunity.id, context)
            await router.getAccount360(account.id, context)
            await router.listPipeline({}, context)
            await router.getStakeholderMap(scope, context)
            await router.listActivities(scope, { from: 'a', to: 'b' }, context)
            await router.getForecastSnapshot({}, context)

            const selectedConnector = selected === 'mcp' ? mcp : direct
            const skippedConnector = selected === 'mcp' ? direct : mcp
            expect(callCount(selectedConnector)).toBe(6)
            expect(callCount(skippedConnector)).toBe(0)
        }
    )
})

function connectorMock(): MsxReadConnector {
    const result: MsxReadResult<never> = {
        state: 'complete', data: null as never, rowCount: 0, truncated: false,
        sourceHealth: { source: 'msx', state: 'live', detail: 'test', checkedAt: '2026-04-02T00:00:00.000Z' }
    }
    return {
        getOpportunity360: vi.fn().mockResolvedValue(result),
        getAccount360: vi.fn().mockResolvedValue(result),
        listPipeline: vi.fn().mockResolvedValue(result),
        getStakeholderMap: vi.fn().mockResolvedValue(result),
        listActivities: vi.fn().mockResolvedValue(result),
        getForecastSnapshot: vi.fn().mockResolvedValue(result)
    }
}

function callCount(connector: MsxReadConnector): number {
    return Object.values(connector).reduce((total, method) => total + (vi.mocked(method).mock.calls.length), 0)
}