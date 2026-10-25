import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity'
import type { TokenCredential } from '@azure/core-auth'
import { resolve } from 'node:path'
import { createPerformanceReporter, loadDataverseEntityMap, loadMcpServerRegistry, loadMcpToolPolicy } from '../../../packages/common/index.js'
import { loadFoundryEnvironmentFromEnvironment } from '../../../packages/common/configuration/foundry-environment.js'
import type { MeetingTokenPurpose } from '../../../packages/common/configuration/meeting-sources.js'
import { LiveMeetingCaptureConnector, LiveMsxConnector, msxWriteMetadataFromEnvironment } from '../../../packages/connectors/msx/index.js'
import { GraphMeetingConnector } from '../../../packages/connectors/graph/meetings.js'
import { JsonFilePortfolioPreferenceStore } from '../../../packages/connectors/common/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { RecordCreationService } from '../../../packages/orchestrator/record-creation/service.js'
import { createFoundryOpenAIClient } from '../../../packages/connectors/foundry/index.js'
import { createFoundryMeetingExtractor } from '../../../packages/agents/meeting-signal-extractor/src/foundry-extractor.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'
import { ThinSliceOrchestrator, prewarmAgentDependencies } from '../../../packages/orchestrator/index.js'
import { createFoundryTaskAgents } from '../../../packages/orchestrator/task-agents.js'
import { createLivePlayWorkflowHost, WorkflowRuntimeError, type WorkflowHost } from '../../../packages/orchestrator/workflows/index.js'
import { createSellerDashboardHost, type SellerDashboardHost } from '../../../packages/orchestrator/seller-dashboard.js'
import { createSeReportingHost, seReportingScopes } from '../../../packages/orchestrator/se-reporting/composition.js'
import { createStagePipelineReviewHost, type StagePipelineReviewHost } from '../../../packages/orchestrator/stage-pipeline-review.js'
import type { SeReportingHost } from '../../../packages/orchestrator/se-reporting/host.js'
import type { AuthenticatedRequest, WebRuntime } from './app.js'
import { hostedMutationState } from '../../../packages/connectors/common/mutation-state.js'
import { createMutationSession } from '../../../packages/orchestrator/mutations/composition.js'
import { MutationRuntime } from '../../../packages/orchestrator/mutations/host.js'
import { createKnowledgeSearch } from '../../../packages/orchestrator/knowledge-search.js'

export function createWebSellerDashboardHost(mode: 'sample' | 'live'): SellerDashboardHost {
    return createSellerDashboardHost({
        mode,
        allowLocalProfile: false,
        resolveUserEmail: async () => undefined
    })
}

export function createWebStagePipelineResolver(
    mode: 'sample' | 'azure-cli' | 'easy-auth',
    options: { environment?: NodeJS.ProcessEnv; fetchImplementation?: typeof fetch; now?: () => number; maxSessions?: number; idleMs?: number } = {}
): (authentication: AuthenticatedRequest) => StagePipelineReviewHost {
    if (mode === 'sample') {
        const sample = createStagePipelineReviewHost({ mode: 'sample' })
        return () => sample
    }
    const now = options.now ?? Date.now
    const maxSessions = options.maxSessions ?? 50
    const idleMs = options.idleMs ?? 3_600_000
    const sessions = new Map<string, { host: StagePipelineReviewHost; token: { value: string }; lastUsed: number }>()
    return (authentication) => {
        const key = authentication.clientPrincipal
        let entry = sessions.get(key)
        if (!entry) {
            if (sessions.size >= maxSessions) {
                for (const [existingKey, existing] of sessions) if (now() - existing.lastUsed > idleMs) sessions.delete(existingKey)
            }
            if (sessions.size >= maxSessions) throw new Error('The dashboard session limit has been reached.')
            const token = { value: authentication.accessToken }
            const msx = new LiveMsxConnector({ getAccessToken: async () => token.value }, options.fetchImplementation ?? fetch, undefined, undefined, msxWriteMetadataFromEnvironment(options.environment ?? process.env))
            entry = { host: createStagePipelineReviewHost({ mode: 'live', source: msx }), token, lastUsed: now() }
            sessions.set(key, entry)
        }
        entry.token.value = authentication.accessToken
        entry.lastUsed = now()
        return entry.host
    }
}

export function createWebSeReportingResolver(
    mode: 'sample' | 'azure-cli' | 'easy-auth', foundryCredential?: TokenCredential, now: () => number = Date.now,
    dependencies: { createHost?: typeof createSeReportingHost; fetchImplementation?: typeof fetch; environment?: NodeJS.ProcessEnv } = {}
) {
    const makeHost = dependencies.createHost ?? createSeReportingHost
    const hosts = new Map<string, { host: SeReportingHost; lastUsed: number; active: number; token: { value: string } }>()
    const credential = mode === 'azure-cli' ? new AzureCliCredential({ processTimeoutInMs: 30_000 }) : undefined
    return (authentication: AuthenticatedRequest) => {
        const key = authentication.userEmail.toLowerCase()
        let entry = hosts.get(key)
        if (!entry) {
            if (hosts.size >= 50) {
                for (const [existingKey, existing] of hosts) {
                    if (existing.active === 0 && now() - existing.lastUsed > 3_600_000) hosts.delete(existingKey)
                }
            }
            if (hosts.size >= 50) throw new Error('The reporting user-session limit has been reached.')
            // Delegated Dataverse reads use the caller's own MSX token (never a server identity); assignments stay on Power BI.
            const token = { value: authentication.accessToken }
            const msx = mode === 'sample' ? undefined : new LiveMsxConnector({ getAccessToken: async () => token.value }, dependencies.fetchImplementation ?? fetch, undefined, undefined, msxWriteMetadataFromEnvironment(dependencies.environment ?? process.env))
            const created = makeHost({
                mode: mode === 'sample' ? 'sample' : 'live',
                ...(msx ? { dataverse: msx } : {}),
                identity: async () => ({ key: `web:${key}`, email: authentication.userEmail }),
                ...(credential ? {
                    getToken: async (resource: keyof typeof seReportingScopes) => {
                        const result = await credential.getToken(seReportingScopes[resource])
                        if (!result) throw new Error('No delegated reporting token was returned.')
                        return result.token
                    }
                } : {}),
                ...(foundryCredential ? { foundryCredential } : {})
            })
            const createdEntry = { host: created, lastUsed: now(), active: 0, token }
            entry = createdEntry
            hosts.set(key, createdEntry)
        }
        const tracked = entry
        if (authentication.accessToken) tracked.token.value = authentication.accessToken
        tracked.lastUsed = now()
        return {
            invoke: async (request: unknown) => {
                tracked.active += 1
                try {
                    return await tracked.host.invoke(request)
                } finally {
                    tracked.active -= 1
                    tracked.lastUsed = now()
                }
            }
        } satisfies SeReportingHost
    }
}

export interface HostedRuntimeOptions {
    environment?: NodeJS.ProcessEnv
    workingDirectory?: string
    getGraphKnowledgeToken?(authentication: AuthenticatedRequest): Promise<string>
    /** Delegated Graph token for Teams meeting lookup. Absent in hosted Easy Auth until a caller-bound provider exists. */
    getGraphMeetingToken?(authentication: AuthenticatedRequest, purpose?: MeetingTokenPurpose): Promise<string>
}

export async function createHostedRuntimeFactory(options: HostedRuntimeOptions = {}) {
    const environment = options.environment ?? process.env
    const workingDirectory = options.workingDirectory ?? process.cwd()
    const performanceReporter = createPerformanceReporter(environment['TLC_PERFORMANCE'] === '1',
        (message) => console.info(`[performance] ${message}`))
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
    const mutationState = hostedMutationState(environment, environment['WEBSITE_SITE_NAME']
        ? managedIdentityClientId ? new ManagedIdentityCredential(managedIdentityClientId) : new ManagedIdentityCredential()
        : new AzureCliCredential())
    const mutationRuntime = new MutationRuntime()
    let conditionalProbe: Promise<ReadonlyArray<'updateOpportunity' | 'updateMilestone' | 'transitionOpportunityStage'>> | undefined
    let conditionalExpiresAt = 0
    const taskAgents = createFoundryTaskAgents(foundryEnvironment, foundryCredential, foundryClient, performanceReporter)
    const guidance = new LocalPdfMcemGuidanceConnector(
        resolve(workingDirectory, environment['TLC_MCEM_GUIDANCE_PATH']?.trim() || 'docs/knowledge/MCEM Overview.pdf')
    )
    void prewarmAgentDependencies({
        credential: foundryCredential, scopes: foundryEnvironment.authentication.scopes.foundry, guidance, performanceReporter
    })
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

    const factory = (authentication: AuthenticatedRequest): WebRuntime => {
        const { accessToken } = authentication
        const msx = new LiveMsxConnector({ getAccessToken: async () => accessToken }, fetch, undefined, performanceReporter, msxWriteMetadataFromEnvironment(environment), portfolioPreferenceStore)
        const meetingConnector = new LiveMeetingCaptureConnector(msx, undefined, options.getGraphMeetingToken
            ? new GraphMeetingConnector((purpose) => options.getGraphMeetingToken!(authentication, purpose)) : undefined)
        const core = new ThinSliceOrchestrator(msx, guidance, taskAgents, performanceReporter, new RecordCreationService(msx, msx),
            createKnowledgeSearch({
                mode: 'live', environment,
                ...(options.getGraphKnowledgeToken ? { getGraphToken: () => options.getGraphKnowledgeToken!(authentication) } : {})
            }))
        const mutations = createMutationSession({
            core, mode: 'live', source: `web:${foundryEnvironment.environment}:https://microsoftsales.crm.dynamics.com`,
            state: mutationState, enabled: environment['TLC_BACKGROUND_SYNC'] === '1', readCacheOwner: 'client',
            getToken: async () => accessToken, runtime: mutationRuntime,
            conditionalOperations: () => {
                if (Date.now() >= conditionalExpiresAt) conditionalProbe = undefined
                if (!conditionalProbe) {
                    conditionalExpiresAt = Date.now() + 30 * 60_000
                    conditionalProbe = core.conditionalWriteOperations().catch((error: unknown) => { conditionalProbe = undefined; throw error })
                }
                return conditionalProbe
            },
            applyMeeting: (input) => meetingConnector.applyMeetingChangeSet(input)
        })
        return Object.assign(core, {
            mutationSync: (request: Parameters<typeof mutations.invoke>[0]) => mutations.invoke(request),
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
    return Object.assign(factory, { foundryCredential, dispose: async () => { await mutationRuntime.drain(); mutationState.close() } })
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
        activeRunCount(): number
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
        const performanceReporter = createPerformanceReporter(environment['TLC_PERFORMANCE'] === '1',
            (message) => console.info(`[performance] ${message}`))
        const configured = createLivePlayWorkflowHost({
            registry,
            policy,
            entityMap,
            getAccessToken: async () => token.value,
            resolveCurrentUserId: () => msx.getCurrentUserId(),
            resolveExcludedAccountIds: async () =>
                (await portfolioPreferenceStore.read(await msx.getCurrentUserId())).hiddenAccountIds,
            ...(performanceReporter ? { performanceReporter } : {}),
            onStepError: (info) => {
                console.error(`[play ${info.workflowId}] ${info.connector}/${info.operation} ${info.required ? 'required' : 'optional'} step failed: ${info.message}`)
            }
        })
        hosts.set(principalKey, {
            host: configured.host, dispose: configured.dispose, token, lastUsed: Date.now(),
            activeRunCount: () => configured.host.activeRunCount()
        })
        return configured.host
    }
}

export async function evictOldestWorkflowHost<T extends { lastUsed: number; dispose(): Promise<void>; activeRunCount?(): number }>(
    hosts: Map<string, T>,
    maximumSize = 100
): Promise<void> {
    if (hosts.size < maximumSize) return
    // A host with active runs owns their state; disposing it would strand them.
    const idle = [...hosts.entries()].filter(([, host]) => (host.activeRunCount?.() ?? 0) === 0)
    const oldest = idle.sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0]
    if (!oldest) {
        throw new WorkflowRuntimeError('capacity_exceeded', 'Every cached workflow session has active runs. Wait for a run to finish, then try again.')
    }
    hosts.delete(oldest[0])
    await oldest[1].dispose()
}