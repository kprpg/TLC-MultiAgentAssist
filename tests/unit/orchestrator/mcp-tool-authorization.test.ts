import { describe, expect, it } from 'vitest'
import type { McpToolPolicy, McpToolPolicyEntry } from '../../../packages/common/index.js'
import {
    authorizeMcpTool,
    McpToolAuthorizationError
} from '../../../packages/orchestrator/policies/mcp-tool-authorization.js'

function entry(overrides: Partial<McpToolPolicyEntry> = {}): McpToolPolicyEntry {
    return {
        serverId: 'dataverse',
        tool: 'read_query',
        riskClass: 'read',
        enabled: true,
        approval: 'none',
        allowedCapabilities: ['account-pulse'],
        allowedScopes: ['opportunity'],
        maxRows: 100,
        redactFields: [],
        rateLimitPerMinute: 30,
        ...overrides
    }
}

function policy(policyEntry = entry()): McpToolPolicy {
    return { schemaVersion: 1, defaultDeny: true, entries: [policyEntry] }
}

const request = {
    serverId: 'dataverse',
    tool: 'read_query',
    capability: 'account-pulse',
    scope: 'opportunity'
} as const

describe('authorizeMcpTool', () => {
    it('returns only an exact enabled server and tool match', () => {
        expect(authorizeMcpTool(policy(), request)).toEqual(entry())
        expect(() => authorizeMcpTool(policy(), { ...request, tool: 'unknown_tool' }))
            .toThrowError(expect.objectContaining({ code: 'tool_denied' }))
        expect(() => authorizeMcpTool(policy(entry({ enabled: false })), request))
            .toThrowError(expect.objectContaining({ code: 'tool_denied' }))
    })

    it('denies capability and scope mismatches', () => {
        expect(() => authorizeMcpTool(policy(), { ...request, capability: 'mcem-coach' }))
            .toThrowError(expect.objectContaining({ code: 'capability_denied' }))
        expect(() => authorizeMcpTool(policy(), { ...request, scope: 'portfolio' }))
            .toThrowError(expect.objectContaining({ code: 'scope_denied' }))
    })

    it('hard-blocks destructive names despite misleading tool annotations', () => {
        const destructive = entry({ tool: 'delete_record', riskClass: 'read', enabled: true })
        expect(() => authorizeMcpTool(policy(destructive), {
            ...request,
            tool: 'delete_record',
            toolAnnotations: { readOnlyHint: true, destructiveHint: false }
        })).toThrowError(expect.objectContaining({ code: 'tool_denied' }))
    })

    it('requires confirmation and a reason when configured for writes', () => {
        const writePolicy = policy(entry({
            tool: 'update_milestone',
            riskClass: 'write',
            approval: 'confirm-with-reason'
        }))
        const writeRequest = { ...request, tool: 'update_milestone' }

        expect(() => authorizeMcpTool(writePolicy, writeRequest))
            .toThrowError(expect.objectContaining({ code: 'approval_required' }))
        expect(() => authorizeMcpTool(writePolicy, { ...writeRequest, approval: { confirmed: true } }))
            .toThrowError(expect.objectContaining({ code: 'approval_required' }))
        expect(authorizeMcpTool(writePolicy, {
            ...writeRequest,
            approval: { confirmed: true, reason: 'Customer approved this update.' }
        }).riskClass).toBe('write')
    })

    it('uses a typed authorization error', () => {
        expect(() => authorizeMcpTool(policy(), { ...request, tool: 'missing' }))
            .toThrowError(McpToolAuthorizationError)
    })
})