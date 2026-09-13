import type {
    AgentCapability,
    McpScopeKind,
    McpServerId,
    McpToolPolicy,
    McpToolPolicyEntry
} from '../../common/index.js'

export type McpToolApproval = {
    confirmed: true
    reason?: string
}

export type McpToolAuthorizationRequest = {
    serverId: McpServerId
    tool: string
    capability: AgentCapability
    scope: McpScopeKind
    approval?: McpToolApproval
    toolAnnotations?: Readonly<Record<string, unknown>>
}

export type McpToolAuthorizationErrorCode =
    | 'tool_denied'
    | 'capability_denied'
    | 'scope_denied'
    | 'approval_required'

export class McpToolAuthorizationError extends Error {
    constructor(readonly code: McpToolAuthorizationErrorCode, message: string) {
        super(message)
        this.name = 'McpToolAuthorizationError'
    }
}

const destructiveToolName = /^(delete|drop|truncate)(_|$)/i

export function authorizeMcpTool(
    policy: McpToolPolicy,
    request: McpToolAuthorizationRequest
): McpToolPolicyEntry {
    if (destructiveToolName.test(request.tool)) {
        throw new McpToolAuthorizationError('tool_denied', 'Destructive MCP tools are forbidden.')
    }

    const entry = policy.entries.find((candidate) =>
        candidate.serverId === request.serverId && candidate.tool === request.tool)
    if (!entry || !entry.enabled || entry.riskClass === 'forbidden') {
        throw new McpToolAuthorizationError('tool_denied', 'MCP tool invocation is not allowed.')
    }
    if (!entry.allowedCapabilities.includes(request.capability)) {
        throw new McpToolAuthorizationError('capability_denied', 'Agent capability is not allowed to invoke this MCP tool.')
    }
    if (!entry.allowedScopes.includes(request.scope)) {
        throw new McpToolAuthorizationError('scope_denied', 'Request scope is not allowed for this MCP tool.')
    }
    if (entry.riskClass === 'write' || entry.approval !== 'none') {
        if (!request.approval?.confirmed) {
            throw new McpToolAuthorizationError('approval_required', 'MCP tool invocation requires user approval.')
        }
        if (entry.approval === 'confirm-with-reason' && !request.approval.reason?.trim()) {
            throw new McpToolAuthorizationError('approval_required', 'MCP tool invocation requires an approval reason.')
        }
    }

    return entry
}