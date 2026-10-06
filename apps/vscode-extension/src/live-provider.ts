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
import { LiveMsxConnector, LiveMeetingCaptureConnector, msxWriteMetadataFromEnvironment } from '../../../packages/connectors/msx/index.js'
import { JsonFilePortfolioPreferenceStore } from '../../../packages/connectors/common/index.js'
import { createFoundryOpenAIClient, FoundryPromptAgent } from '../../../packages/connectors/foundry/index.js'
import { createFoundryMeetingExtractor } from '../../../packages/agents/meeting-signal-extractor/src/foundry-extractor.js'
import type { MeetingExtractorFn } from '../../../packages/connectors/local-store/index.js'
import { ThinSliceOrchestrator, type AgentTaskContext, type TaskAgentRegistry } from '../../../packages/orchestrator/index.js'
import { createLivePlayWorkflowHost, type WorkflowStepErrorInfo } from '../../../packages/orchestrator/workflows/index.js'
import type { ExtensionDataProvider } from './data-provider.js'
import { ExtensionMcemGuidanceConnector } from './mcem-guidance.js'
import { AGENT_CAPABILITIES, buildLiveDataProvider, buildLiveTaskAgents } from './live-provider-core.js'

/**
 * Builds a Foundry model-backed meeting-signal extractor when `TLC_MEETING_EXTRACTOR=foundry`.
 * Reads the checked-in Foundry environment and authenticates with Azure CLI (same as the agents).
 * Model defaults to `gpt-6.1-sol`; override with `TLC_MEETING_MODEL`. Returns undefined to keep
 * the deterministic offline extractor.
 */
export function buildFoundryMeetingExtractor(environment: NodeJS.ProcessEnv = process.env): MeetingExtractorFn | undefined {
    if ((environment['TLC_MEETING_EXTRACTOR'] ?? '').toLowerCase() !== 'foundry') return undefined
    const parsed = foundryEnvironmentSchema.safeParse(foundryEnvironmentJson)
    if (!parsed.success) return undefined
    const env = parsed.data
    const credential = new AzureCliCredential({ tenantId: env.authentication.foundryTenantId, processTimeoutInMs: 30_000 })
    const openAIClient = createFoundryOpenAIClient(env.foundry.projectEndpoint, credential)
    const model = environment['TLC_MEETING_MODEL']?.trim() || 'gpt-6.1-sol'
    return createFoundryMeetingExtractor({ openAIClient, model, requestTimeoutMs: env.foundry.requestTimeoutMs })
}

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
    useFoundryAgents = true,
    preferenceFilePath?: string
): ExtensionDataProvider {
    const registry = mcpServerRegistrySchema.parse(mcpServersJson)
    const policy = mcpToolPolicySchema.parse(mcpToolPolicyJson)
    const entityMap = dataverseEntityMapSchema.parse(dataverseEntityMapJson)
    const metadata = msxWriteMetadataFromEnvironment(process.env)
    const msx = preferenceFilePath
        ? new LiveMsxConnector({ getAccessToken: getToken }, fetch, undefined, undefined, metadata, new JsonFilePortfolioPreferenceStore(preferenceFilePath))
        : new LiveMsxConnector({ getAccessToken: getToken }, fetch, undefined, undefined, metadata)
    const taskAgents = (useFoundryAgents ? buildFoundryTaskAgents() : undefined) ?? buildLiveTaskAgents()
    const orchestrator = new ThinSliceOrchestrator(msx, new ExtensionMcemGuidanceConnector(), taskAgents)
    const meetingConnector = new LiveMeetingCaptureConnector(msx)
    const meetingExtractor = buildFoundryMeetingExtractor()

    const configured = createLivePlayWorkflowHost({
        registry,
        policy,
        entityMap,
        getAccessToken: () => getToken(),
        resolveCurrentUserId: () => msx.getCurrentUserId(),
        resolveExcludedAccountIds: async () => (await msx.listAccounts({ includeHidden: true }))
            .filter((candidate) => candidate.visibility === 'hidden')
            .map((candidate) => candidate.id),
        ...(onStepError ? { onStepError } : {})
    })
    return buildLiveDataProvider({ orchestrator, host: configured.host, account, meetingConnector, ...(meetingExtractor ? { meetingExtractor } : {}), dispose: () => configured.dispose() })
}
