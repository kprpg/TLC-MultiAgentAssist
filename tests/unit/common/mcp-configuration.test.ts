import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
    loadMcpServerRegistry,
    mcpServerRegistrySchema
} from '../../../packages/common/configuration/mcp-servers.js'
import {
    loadMcpToolPolicy,
    mcpToolPolicySchema
} from '../../../packages/common/configuration/mcp-tool-policy.js'

const validServer = {
    id: 'msx',
    displayName: 'MSX MCP',
    enabled: false,
    execution: 'local-client',
    serverUrl: 'https://msx-mcp.invalid/api/mcp',
    serverLabel: 'msx_sales',
    authentication: {
        kind: 'entra-delegated',
        scopes: ['https://microsoftsales.crm.dynamics.com/.default']
    },
    limits: {
        connectTimeoutMs: 10_000,
        callTimeoutMs: 30_000,
        maxConcurrentCalls: 4,
        maxToolCallsPerRequest: 6,
        maxRowsPerCall: 500,
        maxResultBytes: 512_000
    },
    retry: {
        maxAttempts: 3,
        initialDelayMs: 250,
        backoffMultiplier: 2,
        retryOnStatus: [429, 503]
    },
    circuitBreaker: {
        failureThreshold: 5,
        openDurationMs: 60_000
    }
} as const

const validPolicyEntry = {
    serverId: 'msx',
    tool: 'get_opportunity_360',
    riskClass: 'read',
    enabled: false,
    approval: 'none',
    allowedCapabilities: ['account-pulse'],
    allowedScopes: ['opportunity'],
    maxRows: 500,
    redactFields: []
} as const

describe('MCP configuration', () => {
    it('loads strict, disabled, non-secret checked-in defaults', async () => {
        const serverPath = fileURLToPath(new URL('../../../config/mcp.servers.json', import.meta.url))
        const policyPath = fileURLToPath(new URL('../../../config/mcp.tool-policy.json', import.meta.url))
        const rawConfiguration = `${await readFile(serverPath, 'utf8')}\n${await readFile(policyPath, 'utf8')}`

        const [registry, policy] = await Promise.all([
            loadMcpServerRegistry(serverPath),
            loadMcpToolPolicy(policyPath)
        ])

        expect(registry.servers.every((server) => !server.enabled)).toBe(true)
        expect(policy.defaultDeny).toBe(true)
        expect(policy.entries.every((entry) => !entry.enabled)).toBe(true)
        expect(policy.entries.filter((entry) => entry.serverId === 'msx' && entry.riskClass === 'read').map((entry) => entry.tool)).toEqual([
            'get_opportunity_360',
            'get_account_360',
            'list_pipeline',
            'get_stakeholder_map',
            'list_activities',
            'get_forecast_snapshot'
        ])
        expect(rawConfiguration).not.toMatch(/clientSecret|apiKey|connectionString|accessToken/i)
    })

    it.each([
        ['unknown keys', { schemaVersion: 1, servers: [{ ...validServer, unexpected: true }] }],
        ['duplicate ids', { schemaVersion: 1, servers: [validServer, validServer] }],
        ['non-HTTPS URLs', { schemaVersion: 1, servers: [{ ...validServer, serverUrl: 'http://localhost/mcp' }] }]
    ])('rejects server registries with %s', (_label, candidate) => {
        expect(mcpServerRegistrySchema.safeParse(candidate).success).toBe(false)
    })

    it('allows logical servers to share an identical physical connection', () => {
        const shared = { ...validServer, connectionId: 'msxprod' }
        const candidate = {
            schemaVersion: 1,
            servers: [
                shared,
                { ...shared, id: 'dataverse', displayName: 'Dataverse MCP', serverLabel: 'dataverse_broad' }
            ]
        }

        expect(mcpServerRegistrySchema.safeParse(candidate).success).toBe(true)
        expect(mcpServerRegistrySchema.safeParse({
            ...candidate,
            servers: [candidate.servers[0], { ...candidate.servers[1], serverUrl: 'https://other.example.test/mcp' }]
        }).success).toBe(false)
    })

    it.each([
        ['permissive defaults', { schemaVersion: 1, defaultDeny: false, entries: [] }],
        ['unknown keys', { schemaVersion: 1, defaultDeny: true, entries: [{ ...validPolicyEntry, unexpected: true }] }],
        ['writes without approval', {
            schemaVersion: 1,
            defaultDeny: true,
            entries: [{ ...validPolicyEntry, tool: 'update_milestone', riskClass: 'write' }]
        }],
        ['enabled forbidden tools', {
            schemaVersion: 1,
            defaultDeny: true,
            entries: [{ ...validPolicyEntry, tool: 'delete_record', riskClass: 'forbidden', enabled: true }]
        }],
        ['enabled destructive tools regardless of declared risk', {
            schemaVersion: 1,
            defaultDeny: true,
            entries: [{ ...validPolicyEntry, tool: 'delete_record', enabled: true }]
        }]
    ])('rejects tool policies with %s', (_label, candidate) => {
        expect(mcpToolPolicySchema.safeParse(candidate).success).toBe(false)
    })
})