import {
    dataverseEntityMapSchema,
    mcpServerRegistrySchema,
    mcpToolPolicySchema,
    type AgentCapability
} from '../../../packages/common/index.js'
import { foundryEnvironmentSchema } from '../../../packages/common/configuration/foundry-environment.js'
import mcpServersJson from '../../../config/mcp.servers.json' with { type: 'json' }
import mcpToolPolicyJson from '../../../config/mcp.tool-policy.json' with { type: 'json' }
import dataverseEntityMapJson from '../../../config/dataverse.entity-map.json' with { type: 'json' }
import foundryEnvironmentJson from '../../../config/foundry.environment.json' with { type: 'json' }
import { AzureCliCredential } from '@azure/identity'
import { LiveMsxConnector } from '../../../packages/connectors/msx/index.js'
import { createFoundryOpenAIClient, FoundryPromptAgent } from '../../../packages/connectors/foundry/index.js'
import { ThinSliceOrchestrator, type AgentTaskContext, type TaskAgentRegistry } from '../../../packages/orchestrator/index.js'
import { createLivePlayWorkflowHost, type WorkflowStepErrorInfo } from '../../../packages/orchestrator/workflows/index.js'
import type { ExtensionDataProvider } from './data-provider.js'
import { ExtensionMcemGuidanceConnector } from './mcem-guidance.js'
import { AGENT_CAPABILITIES, buildLiveDataProvider, buildLiveTaskAgents } from './live-provider-core.js'

/** Real Foundry prompt agents (Desktop/Web parity) using the checked-in Foundry environment + Azure CLI auth. */
function buildFoundryTaskAgents(): TaskAgentRegistry | undefined {
    const parsed = foundryEnvironmentSchema.safeParse(foundryEnvironmentJson)
    if (!parsed.success) return undefined
    const environment = parsed.data
    const credential = new AzureCliCredential({ tenantId: environment.authentication.foundryTenantId, processTimeoutInMs: 30_000 })
    const openAIClient = createFoundryOpenAIClient(environment.foundry.projectEndpoint, credential)
    const bindings: Record<AgentCapability, { name: string }> = {
        'account-pulse': environment.foundry.agents.accountPulse,
        'mcem-coach': environment.foundry.agents.mcemCoach,
        'pursuit-executive': environment.foundry.agents.pursuitExecutive,
        'risk-solution-play': environment.foundry.agents.riskSolutionPlay
    }
    return Object.fromEntries(AGENT_CAPABILITIES.map((capability) => [capability, {
        version: 'active',
        agent: new FoundryPromptAgent<AgentTaskContext>({
            projectEndpoint: environment.foundry.projectEndpoint,
            agentName: bindings[capability].name,
            requestTimeoutMs: environment.foundry.requestTimeoutMs,
            credential,
            openAIClient
        })
    }])) as TaskAgentRegistry
}

/**
 * Live provider (Desktop/Web parity). Portfolio, writes, MCEM evaluation, and agent guidance
 * flow through the shared orchestrator over the delegated MSX OData connection; Plays flow
 * through the shared live Play host (Dataverse MCP read_query, deal-team scoped). MCEM uses the
 * versioned fixture guidance criteria and agents render deterministic guidance over live context,
 * so no Foundry credential or PDF bundle is required in the extension host.
 */
export function createLiveDataProvider(
    getToken: () => Promise<string>,
    account: string,
    onStepError?: (info: WorkflowStepErrorInfo) => void,
    useFoundryAgents = true
): ExtensionDataProvider {
    const registry = mcpServerRegistrySchema.parse(mcpServersJson)
    const policy = mcpToolPolicySchema.parse(mcpToolPolicyJson)
    const entityMap = dataverseEntityMapSchema.parse(dataverseEntityMapJson)
    const msx = new LiveMsxConnector({ getAccessToken: getToken })
    const taskAgents = (useFoundryAgents ? buildFoundryTaskAgents() : undefined) ?? buildLiveTaskAgents()
    const orchestrator = new ThinSliceOrchestrator(msx, new ExtensionMcemGuidanceConnector(), taskAgents)

    const configured = createLivePlayWorkflowHost({
        registry,
        policy,
        entityMap,
        getAccessToken: () => getToken(),
        resolveCurrentUserId: () => msx.getCurrentUserId(),
        ...(onStepError ? { onStepError } : {})
    })
    return buildLiveDataProvider({ orchestrator, host: configured.host, account, dispose: () => configured.dispose() })
}
