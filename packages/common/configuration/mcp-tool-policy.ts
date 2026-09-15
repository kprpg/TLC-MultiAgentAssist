import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { agentCapabilitySchema } from '../contracts/index.js'
import { mcpServerIdSchema } from './mcp-servers.js'

export const toolRiskClassSchema = z.enum(['explore', 'read', 'write', 'forbidden'])
export const mcpScopeKindSchema = z.enum(['opportunity', 'account', 'portfolio'])

export const mcpToolPolicyEntrySchema = z.object({
    serverId: mcpServerIdSchema,
    tool: z.string().regex(/^[a-z][a-z0-9_]*$/),
    riskClass: toolRiskClassSchema,
    enabled: z.boolean(),
    approval: z.enum(['none', 'confirm', 'confirm-with-reason']),
    allowedCapabilities: z.array(agentCapabilitySchema).min(1),
    allowedScopes: z.array(mcpScopeKindSchema).min(1),
    maxRows: z.number().int().min(1).max(5_000).optional(),
    redactFields: z.array(z.string().min(1)).default([]),
    rateLimitPerMinute: z.number().int().min(1).max(120).optional(),
    notes: z.string().max(500).optional()
}).strict().superRefine((entry, context) => {
    if (entry.riskClass === 'write' && entry.approval === 'none') {
        context.addIssue({
            code: 'custom',
            path: ['approval'],
            message: 'Write tools must require approval.'
        })
    }

    if (entry.riskClass === 'forbidden' && entry.enabled) {
        context.addIssue({
            code: 'custom',
            path: ['enabled'],
            message: 'Forbidden tools cannot be enabled.'
        })
    }

    if (/^(delete|drop|truncate)(_|$)/i.test(entry.tool) && entry.enabled) {
        context.addIssue({
            code: 'custom',
            path: ['enabled'],
            message: 'Destructive tools cannot be enabled.'
        })
    }
})

export const mcpToolPolicySchema = z.object({
    schemaVersion: z.literal(1),
    defaultDeny: z.literal(true),
    entries: z.array(mcpToolPolicyEntrySchema)
}).strict().superRefine((policy, context) => {
    const keys = policy.entries.map((entry) => `${entry.serverId}:${entry.tool}`)
    if (new Set(keys).size !== keys.length) {
        context.addIssue({
            code: 'custom',
            path: ['entries'],
            message: 'MCP tool policy entries must be unique by server and tool.'
        })
    }
})

export type ToolRiskClass = z.infer<typeof toolRiskClassSchema>
export type McpScopeKind = z.infer<typeof mcpScopeKindSchema>
export type McpToolPolicyEntry = z.infer<typeof mcpToolPolicyEntrySchema>
export type McpToolPolicy = z.infer<typeof mcpToolPolicySchema>

export async function loadMcpToolPolicy(filePath: string): Promise<McpToolPolicy> {
    let content: string
    try {
        content = await readFile(filePath, 'utf8')
    } catch (cause) {
        throw new Error(`Unable to read MCP tool policy: ${filePath}`, { cause })
    }

    let candidate: unknown
    try {
        candidate = JSON.parse(content)
    } catch (cause) {
        throw new Error(`MCP tool policy is not valid JSON: ${filePath}`, { cause })
    }

    return mcpToolPolicySchema.parse(candidate)
}