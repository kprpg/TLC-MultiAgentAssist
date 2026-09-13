import { describe, expect, it, vi } from 'vitest'
import type {
    McpServer,
    McpServerRegistry,
    McpToolPolicy,
    McpToolPolicyEntry
} from '../../../packages/common/index.js'
import {
    McpToolBroker,
    type McpToolInvoker
} from '../../../packages/orchestrator/routing/mcp-tool-broker.js'

function server(overrides: Partial<McpServer> = {}): McpServer {
    return {
        id: 'dataverse',
        displayName: 'Dataverse MCP',
        enabled: true,
        execution: 'local-client',
        serverUrl: 'https://mcp.example.test',
        serverLabel: 'dataverse_broad',
        authentication: { kind: 'entra-delegated', scopes: ['scope/.default'] },
        limits: {
            connectTimeoutMs: 1_000,
            callTimeoutMs: 1_000,
            maxConcurrentCalls: 2,
            maxToolCallsPerRequest: 2,
            maxRowsPerCall: 3,
            maxResultBytes: 10_000
        },
        retry: { maxAttempts: 2, initialDelayMs: 50, backoffMultiplier: 2, retryOnStatus: [429, 503] },
        circuitBreaker: { failureThreshold: 2, openDurationMs: 1_000 },
        ...overrides
    }
}

function policyEntry(overrides: Partial<McpToolPolicyEntry> = {}): McpToolPolicyEntry {
    return {
        serverId: 'dataverse',
        tool: 'read_query',
        riskClass: 'read',
        enabled: true,
        approval: 'none',
        allowedCapabilities: ['account-pulse'],
        allowedScopes: ['opportunity'],
        maxRows: 2,
        redactFields: ['secret', 'email'],
        rateLimitPerMinute: 2,
        ...overrides
    }
}

function brokerOptions(
    invokeTool: McpToolInvoker,
    policyOverrides: Partial<McpToolPolicyEntry> = {},
    serverOverrides: Partial<McpServer> = {}
) {
    const registry: McpServerRegistry = { schemaVersion: 1, servers: [server(serverOverrides)] }
    const policy: McpToolPolicy = { schemaVersion: 1, defaultDeny: true, entries: [policyEntry(policyOverrides)] }
    return { registry, policy, invokeTool }
}

const request = {
    correlationId: 'request-1',
    serverId: 'dataverse',
    tool: 'read_query',
    capability: 'account-pulse',
    scope: 'opportunity',
    arguments: { query: 'safe' }
} as const

describe('McpToolBroker', () => {
    it('does not invoke transport for unknown, disabled, or unapproved tools', async () => {
        const invokeTool = vi.fn(async () => ({ rows: [] }))
        const broker = new McpToolBroker(brokerOptions(invokeTool))

        await expect(broker.execute({ ...request, tool: 'unknown_tool' }))
            .rejects.toMatchObject({ code: 'tool_denied' })
        const disabled = new McpToolBroker(brokerOptions(invokeTool, { enabled: false }))
        await expect(disabled.execute(request)).rejects.toMatchObject({ code: 'tool_denied' })
        const write = new McpToolBroker(brokerOptions(invokeTool, {
            tool: 'update_milestone',
            riskClass: 'write',
            approval: 'confirm-with-reason'
        }))
        await expect(write.execute({ ...request, tool: 'update_milestone' }))
            .rejects.toMatchObject({ code: 'approval_required' })

        expect(invokeTool).not.toHaveBeenCalled()
    })

    it('redacts fields, caps rows, and wraps tool output as untrusted data', async () => {
        const invokeTool = vi.fn(async () => ({
            rows: [
                { id: '1', email: 'first@example.test', nested: { secret: 'alpha' } },
                { id: '2', email: 'second@example.test' },
                { id: '3', email: 'third@example.test' }
            ],
            content: [{ type: 'text', text: '{"secret":"inside-json","safe":"value"}' }]
        }))
        const broker = new McpToolBroker(brokerOptions(invokeTool))

        const result = await broker.execute(request)

        expect(result).toMatchObject({ kind: 'untrusted-mcp-data', recordCount: 3, truncated: true })
        expect(result.data).toEqual({
            rows: [
                { id: '1', email: '[REDACTED]', nested: { secret: '[REDACTED]' } },
                { id: '2', email: '[REDACTED]' }
            ],
            content: [{ type: 'text', text: '{"secret":"[REDACTED]","safe":"value"}' }]
        })
    })

    it('uses the server row cap when it is stricter than the policy cap', async () => {
        const invokeTool = vi.fn(async () => ({ rows: [{ id: '1' }, { id: '2' }, { id: '3' }] }))
        const broker = new McpToolBroker(brokerOptions(
            invokeTool,
            { maxRows: 3 },
            { limits: { ...server().limits, maxRowsPerCall: 1 } }
        ))

        const result = await broker.execute(request)

        expect(result).toMatchObject({ recordCount: 3, truncated: true })
        expect(result.data).toEqual({ rows: [{ id: '1' }] })
    })

    it('rejects capability and scope mismatches before invoking transport', async () => {
        const invokeTool = vi.fn(async () => ({ rows: [] }))
        const broker = new McpToolBroker(brokerOptions(invokeTool))

        await expect(broker.execute({ ...request, capability: 'mcem-coach' }))
            .rejects.toMatchObject({ code: 'capability_denied' })
        await expect(broker.execute({ ...request, scope: 'portfolio' }))
            .rejects.toMatchObject({ code: 'scope_denied' })
        expect(invokeTool).not.toHaveBeenCalled()
    })

    it('enforces per-request and per-minute call limits before invocation', async () => {
        let now = 1_000
        const invokeTool = vi.fn(async () => ({ rows: [] }))
        const broker = new McpToolBroker({ ...brokerOptions(invokeTool), now: () => now })

        await broker.execute(request)
        await broker.execute(request)
        await expect(broker.execute(request)).rejects.toMatchObject({ code: 'tool_denied' })
        expect(invokeTool).toHaveBeenCalledTimes(2)

        broker.completeRequest(request.correlationId)
        await expect(broker.execute({ ...request, correlationId: 'request-2' }))
            .rejects.toMatchObject({ code: 'tool_denied' })
        now += 60_001
        await expect(broker.execute({ ...request, correlationId: 'request-2' })).resolves.toBeDefined()
        expect(invokeTool).toHaveBeenCalledTimes(3)
    })

    it('keeps a bounded metadata-only journal for successes and denials', async () => {
        const invokeTool = vi.fn(async () => ({ rows: [{ id: '1' }] }))
        const broker = new McpToolBroker({ ...brokerOptions(invokeTool), maxJournalEntries: 2, now: () => 1_000 })

        await broker.execute(request)
        broker.completeRequest(request.correlationId)
        await expect(broker.execute({ ...request, correlationId: 'request-2', tool: 'missing' }))
            .rejects.toBeDefined()
        await expect(broker.execute({ ...request, correlationId: 'request-3', scope: 'portfolio' }))
            .rejects.toBeDefined()

        const journal = broker.getJournal()
        expect(journal).toHaveLength(2)
        expect(journal.map((entry) => entry.outcome)).toEqual(['denied', 'denied'])
        expect(JSON.stringify(journal)).not.toContain('safe')
        expect(Object.keys(journal[0] ?? {})).not.toContain('arguments')
        expect(Object.keys(journal[0] ?? {})).not.toContain('result')
    })

    it('journals transport failures without arguments or result content', async () => {
        const failure = Object.assign(new Error('sensitive transport detail'), { code: 'transport_failed' })
        const invokeTool = vi.fn(async () => { throw failure })
        const broker = new McpToolBroker(brokerOptions(invokeTool))

        await expect(broker.execute({ ...request, arguments: { token: 'top-secret' } })).rejects.toBe(failure)

        expect(broker.getJournal()).toEqual([expect.objectContaining({
            outcome: 'failed',
            failureCode: 'transport_failed',
            recordCount: 0,
            truncated: false
        })])
        expect(JSON.stringify(broker.getJournal())).not.toContain('top-secret')
        expect(JSON.stringify(broker.getJournal())).not.toContain('sensitive transport detail')
    })
})