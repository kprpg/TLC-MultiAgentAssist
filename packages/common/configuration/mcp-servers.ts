import { readFile } from 'node:fs/promises'
import { z } from 'zod'

export const mcpServerIdSchema = z.enum(['dataverse', 'msx'])

export const mcpServerSchema = z.object({
    id: mcpServerIdSchema,
    connectionId: z.string().regex(/^[a-z][a-z0-9_-]*$/).optional(),
    displayName: z.string().min(1),
    enabled: z.boolean(),
    execution: z.literal('local-client'),
    serverUrl: z.string().url().refine((value) => new URL(value).protocol === 'https:', {
        message: 'MCP server URLs must use HTTPS.'
    }),
    serverLabel: z.string().regex(/^[a-z][a-z0-9_]*$/),
    authentication: z.object({
        kind: z.literal('entra-delegated'),
        scopes: z.array(z.string().min(1)).min(1)
    }).strict(),
    limits: z.object({
        connectTimeoutMs: z.number().int().min(1_000).max(60_000),
        callTimeoutMs: z.number().int().min(1_000).max(120_000),
        maxConcurrentCalls: z.number().int().min(1).max(8),
        maxToolCallsPerRequest: z.number().int().min(1).max(12),
        maxRowsPerCall: z.number().int().min(1).max(5_000),
        maxResultBytes: z.number().int().min(1_024).max(2_000_000)
    }).strict(),
    retry: z.object({
        maxAttempts: z.number().int().min(1).max(4),
        initialDelayMs: z.number().int().min(50).max(5_000),
        backoffMultiplier: z.number().min(1).max(4),
        retryOnStatus: z.array(z.number().int().min(400).max(599)).default([429, 500, 502, 503, 504])
    }).strict(),
    circuitBreaker: z.object({
        failureThreshold: z.number().int().min(1).max(20),
        openDurationMs: z.number().int().min(1_000).max(600_000)
    }).strict()
}).strict()

export const mcpServerRegistrySchema = z.object({
    schemaVersion: z.literal(1),
    servers: z.array(mcpServerSchema).min(1)
}).strict().superRefine((registry, context) => {
    const ids = registry.servers.map((server) => server.id)
    if (new Set(ids).size !== ids.length) {
        context.addIssue({
            code: 'custom',
            path: ['servers'],
            message: 'MCP server ids must be unique.'
        })
    }

    const connections = new Map<string, string>()
    for (const [index, server] of registry.servers.entries()) {
        const connectionId = server.connectionId ?? server.id
        const fingerprint = JSON.stringify({
            serverUrl: server.serverUrl,
            authentication: server.authentication,
            limits: server.limits,
            retry: server.retry,
            circuitBreaker: server.circuitBreaker
        })
        const existing = connections.get(connectionId)
        if (existing !== undefined && existing !== fingerprint) {
            context.addIssue({
                code: 'custom',
                path: ['servers', index, 'connectionId'],
                message: 'MCP servers sharing a connectionId must use identical connection settings.'
            })
        } else {
            connections.set(connectionId, fingerprint)
        }
    }
})

export type McpServerId = z.infer<typeof mcpServerIdSchema>
export type McpServer = z.infer<typeof mcpServerSchema>
export type McpServerRegistry = z.infer<typeof mcpServerRegistrySchema>

export async function loadMcpServerRegistry(filePath: string): Promise<McpServerRegistry> {
    return mcpServerRegistrySchema.parse(await readJson(filePath, 'MCP server registry'))
}

async function readJson(filePath: string, label: string): Promise<unknown> {
    let content: string
    try {
        content = await readFile(filePath, 'utf8')
    } catch (cause) {
        throw new Error(`Unable to read ${label}: ${filePath}`, { cause })
    }

    try {
        return JSON.parse(content)
    } catch (cause) {
        throw new Error(`${label} is not valid JSON: ${filePath}`, { cause })
    }
}