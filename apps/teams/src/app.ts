import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z, ZodError } from 'zod'
import { collaborationVersion, collaborationLifecycleCommandSchema, type ContextBinding } from '../../../packages/common/contracts/collaboration.js'
import { meetingChangeSetApprovalSchema } from '../../../packages/common/contracts/meeting.js'
import { accountCandidateSchema, emailComposeRequestSchema, exportResponseRequestSchema, workflowRunSchema } from '../../../packages/common/contracts/index.js'
import { createOutlookDraftMessage } from '../../../packages/documents/outlook-compose.js'
import { createResponseDocumentBuffer } from '../../../packages/documents/response-document.js'
import type { ScopedDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import type { ApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { createApplicationOperations, WorkflowScopeAuthorizationError } from '../../../packages/orchestrator/operations.js'
import { CollaborationService, type ContextAuthority } from '../../../packages/orchestrator/collaboration/contexts.js'
import { NotificationOutbox } from '../../../packages/orchestrator/collaboration/notifications.js'
import { ReviewedActionService, ActionDispatchPreventedError, ActionReviewStaleError } from '../../../packages/orchestrator/collaboration/reviewed-actions.js'
import { CollaborationAdmissionError, CollaborationLifecycle } from '../../../packages/orchestrator/collaboration/lifecycle.js'
import { GraphMeetingError, ManualTranscriptError, MeetingAcquisitionService } from '../../../packages/orchestrator/collaboration/meeting-acquisition.js'
import { PublicationService, type SharedProjection } from '../../../packages/orchestrator/collaboration/publications.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import { isLocalSourcePrincipal, principalPartition } from '../../../packages/orchestrator/collaboration/principal.js'
import { UserRequestBudget, RequestQuotaError } from '../../../packages/orchestrator/collaboration/request-budget.js'
import { WorkflowActivityStore } from '../../../packages/orchestrator/collaboration/activity.js'
import { WorkflowRuntimeError } from '../../../packages/orchestrator/workflows/runtime.js'
import { workflowContractVersion } from '../../../packages/common/contracts/workflows.js'
import type { TranscriptEventService } from '../../../packages/orchestrator/collaboration/transcript-events.js'
import { createTeamsAuthenticator, TeamsAuthorizationError } from './authentication.js'
import { isCliConfiguration, isLocalConfiguration, type TeamsConfiguration } from './configuration.js'
import { getCliCapabilities, cliPublicConfigurationVersion, localConnectionVersion, localRevokeRequestSchema, nativeCapabilities, nativeConnectionStatusSchema, type NativeConnectionStatus } from '../../../packages/common/contracts/local-connection.js'
import { LocalPairingError, type LocalPairingAuthority } from './local-pairing.js'
import { NativeConnectionError } from './native-identity.js'
import { teamsClientReadyResultSchema, teamsLaunchVersion } from '../../../packages/common/contracts/teams-launch.js'
import { TeamsLaunchError, type TeamsLaunchMonitor } from './launch-status.js'
import { localSessionRenewalRequestSchema } from '../../../packages/common/contracts/local-connection.js'

export interface TeamsHandlerOptions {
  configuration: TeamsConfiguration
  store: ScopedDocumentStore
  resolveServices(principal: ExecutionPrincipal, assertion: string): Promise<ApplicationServices>
  authority: ContextAuthority
  deliverPublication?(principal: ExecutionPrincipal, binding: ContextBinding, projection: SharedProjection): Promise<unknown>
  notify?(principal: ExecutionPrincipal): Promise<void>
  transcriptEvents?: TranscriptEventService
  acceptNewWork?: boolean
  onDeactivate?(principal: ExecutionPrincipal): Promise<void>
  authenticate?(assertion: string): Promise<ExecutionPrincipal>
  localConnection?: { pairing: LocalPairingAuthority; status(): NativeConnectionStatus; refreshIdentity(): Promise<void> }
  launch?: TeamsLaunchMonitor
  onError?(event: { correlationId: string; code: string; method: string; category: string }): void
}
export class TeamsHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}
const bodyLimit = 1_048_576
const previewRequest = z.object({ operation: z.string().min(1).max(100), input: z.record(z.string(), z.unknown()) }).strict()
export const samplePrincipal: ExecutionPrincipal = {
  key: 'sample:sample-user', tenantId: 'sample', userId: 'sample-user', environmentId: 'sample', mode: 'sample',
  roles: ['TLC.Teams.User', 'TLC.Teams.Writer', 'TLC.Teams.ContextAdmin', 'TLC.Teams.Publisher']
}

export function assertNativeHttpRequest(request: IncomingMessage, origin: string): void {
  const target = new URL(request.url ?? '/', origin)
  // Teams must navigate to the public shell before that frame can make same-origin private API requests.
  const publicNavigation = request.method === 'GET' && target.origin === origin && target.pathname === '/' &&
    request.headers['sec-fetch-mode'] === 'navigate' && ['iframe', 'document'].includes(String(request.headers['sec-fetch-dest']))
  if (request.headers.host?.toLowerCase() !== new URL(origin).host.toLowerCase() ||
      request.headers['x-forwarded-host'] || request.headers['x-forwarded-proto'] ||
      request.headers.origin && request.headers.origin !== origin ||
      request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site'])) && !publicNavigation ||
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? '') && request.headers.origin !== origin) {
    throw new LocalPairingError(403, 'local_origin_denied')
  }
}

export function createTeamsHandler(options: TeamsHandlerOptions) {
  const local = isLocalConfiguration(options.configuration) ? options.localConnection : undefined
  if (isLocalConfiguration(options.configuration) && !local) throw new Error('Local HTTP requires the protected local pairing authority.')
  const authenticate = options.authenticate ?? (local ? async (assertion: string) => local.pairing.authenticate(assertion)
    : options.configuration.mode === 'sample' ? async () => samplePrincipal : createTeamsAuthenticator(options.configuration))
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', options.configuration.origin)
    if (!url.pathname.startsWith('/api/teams/') && url.pathname !== '/api/health') return false
    const correlationId = randomUUID()
    response.setHeader('x-correlation-id', correlationId)
    response.setHeader('cache-control', 'no-store')
    let authenticatedAssertion: string | undefined
    const assertCurrentCaller = () => { if (local && authenticatedAssertion !== undefined) local.pairing.authenticate(authenticatedAssertion) }
    const json = (status: number, value: unknown) => {
      if (status >= 200 && status < 300) assertCurrentCaller()
      response.statusCode = status
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(value))
    }
    try {
      if (local) assertNativeHttpRequest(request, options.configuration.origin)
      if (url.pathname === '/api/health' && request.method === 'GET') {
        json(200, { status: 'ready', surface: 'teams', mode: options.configuration.mode })
        return true
      }
      if (url.pathname === '/api/teams/launch' && request.method === 'GET') {
        if (!options.launch) throw new TeamsHttpError(404, 'launch_monitor_not_configured')
        json(200, options.launch.status())
        return true
      }
      if (url.pathname === '/api/teams/config' && request.method === 'GET') {
        if (isLocalConfiguration(options.configuration)) {
          const configuration = options.configuration
          const cli = isCliConfiguration(configuration)
          json(200, {
            contractVersion: cli ? cliPublicConfigurationVersion : localConnectionVersion, mode: 'live',
            authentication: configuration.authentication,
            ...(cli ? { writeMode: configuration.writeMode } : {}),
            capabilities: cli ? getCliCapabilities(configuration.writeMode) : nativeCapabilities
          })
          return true
        }
        json(200, options.configuration.mode === 'sample' ? { mode: 'sample' } : {
          mode: 'live', tenantId: options.configuration.tenantId,
          spaClientId: options.configuration.spaClientId,
          apiScope: `api://${options.configuration.apiClientId}/access_as_user`
        })
        return true
      }
      if (url.pathname === '/api/teams/graph/notifications' && request.method === 'POST') {
        if (!options.transcriptEvents) throw new TeamsHttpError(404, 'graph_notifications_disabled')
        const validation = url.searchParams.get('validationToken')
        if (validation !== null) {
          if (validation.length > 1000) throw new TeamsHttpError(400, 'invalid_validation_token')
          response.statusCode = 200
          response.setHeader('content-type', 'text/plain; charset=utf-8')
          response.end(validation)
          return true
        }
        try { await options.transcriptEvents.receive(await readBody(request)) }
        catch { throw new TeamsHttpError(403, 'graph_notification_rejected') }
        json(202, { state: 'queued' })
        return true
      }
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? '')) {
        const origin = request.headers.origin
        const site = request.headers['sec-fetch-site']
        if (origin && origin !== options.configuration.origin || site && !['same-origin', 'none'].includes(String(site))) {
          throw new TeamsHttpError(403, 'cross_origin_denied')
        }
      }
      if (local && request.method === 'POST' && url.pathname === '/api/teams/local/requests') {
        json(201, local.pairing.begin(await readBody(request), request.headers.origin ?? ''))
        return true
      }
      if (local && request.method === 'POST' && url.pathname === '/api/teams/local/exchange') {
        json(200, local.pairing.exchange(await readBody(request), request.headers.origin ?? ''))
        return true
      }
      const authorization = request.headers.authorization
      const assertion = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
      if (local && request.method === 'POST' && url.pathname === '/api/teams/local/renew') {
        localSessionRenewalRequestSchema.parse(await readBody(request))
        local.pairing.assertRenewable(assertion)
        await local.refreshIdentity()
        const renewed = local.pairing.renew(assertion)
        authenticatedAssertion = assertion
        json(200, renewed)
        return true
      }
      if (local && request.method === 'POST' && url.pathname === '/api/teams/local/revoke') {
        localRevokeRequestSchema.parse(await readBody(request))
        local.pairing.revoke(assertion)
        json(200, { contractVersion: localConnectionVersion, state: 'disconnected' })
        return true
      }
      let principal: ExecutionPrincipal
      try { principal = await authenticate(assertion) } catch (error) {
        if (error instanceof TeamsAuthorizationError) throw error
        throw new TeamsHttpError(401, 'authorization_required')
      }
      authenticatedAssertion = assertion
      if (request.method === 'POST' && url.pathname === '/api/teams/launch/ready') {
        if (!options.launch) throw new TeamsHttpError(404, 'launch_monitor_not_configured')
        try { options.launch.report(await readBody(request), local?.pairing.pageCode(assertion), principal.expiresAt) }
        catch (error) {
          if (error instanceof TeamsLaunchError) throw new TeamsHttpError(409, error.code)
          throw error
        }
        json(200, teamsClientReadyResultSchema.parse({ contractVersion: teamsLaunchVersion, state: 'ready' }))
        return true
      }
      if (local && request.method === 'GET' && url.pathname === '/api/teams/local/status') {
        json(200, nativeConnectionStatusSchema.parse(local.status()))
        return true
      }
      if (local && /^\/api\/teams\/(?:contexts|publications|shared)(?:\/|$)/.test(url.pathname)) {
        throw new TeamsHttpError(409, 'local_collaboration_distribution_required')
      }
      if (request.method === 'GET' && url.pathname === '/api/teams/session') {
        json(200, {
          contractVersion: collaborationVersion, mode: principal.mode,
          roles: principal.roles, displayName: principal.mode === 'sample' ? 'Sample user'
            : isLocalSourcePrincipal(principal) ? `Verified local MSX user (${principal.localSourceAccess === 'reviewed' ? 'reviewed read/write' : 'read-only'})` : 'Authorized Microsoft FTE'
        })
        return true
      }
      if (isCliConfiguration(options.configuration) && options.configuration.writeMode === 'read-only' &&
          (/^\/api\/teams\/actions(?:\/|$)/.test(url.pathname) || url.pathname === '/api/teams/meetings/preview-changes')) {
        throw new TeamsHttpError(403, 'local_read_only')
      }
      const lifecycle = new CollaborationLifecycle(options.store, options.acceptNewWork ?? true)
      if (url.pathname === '/api/teams/lifecycle' && request.method === 'GET') {
        json(200, await lifecycle.status(principal))
        return true
      }
      if (url.pathname === '/api/teams/lifecycle' && request.method === 'POST') {
        const input = collaborationLifecycleCommandSchema.parse(await readBody(request))
        const status = await lifecycle.set(principal, input.command)
        if (input.command !== 'resume') await options.onDeactivate?.(principal)
        json(200, status)
        return true
      }
      await lifecycle.assertReadable(principal)
      await new UserRequestBudget(options.store).consume(principal, 'requests', principal.mode === 'sample' ? 600 : 60)
      if (isCliConfiguration(options.configuration) && ['/api/teams/meetings/resolve', '/api/teams/meetings/acquire'].includes(url.pathname)) {
        throw new TeamsHttpError(409, 'graph_unavailable_in_cli_profile')
      }
      const services = await options.resolveServices(principal, assertion)
      const operations = createApplicationOperations(services)
      const notifications = new NotificationOutbox(options.store)
      const activity = new WorkflowActivityStore(options.store)
      const acquisition = new MeetingAcquisitionService(options.store, {
        readOpportunity: async (_actor, opportunityId) => { await services.orchestrator.getOpportunitySnapshot(opportunityId) },
        getTranscripts: (_actor, input) => services.acquireTranscripts(input),
        propose: (_actor, opportunityId, transcript) => services.proposeTranscript(opportunityId, transcript)
      })
      const actions = new ReviewedActionService(options.store, {
        authorize: async (_actor, name, input) => {
          const admission = await lifecycle.assertActive(principal)
          const localGeneration = local?.pairing.reviewGeneration()
          if (name === 'publishSummary') {
            if (local) throw new TeamsHttpError(409, 'local_collaboration_distribution_required')
            if (principal.mode === 'live' && !options.deliverPublication) throw new TeamsHttpError(503, 'publication_delivery_unavailable')
            return { source: await publications.authorize(principal, input), admissionGeneration: admission.generation }
          }
          if (operations.describe(name).effect === 'read') throw new TeamsHttpError(400, 'not_a_mutation')
          const source = await operations.snapshot(name, input)
          assertCurrentCaller()
          if (local && localGeneration !== local.pairing.reviewGeneration()) throw new NativeConnectionError('native_connection_changed')
          return { source, admissionGeneration: admission.generation, ...(localGeneration ? { localGeneration } : {}) }
        },
        execute: async (_actor, name, input, before) => {
          const reviewed = z.object({ source: z.unknown(), admissionGeneration: z.number().int().nonnegative(), localGeneration: z.string().optional() }).strict().parse(before)
          const admission = await lifecycle.status(principal)
          if (!admission.acceptingNewWork || admission.generation !== reviewed.admissionGeneration) throw new ActionDispatchPreventedError()
          if (local) {
            try {
              assertCurrentCaller()
              if (local.pairing.reviewGeneration() !== reviewed.localGeneration) throw new ActionDispatchPreventedError()
            } catch (error) {
              if (error instanceof LocalPairingError) throw new ActionDispatchPreventedError()
              throw error
            }
          }
          return name === 'publishSummary' ? publications.execute(principal, input)
            : services.withReviewedVersions(reviewed.source, () => operations.invoke(name, input))
        }
      })
      const contexts = new CollaborationService(options.store, options.authority, async (_actor, accountId, opportunityId) => {
        const accounts = await services.orchestrator.listAccounts()
        if (!accounts.some((account) => account.id === accountId)) throw new TeamsHttpError(403, 'source_access_denied')
        if (opportunityId) {
          const snapshot = await services.orchestrator.getOpportunitySnapshot(opportunityId)
          if (snapshot.account.id !== accountId) throw new TeamsHttpError(403, 'binding_target_mismatch')
        }
      })
      const publications = new PublicationService(options.store, contexts, async (_actor, binding) => {
        const account = (await services.orchestrator.listAccounts()).find((entry) => entry.id === binding.accountId)
        if (!account) throw new TeamsHttpError(403, 'source_access_denied')
        if (binding.opportunityId) {
          const snapshot = await services.orchestrator.getOpportunitySnapshot(binding.opportunityId)
          return {
            title: snapshot.opportunity.name,
            text: `${account.name}. Recorded MCEM stage ${snapshot.opportunity.recordedStage}. ${snapshot.milestones.length} visible milestones.`,
            sourceRecordIds: [snapshot.opportunity.id]
          }
        }
        const opportunities = await services.orchestrator.listOpportunities(account.id)
        return { title: account.name, text: `${opportunities.length} opportunities visible to the publisher at review.`, sourceRecordIds: [account.id] }
      }, async (actor, binding, projection) => {
        if (options.deliverPublication) return options.deliverPublication(actor, binding, projection)
        if (actor.mode !== 'sample') throw new TeamsHttpError(503, 'publication_delivery_unavailable')
        return { state: 'sample-only', detail: 'Approved sample artifact saved. No Teams message was sent.' }
      })
      if (request.method === 'GET' && url.pathname === '/api/teams/activity') {
        const items = await actions.list(principal)
        json(200, {
          contractVersion: collaborationVersion,
          actions: items.map((item) => ({ id: item.id, operation: item.operation, state: item.state })),
          notifications: (await notifications.list(principal)).map((item) => ({
            id: item.id, title: item.title, reference: item.reference, state: item.state, occurredAt: item.occurredAt
          })),
          workflows: await activity.list(principal, (runId) => {
            try { services.workflows.get({ contractVersion: workflowContractVersion, runId }); return true }
            catch (error) { if (error instanceof WorkflowRuntimeError && error.code === 'run_not_found') return false; throw error }
          })
        })
        return true
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/teams/references/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/teams/references/'.length))
        const row = await options.store.read(principalPartition(principal), `reference:${id}`)
        if (!row) throw new TeamsHttpError(403, 'private_reference_unavailable')
        const reference = z.object({ accountId: z.string(), query: z.string().min(2).max(100) }).strict().parse(row.value)
        const candidate = (await services.orchestrator.searchAccounts({ query: reference.query, matchBy: 'name' })).find((entry) => entry.id === reference.accountId)
        if (!candidate) throw new TeamsHttpError(403, 'source_access_denied')
        json(200, accountCandidateSchema.parse(candidate))
        return true
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/teams/contexts/')) {
        json(200, await contexts.get(principal, decodeURIComponent(url.pathname.slice('/api/teams/contexts/'.length))))
        return true
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/teams/shared/')) {
        json(200, await publications.readShared(principal, decodeURIComponent(url.pathname.slice('/api/teams/shared/'.length)), { stage: principal.mode === 'live' }))
        return true
      }
      if (request.method !== 'POST') throw new TeamsHttpError(404, 'route_not_found')
      const body = await readBody(request)
      if (!url.pathname.startsWith('/api/teams/operations/') && ![
        '/api/teams/documents/export', '/api/teams/documents/email', '/api/teams/meetings/sources',
        '/api/teams/meetings/review', '/api/teams/meetings/unsubscribe'
      ].includes(url.pathname)) await lifecycle.assertActive(principal)
      if (url.pathname === '/api/teams/documents/export') {
        const input = z.object({ opportunityId: z.string().min(1).max(200), document: exportResponseRequestSchema }).strict().parse(body)
        await services.orchestrator.getOpportunitySnapshot(input.opportunityId)
        const bytes = await createResponseDocumentBuffer(input.document)
        assertCurrentCaller()
        response.statusCode = 200
        response.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        response.setHeader('content-disposition', 'attachment; filename="TLC-response.docx"')
        response.end(bytes)
      } else if (url.pathname === '/api/teams/documents/email') {
        const input = z.object({ opportunityId: z.string().min(1).max(200), draft: emailComposeRequestSchema }).strict().parse(body)
        await services.orchestrator.getOpportunitySnapshot(input.opportunityId)
        assertCurrentCaller()
        response.statusCode = 200
        response.setHeader('content-type', 'message/rfc822')
        response.setHeader('content-disposition', 'attachment; filename="TLC-reviewed-draft.eml"')
        response.end(createOutlookDraftMessage(input.draft))
      } else if (url.pathname.startsWith('/api/teams/operations/')) {
        const name = decodeURIComponent(url.pathname.slice('/api/teams/operations/'.length))
        if (!operations.names().includes(name)) throw new TeamsHttpError(404, 'unknown_operation')
        if (operations.describe(name).effect !== 'read') throw new TeamsHttpError(403, 'review_required')
        if (operations.describe(name).startsWork) await lifecycle.assertActive(principal)
        if (operations.describe(name).startsWork) await new UserRequestBudget(options.store).consume(principal, 'agent', principal.mode === 'sample' ? 60 : 4)
        const result = await operations.invoke(name, body)
        if (['workflows.start', 'workflows.cancel'].includes(name)) await activity.record(principal, workflowRunSchema.parse(result))
        if (name === 'workflows.get') await activity.record(principal, z.object({ run: workflowRunSchema }).parse(result).run)
        json(200, result)
      } else if (url.pathname === '/api/teams/actions/preview') {
        const input = previewRequest.parse(body)
        if (input.operation === 'applyMeetingChangeSet') throw new TeamsHttpError(403, 'server_owned_meeting_draft_required')
        const normalized = operations.describe(input.operation).parse(input.input)
        json(200, await actions.prepare(principal, input.operation, normalized))
      } else if (url.pathname === '/api/teams/actions/commit') {
        const receipt = await actions.commit(principal, body)
        await notifications.enqueue(principal, receipt.id, receipt.state === 'confirmed' ? 'Reviewed action completed' : 'Action outcome needs attention', receipt.id)
        await options.notify?.(principal)
        json(200, receipt)
      } else if (url.pathname === '/api/teams/contexts') {
        json(200, await contexts.bind(principal, body))
      } else if (url.pathname === '/api/teams/publications/preview') {
        const input = z.object({ bindingId: z.string().min(1).max(200) }).strict().parse(body)
        json(200, await actions.prepare(principal, 'publishSummary', await publications.prepareInput(principal, input.bindingId)))
      } else if (url.pathname === '/api/teams/meetings/resolve') {
        const input = z.object({ joinUrl: z.url() }).strict().parse(body)
        json(200, { meetingId: await services.resolveMeeting(input.joinUrl) })
      } else if (url.pathname === '/api/teams/meetings/sources') {
        const input = z.object({ opportunityId: z.string().min(1).max(200) }).strict().parse(body)
        if (principal.mode !== 'sample') throw new TeamsHttpError(400, 'live_meeting_binding_required')
        await services.orchestrator.getOpportunitySnapshot(input.opportunityId)
        json(200, await services.listTranscriptSources(input.opportunityId))
      } else if (url.pathname === '/api/teams/meetings/manual') {
        const result = await acquisition.ingest(principal, body)
        await notifications.enqueueAcquisition(principal, result)
        await options.notify?.(principal)
        json(200, { status: result.status, proposals: result.proposals })
      } else if (url.pathname === '/api/teams/meetings/acquire') {
        const result = await acquisition.acquire(principal, body)
        if (result.status.state === 'ready') {
          await notifications.enqueueAcquisition(principal, result)
          await options.notify?.(principal)
        }
        const subscription = options.transcriptEvents && ['ready', 'waiting'].includes(result.status.state)
          ? await options.transcriptEvents.ensure(principal, body) : undefined
        json(200, { status: result.status, proposals: result.proposals, ...(subscription ? { subscription } : {}) })
      } else if (url.pathname === '/api/teams/meetings/unsubscribe') {
        if (!options.transcriptEvents) throw new TeamsHttpError(400, 'graph_notifications_disabled')
        json(200, await options.transcriptEvents.stop(principal, body))
      } else if (url.pathname === '/api/teams/meetings/review') {
        const input = z.object({ acquisitionId: z.string().min(1).max(200) }).strict().parse(body)
        json(200, await acquisition.review(principal, input.acquisitionId))
      } else if (url.pathname === '/api/teams/meetings/preview-changes') {
        const input = z.object({
          acquisitionId: z.string().min(1).max(200),
          approval: meetingChangeSetApprovalSchema
        }).strict().parse(body)
        const proposal = (await acquisition.review(principal, input.acquisitionId))
          .find((entry) => entry.changeSetId === input.approval.changeSetId && entry.opportunityId === input.approval.opportunityId)
        if (!proposal) throw new TeamsHttpError(403, 'meeting_draft_unavailable')
        if (input.approval.approvedSlotIds.some((id) => !proposal.slots.some((slot) => slot.slotId === id && !slot.blocked))
          || input.approval.approvedNewMilestoneTempIds.some((id) => !proposal.newMilestones.some((entry) => entry.tempId === id))) {
          throw new TeamsHttpError(400, 'invalid_change_selection')
        }
        json(200, await actions.prepare(principal, 'applyMeetingChangeSet', { proposal, approval: input.approval }))
      } else {
        throw new TeamsHttpError(404, 'route_not_found')
      }
    } catch (error) {
      const status = error instanceof GraphMeetingError ? error.state === 'denied' || error.state === 'admin-blocked' ? 403 : error.state === 'auth-required' ? 409 : error.state === 'unsupported' ? 400 : 503
        : error instanceof ManualTranscriptError ? 400
        : error instanceof NativeConnectionError ? error.code === 'native_source_denied' ? 403 : error.code === 'native_resource_unavailable' ? 409 : 401 : error instanceof LocalPairingError ? error.status : error instanceof CollaborationAdmissionError || error instanceof ActionReviewStaleError ? 409 : error instanceof WorkflowScopeAuthorizationError ? 403 : error instanceof RequestQuotaError ? 429 : error instanceof TeamsAuthorizationError ? 401 : error instanceof TeamsHttpError ? error.status
        : error instanceof ZodError || error instanceof SyntaxError || error instanceof URIError ? 400 : 500
      const code = error instanceof GraphMeetingError ? error.code === 'invalid_meeting_link' ? 'graph_invalid_meeting_link' : `graph_${error.state.replaceAll('-', '_')}`
        : error instanceof ManualTranscriptError ? error.code
        : error instanceof NativeConnectionError || error instanceof LocalPairingError ? error.code : error instanceof CollaborationAdmissionError ? error.code : error instanceof ActionReviewStaleError ? 'action_review_stale' : error instanceof WorkflowScopeAuthorizationError ? 'workflow_source_scope_changed' : error instanceof RequestQuotaError ? 'user_quota_exhausted' : error instanceof TeamsAuthorizationError ? error.code : error instanceof TeamsHttpError ? error.code : status === 400 ? 'invalid_request' : 'operation_failed'
      const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? '') ? request.method! : 'OTHER'
      const candidate = url.pathname.split('/')[3] ?? ''
      const category = ['session', 'config', 'local', 'operations', 'actions', 'activity', 'contexts', 'meetings', 'publications', 'shared', 'documents', 'graph', 'references', 'lifecycle'].includes(candidate) ? candidate : 'unknown'
      options.onError?.({ correlationId, code, method, category })
      const claims = error instanceof TeamsAuthorizationError ? error.claims : undefined
      if (claims && options.configuration.mode === 'live') response.setHeader('www-authenticate', `Bearer authorization_uri="https://login.microsoftonline.com/${options.configuration.tenantId}/oauth2/v2.0/authorize", error="insufficient_claims", claims="${Buffer.from(claims).toString('base64')}"`)
      json(status, { error: code, correlationId, ...(claims ? { claims } : {}) })
    }
    return true
  }
}

export async function readBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new TeamsHttpError(415, 'json_required')
  const declared = Number(request.headers['content-length'])
  if (declared > bodyLimit) {
    request.resume()
    throw new TeamsHttpError(413, 'request_too_large')
  }
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= bodyLimit) chunks.push(chunk)
    })
    request.on('error', reject)
    request.on('end', () => size > bodyLimit ? reject(new TeamsHttpError(413, 'request_too_large')) : resolve(Buffer.concat(chunks).toString('utf8')))
  })
  return JSON.parse(raw) as unknown
}
