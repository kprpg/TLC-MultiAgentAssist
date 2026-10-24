import {
    createPerformanceReporter,
    dataverseEntityMapSchema,
    mcpServerRegistrySchema,
    mcpToolPolicySchema,
    type PerformanceReporter
} from '../../../packages/common/index.js'
import type { TokenCredential } from '@azure/core-auth'
import { foundryEnvironmentSchema } from '../../../packages/common/configuration/foundry-environment.js'
import mcpServersJson from '../../../config/mcp.servers.json' with { type: 'json' }
import mcpToolPolicyJson from '../../../config/mcp.tool-policy.json' with { type: 'json' }
import dataverseEntityMapJson from '../../../config/dataverse.entity-map.json' with { type: 'json' }
import foundryEnvironmentJson from '../../../config/foundry.environment.json' with { type: 'json' }
import { LiveMsxConnector, LiveMeetingCaptureConnector, msxWriteMetadataFromEnvironment } from '../../../packages/connectors/msx/index.js'
import { RecordCreationService } from '../../../packages/orchestrator/record-creation/service.js'
import { JsonFilePortfolioPreferenceStore, MemoryPortfolioPreferenceStore } from '../../../packages/connectors/common/index.js'
import { createFoundryOpenAIClient } from '../../../packages/connectors/foundry/index.js'
import { createFoundryMeetingExtractor } from '../../../packages/agents/meeting-signal-extractor/src/foundry-extractor.js'
import type { MeetingExtractorFn } from '../../../packages/connectors/local-store/index.js'
import type { TaskAgentRegistry } from '../../../packages/orchestrator/index.js'
import { createFoundryTaskAgents } from '../../../packages/orchestrator/task-agents.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { createLivePlayWorkflowHost, type WorkflowStepErrorInfo } from '../../../packages/orchestrator/workflows/index.js'
import type { ExtensionDataProvider } from './data-provider.js'
import { ExtensionMcemGuidanceConnector } from './mcem-guidance.js'
import { buildLiveDataProvider, buildLiveTaskAgents } from './live-provider-core.js'
import { createStagePipelineReviewHost } from '../../../packages/orchestrator/stage-pipeline-review.js'
import { bindSourceToken } from '../../../packages/orchestrator/mutations/core-adapter.js'
import { createSeReportingHost } from '../../../packages/orchestrator/se-reporting/composition.js'
import type { SeReportingResource } from '../../../packages/common/contracts/se-reporting.js'
import { createKnowledgeSearch } from '../../../packages/orchestrator/knowledge-search.js'

export function configuredFoundryTenantId(): string | undefined {
    const parsed = foundryEnvironmentSchema.safeParse(foundryEnvironmentJson)
    return parsed.success ? parsed.data.authentication.foundryTenantId : undefined
}

/**
 * Builds a Foundry model-backed meeting-signal extractor when `TLC_MEETING_EXTRACTOR=foundry`.
 * Reads the checked-in Foundry environment and authenticates with VS Code's Microsoft provider.
 * Model defaults to `gpt-6.1-sol`; override with `TLC_MEETING_MODEL`. Returns undefined to keep
 * the deterministic offline extractor.
 */
export function buildFoundryMeetingExtractor(
    environment: NodeJS.ProcessEnv = process.env,
    credential?: TokenCredential
): MeetingExtractorFn | undefined {
    if ((environment['TLC_MEETING_EXTRACTOR'] ?? '').toLowerCase() !== 'foundry' || !credential) return undefined
    const parsed = foundryEnvironmentSchema.safeParse(foundryEnvironmentJson)
    if (!parsed.success) return undefined
    const env = parsed.data
    const openAIClient = createFoundryOpenAIClient(env.foundry.projectEndpoint, credential)
    const model = environment['TLC_MEETING_MODEL']?.trim() || 'gpt-6.1-sol'
    return createFoundryMeetingExtractor({ openAIClient, model, requestTimeoutMs: env.foundry.requestTimeoutMs })
}

/** Real Foundry prompt agents using the checked-in environment and VS Code's Microsoft sign-in. */
export function buildFoundryTaskAgents(credential?: TokenCredential, performanceReporter?: PerformanceReporter): TaskAgentRegistry | undefined {
    if (!credential) return undefined
    const parsed = foundryEnvironmentSchema.safeParse(foundryEnvironmentJson)
    if (!parsed.success) return undefined
    return createFoundryTaskAgents(parsed.data, credential, undefined, performanceReporter)
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
    preferenceFilePath?: string,
    foundryCredential?: TokenCredential,
    getReportingToken?: (resource: SeReportingResource) => Promise<string>,
    getGraphKnowledgeToken?: () => Promise<string>
): ExtensionDataProvider {
    const sourceToken = bindSourceToken(getToken, 'https://microsoftsales.crm.dynamics.com')
    const registry = mcpServerRegistrySchema.parse(mcpServersJson)
    const policy = mcpToolPolicySchema.parse(mcpToolPolicyJson)
    const entityMap = dataverseEntityMapSchema.parse(dataverseEntityMapJson)
    const metadata = msxWriteMetadataFromEnvironment(process.env)
    const performanceReporter = createPerformanceReporter(process.env['TLC_PERFORMANCE'] === '1',
        (message) => console.info(`[performance] ${message}`))
    const portfolioPreferenceStore = preferenceFilePath
        ? new JsonFilePortfolioPreferenceStore(preferenceFilePath)
        : new MemoryPortfolioPreferenceStore()
    const msx = new LiveMsxConnector({ getAccessToken: sourceToken }, fetch, undefined, performanceReporter, metadata, portfolioPreferenceStore)
    const taskAgents = (useFoundryAgents ? buildFoundryTaskAgents(foundryCredential, performanceReporter) : undefined) ?? buildLiveTaskAgents()
    const orchestrator = new ThinSliceOrchestrator(msx, new ExtensionMcemGuidanceConnector(), taskAgents, performanceReporter, new RecordCreationService(msx, msx),
        createKnowledgeSearch({ mode: 'live', ...(getGraphKnowledgeToken ? { getGraphToken: getGraphKnowledgeToken } : {}) }))
    const meetingConnector = new LiveMeetingCaptureConnector(msx)
    const meetingExtractor = buildFoundryMeetingExtractor(process.env, foundryCredential)

    const configured = createLivePlayWorkflowHost({
        registry,
        policy,
        entityMap,
        getAccessToken: () => sourceToken(),
        resolveCurrentUserId: () => msx.getCurrentUserId(),
        resolveExcludedAccountIds: async () =>
            (await portfolioPreferenceStore.read(await msx.getCurrentUserId())).hiddenAccountIds,
        ...(performanceReporter ? { performanceReporter } : {}),
        ...(onStepError ? { onStepError } : {})
    })
    const reportingHost = createSeReportingHost({
        dataverse: msx,
        mode: 'live', identity: async () => ({ key: account, email: account }),
        ...(getReportingToken ? { getToken: getReportingToken } : {}),
        ...(foundryCredential ? { foundryCredential } : {})
    })
    return buildLiveDataProvider({ orchestrator, host: configured.host, account, meetingConnector, getSourceToken: sourceToken, reportingHost, stagePipelineHost: createStagePipelineReviewHost({ mode: 'live', source: msx }), ...(meetingExtractor ? { meetingExtractor } : {}), dispose: () => configured.dispose() })
}
