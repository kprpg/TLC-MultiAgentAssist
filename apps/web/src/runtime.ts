import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity'
import { resolve } from 'node:path'
import { loadDataverseEntityMap, loadMcpServerRegistry, loadMcpToolPolicy } from '../../../packages/common/index.js'
import { loadFoundryEnvironmentFromEnvironment } from '../../../packages/common/configuration/foundry-environment.js'
import { LiveMeetingCaptureConnector, LiveMsxConnector, msxWriteMetadataFromEnvironment } from '../../../packages/connectors/msx/index.js'
import { JsonFilePortfolioPreferenceStore } from '../../../packages/connectors/common/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { RecordCreationService } from '../../../packages/orchestrator/record-creation/service.js'
import { createFoundryOpenAIClient } from '../../../packages/connectors/foundry/index.js'
import { createFoundryMeetingExtractor } from '../../../packages/agents/meeting-signal-extractor/src/foundry-extractor.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { createFoundryTaskAgents } from '../../../packages/orchestrator/task-agents.js'
import { createLivePlayWorkflowHost, type WorkflowHost } from '../../../packages/orchestrator/workflows/index.js'
import { createSellerDashboardHost, type SellerDashboardHost } from '../../../packages/orchestrator/seller-dashboard.js'
import type { AuthenticatedRequest, WebRuntime } from './app.js'

export function createWebSellerDashboardHost(mode: 'sample' | 'live'): SellerDashboardHost {
    return createSellerDashboardHost({
        mode,
        allowLocalProfile: false,
        resolveUserEmail: async () => undefined
    })
}

export interface HostedRuntimeOptions {
    environment?: NodeJS.ProcessEnv
    workingDirectory?: string
}

export async function createHostedRuntimeFactory(options: HostedRuntimeOptions = {}) {
    const environment = options.environment ?? process.env
    const workingDirectory = options.workingDirectory ?? process.cwd()
    const foundryEnvironment = await loadFoundryEnvironmentFromEnvironment(environment, workingDirectory)
    const managedIdentityClientId = environment['AZURE_CLIENT_ID']?.trim()
    const foundryCredential = environment['WEBSITE_SITE_NAME']
        ? managedIdentityClientId
            ? new ManagedIdentityCredential(managedIdentityClientId)
            : new ManagedIdentityCredential()
        : new AzureCliCredential({
            tenantId: foundryEnvironment.authentication.foundryTenantId,
            processTimeoutInMs: 30_000
        })
    const foundryClient = createFoundryOpenAIClient(foundryEnvironment.foundry.projectEndpoint, foundryCredential)
    const taskAgents = createFoundryTaskAgents(foundryEnvironment, foundryCredential, foundryClient)
    const guidance = new LocalPdfMcemGuidanceConnector(
        resolve(workingDirectory, environment['TLC_MCEM_GUIDANCE_PATH']?.trim() || 'docs/knowledge/MCEM Overview.pdf')
    )
    const portfolioPreferenceStore = new JsonFilePortfolioPreferenceStore(
        resolve(workingDirectory, environment['TLC_PORTFOLIO_PREFERENCES_PATH']?.trim() || '.tlc/portfolio-preferences.json')
    )
    /** Foundry model-backed meeting-signal extractor when TLC_MEETING_EXTRACTOR=foundry; else the deterministic offline extractor. */
    const meetingExtractor = (environment['TLC_MEETING_EXTRACTOR'] ?? '').toLowerCase() === 'foundry'
        ? createFoundryMeetingExtractor({
            openAIClient: foundryClient,
            model: environment['TLC_MEETING_MODEL']?.trim() || 'gpt-6.1-sol',
            requestTimeoutMs: foundryEnvironment.foundry.requestTimeoutMs
        })
        : undefined

    return ({ accessToken }: AuthenticatedRequest): WebRuntime => {
        const msx = new LiveMsxConnector({ getAccessToken: async () => accessToken }, fetch, undefined, undefined, msxWriteMetadataFromEnvironment(environment), portfolioPreferenceStore)
        const meetingConnector = new LiveMeetingCaptureConnector(msx)
        return Object.assign(new ThinSliceOrchestrator(msx, guidance, taskAgents, undefined, new RecordCreationService(msx, msx)), {
            listMeetingTranscripts: () => meetingConnector.listMeetingTranscripts(),
            getMeetingTranscript: async () => (await meetingConnector.getMeetingTranscript()) ?? null,
            proposeMeetingChangeSet: (request: { opportunityId: string; transcriptId?: string; rawTranscript?: { content: string; format?: 'vtt' | 'text'; meetingType?: 'customer' | 'internal' } }) => {
                const transcript = request.rawTranscript
                    ? parseTranscriptContent(request.rawTranscript.content, {
                        opportunityId: request.opportunityId,
                        ...(request.rawTranscript.format ? { format: request.rawTranscript.format } : {}),
                        ...(request.rawTranscript.meetingType ? { meetingType: request.rawTranscript.meetingType } : {})
                    })
                    : undefined
                return meetingConnector.proposeMeetingChangeSet({
                    opportunityId: request.opportunityId,
                    ...(request.transcriptId ? { transcriptId: request.transcriptId } : {}),
                    ...(transcript ? { transcript } : {})
                }, meetingExtractor)
            },
            applyMeetingChangeSet: (input: Parameters<LiveMeetingCaptureConnector['applyMeetingChangeSet']>[0]) => meetingConnector.applyMeetingChangeSet(input)
        }) as WebRuntime
    }
}

export async function createHostedWorkflowHostResolver(options: HostedRuntimeOptions = {}) {
    const environment = options.environment ?? process.env
    const workingDirectory = options.workingDirectory ?? process.cwd()
    const [registry, policy, entityMap] = await Promise.all([
        loadMcpServerRegistry(resolve(workingDirectory, 'config/mcp.servers.json')),
        loadMcpToolPolicy(resolve(workingDirectory, 'config/mcp.tool-policy.json')),
        loadDataverseEntityMap(resolve(workingDirectory, 'config/dataverse.entity-map.json'))
    ])
    const portfolioPreferenceStore = new JsonFilePortfolioPreferenceStore(
        resolve(workingDirectory, environment['TLC_PORTFOLIO_PREFERENCES_PATH']?.trim() || '.tlc/portfolio-preferences.json')
    )
    const hosts = new Map<string, {
        host: WorkflowHost
        dispose(): Promise<void>
        token: { value: string }
        lastUsed: number
    }>()

    return async (authentication: AuthenticatedRequest): Promise<WorkflowHost> => {
        const principalKey = authentication.clientPrincipal
        const existing = hosts.get(principalKey)
        if (existing) {
            existing.token.value = authentication.accessToken
            existing.lastUsed = Date.now()
            return existing.host
        }

        await evictOldestWorkflowHost(hosts)
        const token = { value: authentication.accessToken }
        const msx = new LiveMsxConnector({ getAccessToken: async () => token.value }, fetch, undefined, undefined, msxWriteMetadataFromEnvironment(environment), portfolioPreferenceStore)
        const configured = createLivePlayWorkflowHost({
            registry,
            policy,
            entityMap,
            getAccessToken: async () => token.value,
            resolveCurrentUserId: () => msx.getCurrentUserId(),
            resolveExcludedAccountIds: async () =>
                (await portfolioPreferenceStore.read(await msx.getCurrentUserId())).hiddenAccountIds,
            onStepError: (info) => {
                console.error(`[play ${info.workflowId}] ${info.connector}/${info.operation} ${info.required ? 'required' : 'optional'} step failed: ${info.message}`)
            }
        })
        hosts.set(principalKey, { host: configured.host, dispose: configured.dispose, token, lastUsed: Date.now() })
        return configured.host
    }
}

export async function evictOldestWorkflowHost<T extends { lastUsed: number; dispose(): Promise<void> }>(
    hosts: Map<string, T>,
    maximumSize = 100
): Promise<void> {
    if (hosts.size < maximumSize) return
    const oldest = [...hosts.entries()].sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0]
    if (!oldest) return
    hosts.delete(oldest[0])
    await oldest[1].dispose()
}