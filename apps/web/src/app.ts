import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z, ZodError } from 'zod'
import {
    accountSchema,
    accountCandidateSchema,
    accountListOptionsSchema,
    accountSearchRequestSchema,
    accountVisibilityMutationSchema,
    agentTaskRequestSchema,
    agentTaskResponseSchema,
    agentTaskStreamEventSchema,
    dealTeamJoinResultSchema,
    dealTeamLeaveResultSchema,
    discoverableOpportunitySchema,
    discoverySnapshotRequestSchema,
    discoverySnapshotSchema,
    type DiscoverySnapshot,
    type DiscoverySnapshotRequest,
    emailComposeRequestSchema,
    exportResponseRequestSchema,
    mcemRequestSchema,
    mcemResponseSchema,
    mcemStageTransitionRequestSchema,
    mcemStageTransitionResultSchema,
    meetingChangeSetApprovalSchema,
    meetingChangeSetProposalSchema,
    meetingChangeSetResultSchema,
    meetingTranscriptSchema,
    meetingTranscriptSummarySchema,
    milestoneSchema,
    milestoneActivitySchema,
    createMilestoneActivityRequestSchema,
    milestoneTeamJoinResultSchema,
    milestoneTeamLeaveResultSchema,
    milestoneUpdateSchema,
    opportunitySchema,
    opportunityUpdateSchema,
    contractVersion,
    recordCreationCatalogSchema,
    recordCreationPreviewRequestSchema,
    recordCreationPreviewSchema,
    recordCreationCommitRequestSchema,
    recordCreationResultSchema,
    recordCreationDraftResultSchema,
    seDomainSchema,
    type Account,
    type AccountCandidate,
    type AccountListOptions,
    type AccountSearchRequest,
    type AccountVisibility,
    type AgentTaskRequest,
    type AgentTaskResponse,
    type AgentTaskStreamEvent,
    type CreateMilestoneActivityRequest,
    type DealTeamJoinResult,
    type DealTeamLeaveResult,
    type DiscoverableOpportunity,
    type McemRequest,
    type McemResponse,
    type McemStageTransitionRequest,
    type McemStageTransitionResult,
    type MeetingChangeSetApproval,
    type MeetingChangeSetProposal,
    type MeetingChangeSetResult,
    type MeetingTranscript,
    type MeetingTranscriptSummary,
    type MeetingType,
    type Milestone,
    type MilestoneActivity,
    type MilestoneTeamJoinResult,
    type MilestoneTeamLeaveResult,
    type MilestoneUpdate,
    type Opportunity,
    type OpportunityUpdate,
    type RecordCreationCatalog,
    type RecordCreationCatalogRequest,
    type RecordCreationPreview,
    type RecordCreationPreviewRequest,
    type RecordCreationCommitRequest,
    type RecordCreationResult,
    type RecordCreationDraftResult,
    type SeDomainId
} from '../../../packages/common/index.js'
import { createOutlookDraftMessage } from '../../../packages/documents/outlook-compose.js'
import { createResponseDocumentBuffer } from '../../../packages/documents/response-document.js'
import { invokeWorkflowHost, type WorkflowHost, type WorkflowHostOperation } from '../../../packages/orchestrator/workflows/index.js'
import { createBrowserOnlyVoiceHost, type SharedVoiceInputHost } from '../../../packages/orchestrator/voice-input.js'
import type { SellerDashboardHost } from '../../../packages/orchestrator/seller-dashboard.js'
import type { SeReportingHost } from '../../../packages/orchestrator/se-reporting/host.js'
import { RecordCreationError } from '../../../packages/orchestrator/record-creation/service.js'
import { portfolioReadRequestSchema, portfolioIndexSchema, portfolioWorkspaceRequestSchema, portfolioWorkspaceSchema, type PortfolioReadRequest, type PortfolioIndex, type PortfolioWorkspaceRequest, type PortfolioWorkspace } from '../../../packages/common/contracts/index.js'
import { mutationSyncRequestSchema, mutationSyncResponseSchema, type MutationSyncRequest, type MutationSyncResponse } from '../../../packages/common/contracts/cache-sync.js'
import { MutationDispatchPreventedError } from '../../../packages/orchestrator/mutations/host.js'
import { MutationJournalError } from '../../../packages/orchestrator/mutations/journal.js'
import { sourceHttpFailure } from '../../../packages/common/source-failure.js'

const accountIdSchema = z.string().min(1).max(200)
const maximumBodyBytes = 1_048_576

export interface WebRuntime {
    mutationSync?(request: MutationSyncRequest): Promise<MutationSyncResponse>
    withReadContext?<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>
    getPortfolioIndex(request: PortfolioReadRequest): Promise<PortfolioIndex>
    getPortfolioWorkspace(request: PortfolioWorkspaceRequest): Promise<PortfolioWorkspace>
    getDiscoverySnapshot(request: DiscoverySnapshotRequest): Promise<DiscoverySnapshot>
    listAccounts(options?: AccountListOptions): Promise<Account[]>
    searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]>
    addAccount(accountId: string): Promise<Account>
    setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account>
    listOpportunities(accountId: string): Promise<Opportunity[]>
    getRecordCreationCatalog(request: RecordCreationCatalogRequest): Promise<RecordCreationCatalog>
    previewRecordCreation(request: RecordCreationPreviewRequest): Promise<RecordCreationPreview>
    commitRecordCreation(request: RecordCreationCommitRequest): Promise<RecordCreationResult>
    exportRecordCreationDraft(request: RecordCreationCommitRequest): Promise<RecordCreationDraftResult>
    discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]>
    joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult>
    leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult>
    joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult>
    leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult>
    listMilestones(opportunityId: string): Promise<Milestone[]>
    listDiscoverableMilestones(opportunityId: string): Promise<Milestone[]>
    listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]>
    createMilestoneActivity(opportunityId: string, milestoneId: string, request: CreateMilestoneActivityRequest): Promise<MilestoneActivity>
    listMeetingTranscripts(opportunityId?: string): Promise<MeetingTranscriptSummary[]>
    getMeetingTranscript(transcriptId: string): Promise<MeetingTranscript | null>
    proposeMeetingChangeSet(request: { opportunityId: string; transcriptId?: string; rawTranscript?: { content: string; format?: 'vtt' | 'text'; meetingType?: MeetingType } }): Promise<MeetingChangeSetProposal>
    applyMeetingChangeSet(input: { proposal: MeetingChangeSetProposal; approval: MeetingChangeSetApproval }): Promise<MeetingChangeSetResult>
    updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone>
    updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity>
    transitionOpportunityStage(request: McemStageTransitionRequest): Promise<McemStageTransitionResult>
    runMcemCoach(request: McemRequest): Promise<McemResponse>
    runAgentTask(request: AgentTaskRequest): Promise<AgentTaskResponse>
    runAgentTaskStream(request: AgentTaskRequest, onEvent: (event: AgentTaskStreamEvent) => void, signal?: AbortSignal): Promise<void>
}

export interface AuthenticatedRequest {
    accessToken: string
    clientPrincipal: string
    userEmail: string
}

export interface WebApiOptions {
    resolveSeReportingHost?(authentication: AuthenticatedRequest): Promise<SeReportingHost> | SeReportingHost
    resolveSellerDashboardHost?(authentication: AuthenticatedRequest): Promise<SellerDashboardHost> | SellerDashboardHost
    resolveVoiceHost?(authentication: AuthenticatedRequest): SharedVoiceInputHost
    createRuntime(authentication: AuthenticatedRequest): Promise<WebRuntime> | WebRuntime
    resolveWorkflowHost?(authentication: AuthenticatedRequest): Promise<WorkflowHost> | WorkflowHost
    authenticate?(request: IncomingMessage): Promise<AuthenticatedRequest> | AuthenticatedRequest
    shutdown?(): Promise<void> | void
    onError?(error: unknown, correlationId: string): void
}

async function cancellableRead<T>(request: IncomingMessage, response: ServerResponse, runtime: WebRuntime, action: () => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const abort = () => { if (!response.writableFinished) controller.abort() }
    response.once('close', abort)
    request.once('aborted', abort)
    try {
        const result = await (runtime.withReadContext ? runtime.withReadContext(action, controller.signal) : action())
        controller.signal.throwIfAborted()
        return result
    } finally {
        response.removeListener('close', abort)
        request.removeListener('aborted', abort)
    }
}

export function buildWebApiHandler(options: WebApiOptions) {
    const browserOnlyVoice = createBrowserOnlyVoiceHost()
    return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return false

        const correlationId = randomUUID()
        response.setHeader('x-correlation-id', correlationId)
        response.setHeader('cache-control', 'no-store')

        try {
            if (request.method === 'GET' && url.pathname === '/api/health') {
                sendJson(response, 200, { status: 'ready' })
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/exit' && options.shutdown) {
                assertSameOriginMutation(request)
                sendJson(response, 202, { state: 'exiting' })
                setImmediate(() => {
                    Promise.resolve(options.shutdown?.()).catch((error: unknown) => options.onError?.(error, correlationId))
                })
                return true
            }

            const authentication = await (options.authenticate ?? readEasyAuthAuthentication)(request)
            assertSameOriginMutation(request)
            response.setHeader('x-tlc-source-scope', authenticatedSourceScope(authentication))

            if (request.method === 'GET' && url.pathname === '/api/me') {
                sendJson(response, 200, { email: authentication.userEmail })
                return true
            }
            if (request.method === 'GET' && url.pathname === '/api/record-creation/catalog') {
                const accountId = accountIdSchema.parse(url.searchParams.get('accountId'))
                sendJson(response, 200, recordCreationCatalogSchema.parse(await (await options.createRuntime(authentication)).getRecordCreationCatalog({ contractVersion, accountId })))
                return true
            }
            if (request.method === 'POST' && url.pathname.startsWith('/api/record-creation/')) {
                const runtime = await options.createRuntime(authentication)
                const operation = url.pathname.slice('/api/record-creation/'.length)
                if (operation === 'preview') {
                    const input = recordCreationPreviewRequestSchema.parse(await readJsonBody(request))
                    sendJson(response, 200, recordCreationPreviewSchema.parse(await runtime.previewRecordCreation(input)))
                    return true
                }
                if (operation === 'commit' || operation === 'draft') {
                    const input = recordCreationCommitRequestSchema.parse(await readJsonBody(request))
                    if (operation === 'commit') {
                        sendJson(response, 200, recordCreationResultSchema.parse(await runtime.commitRecordCreation(input)))
                    } else {
                        sendJson(response, 200, recordCreationDraftResultSchema.parse(await runtime.exportRecordCreationDraft(input)))
                    }
                    return true
                }
            }
            if (request.method === 'POST' && url.pathname === '/api/seller-dashboard' && options.resolveSellerDashboardHost) {
                const host = await options.resolveSellerDashboardHost(authentication)
                sendJson(response, 200, await host.invoke(await readJsonBody(request)))
                return true
            }
            if (request.method === 'POST' && url.pathname === '/api/se-reporting' && options.resolveSeReportingHost) {
                const host = await options.resolveSeReportingHost(authentication)
                sendJson(response, 200, await host.invoke(await readJsonBody(request)))
                return true
            }
            if (request.method === 'POST' && url.pathname === '/api/voice') {
                const host = options.resolveVoiceHost?.(authentication) ?? browserOnlyVoice
                sendJson(response, 200, await host.invoke(await readJsonBody(request)))
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/open-email-compose') {
                const input = emailComposeRequestSchema.parse(await readJsonBody(request))
                const fileName = safeEmailFileName(input.subject)
                response.statusCode = 200
                response.setHeader('content-type', 'message/rfc822; charset=utf-8')
                response.setHeader('content-disposition', `attachment; filename="${fileName}"`)
                response.setHeader('x-tlc-file-name', fileName)
                response.end(createOutlookDraftMessage(input), 'utf8')
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/export-agent-response') {
                const input = exportResponseRequestSchema.parse(await readJsonBody(request))
                const document = await createResponseDocumentBuffer(input)
                const fileName = safeDocumentFileName(input.responseTitle)
                response.statusCode = 200
                response.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                response.setHeader('content-disposition', `attachment; filename="${fileName}"`)
                response.setHeader('x-tlc-file-name', fileName)
                response.end(document)
                return true
            }

            const workflowMatch = /^\/api\/workflows\/(list|start|get|cancel|history)$/.exec(url.pathname)
            if (request.method === 'POST' && workflowMatch && options.resolveWorkflowHost) {
                const host = await options.resolveWorkflowHost(authentication)
                const operation = workflowMatch[1] as WorkflowHostOperation
                sendJson(response, 200, invokeWorkflowHost(host, operation, await readJsonBody(request)))
                return true
            }

            const runtime = await options.createRuntime(authentication)

            if (request.method === 'POST' && url.pathname === '/api/mutation-sync') {
                const input = mutationSyncRequestSchema.parse(await readJsonBody(request))
                if (!runtime.mutationSync) {
                    if (input.operation !== 'capabilities') throw new MutationDispatchPreventedError('storage-unavailable', 'Durable background writes are unavailable.')
                    sendJson(response, 200, { contractVersion: '1.0', kind: 'capabilities', capabilities: {
                        contractVersion: '1.0', available: false, readCacheOwner: 'client', operations: [],
                        reason: 'This host has not enabled protected durable background writes.'
                    } })
                } else {
                    const result = mutationSyncResponseSchema.parse(await runtime.mutationSync(input))
                    sendJson(response, result.kind === 'receipt' && result.receipt.state === 'accepted' ? 202 : 200, result)
                }
                return true
            }
            if (request.method === 'POST' && url.pathname === '/api/discovery/snapshot') {
                const input = discoverySnapshotRequestSchema.parse(await readJsonBody(request))
                sendJson(response, 200, discoverySnapshotSchema.parse(await cancellableRead(request, response, runtime, () => runtime.getDiscoverySnapshot(input))))
                return true
            }
            if (request.method === 'POST' && url.pathname === '/api/portfolio/index') {
                const input = portfolioReadRequestSchema.parse(await readJsonBody(request))
                sendJson(response, 200, portfolioIndexSchema.parse(await cancellableRead(request, response, runtime, () => runtime.getPortfolioIndex(input))))
                return true
            }
            if (request.method === 'POST' && url.pathname === '/api/portfolio/workspace') {
                const input = portfolioWorkspaceRequestSchema.parse(await readJsonBody(request))
                sendJson(response, 200, portfolioWorkspaceSchema.parse(await cancellableRead(request, response, runtime, () => runtime.getPortfolioWorkspace(input))))
                return true
            }
            if (request.method === 'GET' && url.pathname === '/api/accounts') {
                const options = accountListOptionsSchema.parse({
                    ...(url.searchParams.has('includeHidden')
                        ? { includeHidden: url.searchParams.get('includeHidden') === 'true' }
                        : {})
                })
                sendJson(response, 200, accountSchema.array().parse(await runtime.listAccounts(options)))
                return true
            }

            if (request.method === 'GET' && url.pathname === '/api/account-candidates') {
                const search = accountSearchRequestSchema.parse({
                    matchBy: url.searchParams.get('matchBy'),
                    query: url.searchParams.get('query')
                })
                sendJson(response, 200, accountCandidateSchema.array().parse(await runtime.searchAccounts(search)))
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/accounts') {
                const body = z.object({ accountId: accountIdSchema }).strict().parse(await readJsonBody(request))
                sendJson(response, 200, accountSchema.parse(await runtime.addAccount(body.accountId)))
                return true
            }

            const accountVisibilityMatch = /^\/api\/accounts\/([^/]+)\/visibility$/.exec(url.pathname)
            if (request.method === 'PATCH' && accountVisibilityMatch) {
                const accountId = accountIdSchema.parse(decodeURIComponent(accountVisibilityMatch[1]!))
                const body = accountVisibilityMutationSchema.parse(await readJsonBody(request))
                sendJson(response, 200, accountSchema.parse(await runtime.setAccountVisibility(accountId, body.visibility)))
                return true
            }

            const opportunitiesMatch = /^\/api\/accounts\/([^/]+)\/opportunities$/.exec(url.pathname)
            if (request.method === 'GET' && opportunitiesMatch) {
                const accountId = accountIdSchema.parse(decodeURIComponent(opportunitiesMatch[1]!))
                sendJson(response, 200, opportunitySchema.array().parse(await runtime.listOpportunities(accountId)))
                return true
            }

            const discoverMatch = /^\/api\/discover\/([^/]+)$/.exec(url.pathname)
            if (request.method === 'GET' && discoverMatch) {
                const domain = seDomainSchema.parse(decodeURIComponent(discoverMatch[1]!))
                sendJson(response, 200, discoverableOpportunitySchema.array().parse(await runtime.discoverOpportunities(domain)))
                return true
            }

            const discoverMilestonesMatch = /^\/api\/discover\/opportunities\/([^/]+)\/milestones$/.exec(url.pathname)
            if (request.method === 'GET' && discoverMilestonesMatch) {
                const opportunityId = accountIdSchema.parse(decodeURIComponent(discoverMilestonesMatch[1]!))
                sendJson(response, 200, milestoneSchema.array().parse(await runtime.listDiscoverableMilestones(opportunityId)))
                return true
            }

            const dealTeamMatch = /^\/api\/opportunities\/([^/]+)\/deal-team$/.exec(url.pathname)
            if (request.method === 'POST' && dealTeamMatch) {
                const opportunityId = accountIdSchema.parse(decodeURIComponent(dealTeamMatch[1]!))
                sendJson(response, 200, dealTeamJoinResultSchema.parse(await runtime.joinDealTeam(opportunityId)))
                return true
            }
            if (request.method === 'DELETE' && dealTeamMatch) {
                const opportunityId = accountIdSchema.parse(decodeURIComponent(dealTeamMatch[1]!))
                sendJson(response, 200, dealTeamLeaveResultSchema.parse(await runtime.leaveDealTeam(opportunityId)))
                return true
            }

            const milestonesMatch = /^\/api\/opportunities\/([^/]+)\/milestones$/.exec(url.pathname)
            if (request.method === 'GET' && milestonesMatch) {
                const opportunityId = accountIdSchema.parse(decodeURIComponent(milestonesMatch[1]!))
                sendJson(response, 200, milestoneSchema.array().parse(await runtime.listMilestones(opportunityId)))
                return true
            }

            const milestoneUpdateMatch = /^\/api\/opportunities\/([^/]+)\/milestones\/([^/]+)$/.exec(url.pathname)
            if (request.method === 'PATCH' && milestoneUpdateMatch) {
                const opportunityId = accountIdSchema.parse(decodeURIComponent(milestoneUpdateMatch[1]!))
                const milestoneId = accountIdSchema.parse(decodeURIComponent(milestoneUpdateMatch[2]!))
                const update = milestoneUpdateSchema.parse(await readJsonBody(request))
                sendJson(response, 200, milestoneSchema.parse(await runtime.updateMilestone(opportunityId, milestoneId, update)))
                return true
            }

            const milestoneTeamMatch = /^\/api\/opportunities\/([^/]+)\/milestones\/([^/]+)\/team\/me$/.exec(url.pathname)
            if (milestoneTeamMatch && (request.method === 'POST' || request.method === 'DELETE')) {
                const opportunityId = accountIdSchema.parse(decodeURIComponent(milestoneTeamMatch[1]!))
                const milestoneId = accountIdSchema.parse(decodeURIComponent(milestoneTeamMatch[2]!))
                if (request.method === 'POST') {
                    sendJson(response, 200, milestoneTeamJoinResultSchema.parse(await runtime.joinMilestoneTeam(opportunityId, milestoneId)))
                } else {
                    sendJson(response, 200, milestoneTeamLeaveResultSchema.parse(await runtime.leaveMilestoneTeam(opportunityId, milestoneId)))
                }
                return true
            }

            const milestoneActivitiesMatch = /^\/api\/opportunities\/([^/]+)\/milestones\/([^/]+)\/activities$/.exec(url.pathname)
            if (milestoneActivitiesMatch && (request.method === 'GET' || request.method === 'POST')) {
                const opportunityId = accountIdSchema.parse(decodeURIComponent(milestoneActivitiesMatch[1]!))
                const milestoneId = accountIdSchema.parse(decodeURIComponent(milestoneActivitiesMatch[2]!))
                if (request.method === 'GET') {
                    sendJson(response, 200, milestoneActivitySchema.array().parse(await runtime.listMilestoneActivities(opportunityId, milestoneId)))
                } else {
                    const createRequest = createMilestoneActivityRequestSchema.parse(await readJsonBody(request))
                    sendJson(response, 200, milestoneActivitySchema.parse(await runtime.createMilestoneActivity(opportunityId, milestoneId, createRequest)))
                }
                return true
            }

            const opportunityUpdateMatch = /^\/api\/opportunities\/([^/]+)$/.exec(url.pathname)
            if (request.method === 'PATCH' && opportunityUpdateMatch) {
                const opportunityId = accountIdSchema.parse(decodeURIComponent(opportunityUpdateMatch[1]!))
                const update = opportunityUpdateSchema.parse(await readJsonBody(request))
                sendJson(response, 200, opportunitySchema.parse(await runtime.updateOpportunity(opportunityId, update)))
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/mcem-coach') {
                const input = mcemRequestSchema.parse(await readJsonBody(request))
                sendJson(response, 200, mcemResponseSchema.parse(await runtime.runMcemCoach(input)))
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/mcem-stage-transition') {
                const input = mcemStageTransitionRequestSchema.parse(await readJsonBody(request))
                sendJson(response, 200, mcemStageTransitionResultSchema.parse(await runtime.transitionOpportunityStage(input)))
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/agent-task') {
                const input = agentTaskRequestSchema.parse(await readJsonBody(request))
                sendJson(response, 200, agentTaskResponseSchema.parse(await runtime.runAgentTask(input)))
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/agent-task/stream') {
                const input = agentTaskRequestSchema.strict().parse(await readJsonBody(request))
                response.statusCode = 200
                response.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
                response.setHeader('cache-control', 'no-store, no-transform')
                response.setHeader('x-accel-buffering', 'no')
                response.flushHeaders()
                const controller = new AbortController()
                const abort = () => { if (!response.writableFinished) controller.abort() }
                response.once('close', abort)
                // Blank lines keep intermediaries from idling out while the model reasons.
                const heartbeat = setInterval(() => { if (!response.writableEnded) response.write('\n') }, 15_000)
                const write = (event: AgentTaskStreamEvent) => {
                    if (!response.writableEnded) response.write(`${JSON.stringify(agentTaskStreamEventSchema.parse(event))}\n`)
                }
                try {
                    await runtime.runAgentTaskStream(input, write, controller.signal)
                } catch (error) {
                    options.onError?.(error, correlationId)
                    write({ type: 'error', code: 'failed', message: 'The server could not complete the request.' })
                } finally {
                    clearInterval(heartbeat)
                    response.removeListener('close', abort)
                    response.end()
                }
                return true
            }

            if (request.method === 'GET' && url.pathname === '/api/meeting-transcripts') {
                const opportunityId = url.searchParams.get('opportunityId')
                sendJson(response, 200, meetingTranscriptSummarySchema.array().parse(
                    await runtime.listMeetingTranscripts(opportunityId ? accountIdSchema.parse(opportunityId) : undefined)
                ))
                return true
            }

            const meetingTranscriptMatch = /^\/api\/meeting-transcripts\/([^/]+)$/.exec(url.pathname)
            if (request.method === 'GET' && meetingTranscriptMatch) {
                const transcriptId = accountIdSchema.parse(decodeURIComponent(meetingTranscriptMatch[1]!))
                sendJson(response, 200, meetingTranscriptSchema.nullable().parse(await runtime.getMeetingTranscript(transcriptId)))
                return true
            }

            const meetingChangeSetMatch = /^\/api\/opportunities\/([^/]+)\/meeting-change-set$/.exec(url.pathname)
            if (request.method === 'POST' && meetingChangeSetMatch) {
                const opportunityId = accountIdSchema.parse(decodeURIComponent(meetingChangeSetMatch[1]!))
                const body = z.object({
                    transcriptId: z.string().min(1).max(200).optional(),
                    rawTranscript: z.object({
                        content: z.string().min(1),
                        format: z.enum(['vtt', 'text']).optional(),
                        meetingType: z.enum(['customer', 'internal']).optional()
                    }).optional()
                }).parse(await readJsonBody(request))
                sendJson(response, 200, meetingChangeSetProposalSchema.parse(await runtime.proposeMeetingChangeSet({
                    opportunityId,
                    ...(body.transcriptId ? { transcriptId: body.transcriptId } : {}),
                    ...(body.rawTranscript ? {
                        rawTranscript: {
                            content: body.rawTranscript.content,
                            ...(body.rawTranscript.format ? { format: body.rawTranscript.format } : {}),
                            ...(body.rawTranscript.meetingType ? { meetingType: body.rawTranscript.meetingType } : {})
                        }
                    } : {})
                })))
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/meeting-change-set/apply') {
                const body = z.object({
                    proposal: meetingChangeSetProposalSchema,
                    approval: meetingChangeSetApprovalSchema
                }).parse(await readJsonBody(request))
                sendJson(response, 200, meetingChangeSetResultSchema.parse(await runtime.applyMeetingChangeSet(body)))
                return true
            }

            sendJson(response, 404, { error: 'The requested API route was not found.', correlationId })
            return true
        } catch (error) {
            if (error instanceof MutationDispatchPreventedError || error instanceof MutationJournalError) {
                if (error.code === 'capacity') response.setHeader('retry-after', '5')
                sendJson(response, error instanceof MutationDispatchPreventedError ? error.status : error.code === 'capacity' ? 429 : 409, { error: error.message, code: error.code })
                return true
            }
            const source = sourceHttpFailure(error)
            if (source) {
                if (source.retryAfterSeconds !== undefined) response.setHeader('retry-after', String(source.retryAfterSeconds))
                options.onError?.(new Error(`Source request failed with status ${source.status}.`), correlationId)
                sendJson(response, source.status, { error: source.status === 401 ? 'Reauthenticate before reading source data.'
                    : source.status === 403 ? 'Current source access was denied. Reconnect before reading private data.'
                        : source.status === 429 ? 'The source is throttled. Wait before refreshing again.' : 'The source is temporarily unavailable.', correlationId })
                return true
            }
            const statusCode = error instanceof HttpError
                ? error.statusCode
                : error instanceof ZodError
                    ? 400
                    : error instanceof RecordCreationError
                        ? error.code === 'target-disabled' ? 403 : error.code === 'parent-unavailable' ? 404 : 409
                        : 500
            options.onError?.(error, correlationId)
            const message = statusCode === 500
                ? 'The server could not complete the request.'
                : error instanceof Error ? error.message : 'The request is invalid.'
            sendJson(response, statusCode, {
                error: message,
                ...(error instanceof RecordCreationError ? { code: error.code } : {}),
                correlationId
            })
            return true
        }
    }
}

function safeDocumentFileName(title: string): string {
    const safeTitle = Array.from(title, (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character)
        .join('').replace(/[. ]+$/g, '').slice(0, 120).trim()
    return `${safeTitle || 'TLC-agent-response'}.docx`
}

export function readEasyAuthAuthentication(request: IncomingMessage): AuthenticatedRequest {
    const accessToken = singleHeader(request, 'x-ms-token-aad-access-token')
    const clientPrincipal = singleHeader(request, 'x-ms-client-principal')
    const userEmail = singleHeader(request, 'x-ms-client-principal-name')
    if (!accessToken || !clientPrincipal || !userEmail) {
        throw new HttpError(401, 'Sign in with Microsoft Entra ID to access live data.')
    }
    return { accessToken, clientPrincipal, userEmail }
}

function authenticatedSourceScope(authentication: AuthenticatedRequest): string {
    const payload = authentication.accessToken.split('.')[1]
    let subject: { tid: string; oid: string } | undefined
    if (payload) {
        try {
            subject = z.object({ tid: z.string().guid(), oid: z.string().guid() }).parse(
                JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
        } catch {
            throw new HttpError(401, 'The delegated source identity is invalid. Sign in again.')
        }
    }
    return createHash('sha256').update(JSON.stringify([authentication.clientPrincipal, subject])).digest('hex')
}

function assertSameOriginMutation(request: IncomingMessage): void {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? '')) return
    const fetchSite = singleHeader(request, 'sec-fetch-site')
    if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
        throw new HttpError(403, 'Cross-origin API requests are not allowed.')
    }
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
    const value = request.headers[name]
    return Array.isArray(value) ? value[0] : value
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        throw new HttpError(415, 'The request body must use application/json.')
    }

    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > maximumBodyBytes) throw new HttpError(413, 'The request body is too large.')
        chunks.push(buffer)
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
        throw new HttpError(400, 'The request body is not valid JSON.')
    }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.statusCode = statusCode
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify(payload))
}

class HttpError extends Error {
    constructor(readonly statusCode: number, message: string) {
        super(message)
    }
}

function safeEmailFileName(subject: string): string {
    const safeSubject = Array.from(subject, (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character)
        .join('').replace(/[. ]+$/g, '').slice(0, 120).trim()
    return `${safeSubject || 'TLC-agent-response'}.eml`
}