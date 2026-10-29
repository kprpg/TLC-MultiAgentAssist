import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { buildWebApiHandler, type WebRuntime } from './app.js'
import { assertLoopbackHost, createAzureCliAuthentication, createAzureCliGraphKnowledgeTokenProvider, createAzureCliGraphMeetingTokenProvider, createSampleAuthentication } from './authentication.js'
import { buildStaticHandler, setSecurityHeaders } from './hosting.js'
import { listenWebServer } from './listener.js'
import { createHostedRuntimeFactory, createHostedWorkflowHostResolver, createWebSellerDashboardHost, createWebSeReportingResolver, createWebStagePipelineResolver, createWebMomentumResolver } from './runtime.js'
import { createWebWorkingSessionResolver } from './working-session.js'
import { createSampleWorkflowHost } from '../../../packages/orchestrator/workflows/index.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { createLocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { SampleRecordCreationCatalog } from '../../../packages/connectors/local-store/sample-record-creation-catalog.js'
import type { MsxConnector } from '../../../packages/connectors/common/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { createSampleTaskAgents } from '../../../packages/orchestrator/task-agents.js'
import { RecordCreationService } from '../../../packages/orchestrator/record-creation/service.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'
import { localMutationState } from '../../../packages/connectors/common/mutation-state.js'
import { createMutationSession } from '../../../packages/orchestrator/mutations/composition.js'
import { createKnowledgeSearch } from '../../../packages/orchestrator/knowledge-search.js'
import { resolveHostingModel } from '../../../packages/common/configuration/hosting-model.js'
import { SampleInference } from '../../../packages/orchestrator/sample-inference.js'

resolveHostingModel(process.env)
const port = parsePort(process.env['PORT'])
const mode = resolveWebHostMode(process.env)
const sampleInference = mode === 'sample' ? new SampleInference() : undefined
const azureHosted = Boolean(process.env['WEBSITE_SITE_NAME'])
const localExitEnabled = mode !== 'easy-auth' && !azureHosted
const host = process.env['HOST']?.trim() || (mode === 'easy-auth' ? '0.0.0.0' : '127.0.0.1')
if (mode === 'azure-cli') assertLoopbackHost(host)
const staticRoot = resolve(process.env['TLC_WEB_STATIC_ROOT']?.trim() || 'apps/desktop/dist/revamp')
// Sample mode uses the in-memory fixture by default, or the relational SQLite test store when TLC_DATA_STORE=sqlite.
if (sampleInference?.mode === 'foundry' && process.env['TLC_DATA_STORE']?.toLowerCase() === 'fixture') {
    throw new Error('Hybrid sample AI requires TLC_DATA_STORE=sqlite. Set TLC_AI_MODE=sample for offline fixtures.')
}
const localStoreMsx = mode === 'sample' ? createLocalStoreMsxConnector({
    ...process.env, TLC_DATA_STORE: process.env['TLC_DATA_STORE'] || (sampleInference?.mode === 'foundry' ? 'sqlite' : 'fixture')
}) : undefined
const sampleMsx: MsxConnector | undefined = mode === 'sample'
    ? (localStoreMsx ?? new FixtureMsxConnector())
    : undefined
const creationWriter = localStoreMsx?.createRecordCreationWriter()
const meetingUnavailableMessage = 'Meeting capture requires the SQLite test store (sample data) or a live Graph connection.'
const sampleRuntime = sampleMsx
    ? Object.assign(
        new ThinSliceOrchestrator(
            sampleMsx,
            new LocalPdfMcemGuidanceConnector(resolve('docs/knowledge/MCEM Overview.pdf')),
            sampleInference!.taskAgents(createSampleTaskAgents('web-sample-v1')),
            undefined,
            new RecordCreationService(
                sampleMsx,
                creationWriter ?? new SampleRecordCreationCatalog(sampleMsx),
                creationWriter ? { writer: creationWriter } : {}
            ),
            createKnowledgeSearch({ mode: 'sample' })
        ),
        localStoreMsx
            ? {
                listMeetingTranscripts: (opportunityId?: string) => localStoreMsx.listMeetingTranscripts(opportunityId),
                getMeetingTranscript: async (transcriptId: string) => (await localStoreMsx.getMeetingTranscript(transcriptId)) ?? null,
                proposeMeetingChangeSet: (request: { opportunityId: string; transcriptId?: string; rawTranscript?: { content: string; format?: 'vtt' | 'text'; meetingType?: 'customer' | 'internal' } }) => {
                    const transcript = request.rawTranscript
                        ? parseTranscriptContent(request.rawTranscript.content, {
                            opportunityId: request.opportunityId,
                            ...(request.rawTranscript.format ? { format: request.rawTranscript.format } : {}),
                            ...(request.rawTranscript.meetingType ? { meetingType: request.rawTranscript.meetingType } : {})
                        })
                        : undefined
                    return localStoreMsx.proposeMeetingChangeSet({
                        opportunityId: request.opportunityId,
                        ...(request.transcriptId ? { transcriptId: request.transcriptId } : {}),
                        ...(transcript ? { transcript } : {})
                    }, sampleInference?.meetingExtractor())
                },
                applyMeetingChangeSet: (input: Parameters<typeof localStoreMsx['applyMeetingChangeSet']>[0]) => localStoreMsx.applyMeetingChangeSet(input)
            }
            : {
                listMeetingTranscripts: async () => { throw new Error(meetingUnavailableMessage) },
                getMeetingTranscript: async () => { throw new Error(meetingUnavailableMessage) },
                proposeMeetingChangeSet: async () => { throw new Error(meetingUnavailableMessage) },
                applyMeetingChangeSet: async () => { throw new Error(meetingUnavailableMessage) }
            }
    ) as WebRuntime
    : undefined
const createRuntime = sampleRuntime
    ? () => sampleRuntime
    : await createHostedRuntimeFactory(mode === 'azure-cli' ? {
        getGraphKnowledgeToken: createAzureCliGraphKnowledgeTokenProvider(),
        getGraphMeetingToken: createAzureCliGraphMeetingTokenProvider()
    } : {})
const sampleMutationPath = resolve(process.env['TLC_MUTATION_STATE_PATH'] || '.tlc/web-sample-mutations.sqlite')
const sampleMutationState = sampleRuntime && !azureHosted && (process.env['TLC_BACKGROUND_SYNC'] === '1' || existsSync(sampleMutationPath))
    ? await localMutationState(sampleMutationPath) : undefined
const sampleMutations = sampleRuntime instanceof ThinSliceOrchestrator && sampleMutationState ? createMutationSession({
    core: sampleRuntime, mode: 'sample', source: 'web:sample', state: sampleMutationState,
    enabled: process.env['TLC_BACKGROUND_SYNC'] === '1', readCacheOwner: 'client', applyMeeting: (input) => sampleRuntime.applyMeetingChangeSet(input)
}) : undefined
if (sampleRuntime && sampleMutations) sampleRuntime.mutationSync = (request) => sampleMutations.invoke(request)
const sampleWorkflowHost = sampleMsx ? createSampleWorkflowHost(async () => {
    const accounts = await sampleMsx.listAccounts()
    const opportunities = (await Promise.all(accounts.map((account) => sampleMsx.listOpportunities(account.id)))).flat()
    return {
        accountIds: accounts.map((account) => account.id),
        opportunityIds: opportunities.map((opportunity) => opportunity.id)
    }
}) : undefined
const resolveWorkflowHost = sampleWorkflowHost ? () => sampleWorkflowHost : await createHostedWorkflowHostResolver()
const authenticate = mode === 'sample'
    ? createSampleAuthentication()
    : mode === 'azure-cli' ? createAzureCliAuthentication() : undefined
const serveStatic = buildStaticHandler(staticRoot, mode === 'sample' ? 'sample' : 'live',
    (mode === 'sample'
        ? !azureHosted && (process.env['TLC_BACKGROUND_SYNC'] === '1' || sampleMutationState?.durable === true)
        : process.env['TLC_BACKGROUND_SYNC'] === '1' || Boolean(process.env['TLC_MUTATION_TABLE_URL']?.trim())),
    localExitEnabled, sampleInference?.mode)
const handleApi = buildWebApiHandler({
    createRuntime,
    resolveWorkflowHost,
    resolveSellerDashboardHost: () => createWebSellerDashboardHost(mode === 'sample' ? 'sample' : 'live'),
    resolveStagePipelineReviewHost: createWebStagePipelineResolver(mode),
    resolveMomentumFocusHost: createWebMomentumResolver(mode, {
        ...('foundryCredential' in createRuntime && createRuntime.foundryCredential ? { credential: createRuntime.foundryCredential } : {})
    }),
    resolveSeReportingHost: createWebSeReportingResolver(mode, 'foundryCredential' in createRuntime ? createRuntime.foundryCredential : undefined,
        Date.now, sampleInference ? { inference: sampleInference } : {}),
    resolveWorkingSessionHost: createWebWorkingSessionResolver({
        mode: mode === 'sample' ? 'sample' : 'live', createRuntime,
        ...(sampleInference ? { inference: sampleInference } : {}),
        ...('workingSessionModel' in createRuntime && createRuntime.workingSessionModel ? { model: createRuntime.workingSessionModel } : {})
    }),
    ...(authenticate ? { authenticate } : {}),
    ...(localExitEnabled ? { shutdown: closeLocalServer } : {}),
    onError: (error, correlationId) => {
        console.error(`[web-api] ${correlationId}`, error instanceof Error ? error.message : error)
    }
})

const server = createServer(async (request, response) => {
    setSecurityHeaders(response)
    try {
        if (await handleApi(request, response)) return
        await serveStatic(request, response)
    } catch (error) {
        console.error('[web-static]', error instanceof Error ? error.message : error)
        response.statusCode = 500
        response.end('The web application could not be loaded.')
    }
})

let closing: Promise<void> | undefined
function closeLocalServer(): Promise<void> {
    closing ??= (async () => {
        await sampleMutations?.drain()
        if ('dispose' in createRuntime && typeof createRuntime.dispose === 'function') await createRuntime.dispose()
        await new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => error ? rejectClose(error) : resolveClose())
        })
        sampleMutationState?.close()
        sampleInference?.close()
    })()
    return closing
}

let stopping: Promise<void> | undefined
const stop = () => {
    stopping ??= closeLocalServer().catch(() => { console.error('[web-host] shutdown_failed'); process.exitCode = 1 })
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

try {
    await listenWebServer(server, port, host)
    console.info(`TLC web host (${mode}) listening on http://${host}:${port}`)
} catch (error) {
    console.error(`[web-host] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
}

export type WebHostMode = 'sample' | 'azure-cli' | 'easy-auth'

export function resolveWebHostMode(environment: NodeJS.ProcessEnv): WebHostMode {
    const configuredMode = environment['TLC_WEB_MODE']?.trim().toLowerCase()
    if (configuredMode === 'sample' || configuredMode === 'azure-cli' || configuredMode === 'easy-auth') {
        return configuredMode
    }
    if (configuredMode) throw new Error('TLC_WEB_MODE must be sample, azure-cli, or easy-auth.')
    return environment['WEBSITE_SITE_NAME'] ? 'easy-auth' : 'sample'
}

function parsePort(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? '8080', 10)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error('PORT must be a valid TCP port.')
    return parsed
}