import { createHash } from 'node:crypto'
import { z } from 'zod'
import { acquisitionSchema, collaborationVersion, type Acquisition } from '../../common/contracts/collaboration.js'
import { meetingChangeSetProposalSchema, type MeetingChangeSetProposal, type MeetingTranscript } from '../../common/contracts/meeting.js'
import { GraphMeetingError, type GraphAcquisitionResult } from '../../connectors/graph/meetings.js'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import { principalPartition, requireRole, type ExecutionPrincipal } from './principal.js'
import { canonicalJson } from './reviewed-actions.js'
import { CollaborationLifecycle } from './lifecycle.js'
import { UserRequestBudget } from './request-budget.js'

export const meetingAcquisitionRequestSchema = z.object({
  meetingId: z.string().min(1).max(500),
  opportunityId: z.string().min(1).max(200),
  meetingType: z.enum(['customer', 'internal'])
}).strict()
export type MeetingAcquisitionRequest = z.infer<typeof meetingAcquisitionRequestSchema>
const recordSchema = z.object({
  request: meetingAcquisitionRequestSchema,
  attempts: z.number().int().nonnegative(),
  notificationPasses: z.array(z.string().min(1).max(200)).max(20).default([]),
  claimUntil: z.number(),
  status: acquisitionSchema,
  versions: z.record(z.string(), z.string()),
  proposals: z.array(meetingChangeSetProposalSchema)
}).strict()

export class MeetingAcquisitionService {
  constructor(private readonly store: ScopedDocumentStore, private readonly options: {
    readOpportunity(principal: ExecutionPrincipal, opportunityId: string): Promise<void>
    getTranscripts(principal: ExecutionPrincipal, request: MeetingAcquisitionRequest): Promise<GraphAcquisitionResult>
    propose(principal: ExecutionPrincipal, opportunityId: string, transcript: MeetingTranscript): Promise<MeetingChangeSetProposal>
  }) {}
  async acquire(principal: ExecutionPrincipal, raw: unknown, notification?: { notificationId: string }): Promise<{ status: Acquisition; proposals: MeetingChangeSetProposal[]; evidenceVersion?: string }> {
    requireRole(principal, 'TLC.Teams.User')
    const request = meetingAcquisitionRequestSchema.parse(raw)
    const lifecycle = new CollaborationLifecycle(this.store)
    const admission = await lifecycle.assertActive(principal)
    await this.options.readOpportunity(principal, request.opportunityId)
    const id = createHash('sha256').update(canonicalJson(request)).digest('hex')
    const key = `acquisition:${id}`
    const partition = principalPartition(principal)
    const status: Acquisition = {
      contractVersion: collaborationVersion, id, meetingId: request.meetingId, state: 'waiting',
      transcriptIds: [], attribution: 'unknown', detail: 'Checking authorized meeting transcripts.', checkedAt: new Date().toISOString()
    }
    await this.store.insert(partition, key, { request, attempts: 0, claimUntil: 0, status, versions: {}, proposals: [] })
    const row = await this.store.read(partition, key)
    if (!row) throw new Error('The meeting acquisition could not be persisted.')
    const record = recordSchema.parse(row.value)
    if (record.claimUntil > Date.now()) return { status: { ...record.status, state: 'waiting', detail: 'Another request is acquiring this transcript.' }, proposals: [] }
    const notificationId = notification ? z.string().min(1).max(200).parse(notification.notificationId) : undefined
    const freshNotification = notificationId !== undefined && !record.notificationPasses.includes(notificationId)
    if (freshNotification && record.notificationPasses.length >= 20) {
      return { status: { ...record.status, state: 'paused', detail: 'The bounded notification recovery budget is exhausted. Contact the application owner.' }, proposals: [] }
    }
    const attempts = freshNotification ? 0 : record.attempts
    if (attempts >= 10) return { status: { ...record.status, state: 'paused', detail: 'Foreground discovery is paused. A verified new transcript notification can start another bounded discovery pass.' }, proposals: [] }
    const notificationPasses = freshNotification ? [...record.notificationPasses, notificationId] : record.notificationPasses
    if (!await this.store.replace(partition, key, row.revision, { ...record, notificationPasses, attempts: attempts + 1, claimUntil: Date.now() + 180_000 })) {
      throw new Error('Another request owns this meeting acquisition.')
    }
    let updated = { ...record, notificationPasses, attempts: attempts + 1, claimUntil: 0 }
    try {
      await lifecycle.assertGeneration(principal, admission.generation)
      const result = await this.options.getTranscripts(principal, request)
      await lifecycle.assertGeneration(principal, admission.generation)
      const proposals: MeetingChangeSetProposal[] = []
      if (result.transcripts.length) await new UserRequestBudget(this.store).consume(principal, 'agent', principal.mode === 'sample' ? 60 : 4)
      for (const transcript of result.transcripts) {
        await lifecycle.assertActive(principal)
        proposals.push(meetingChangeSetProposalSchema.parse(await this.options.propose(principal, request.opportunityId, transcript)))
      }
      await lifecycle.assertGeneration(principal, admission.generation)
      updated = {
        ...updated, versions: result.contentVersions, proposals,
        status: acquisitionSchema.parse({
          ...status, state: result.state, transcriptIds: result.transcripts.map((transcript) => transcript.id),
          attribution: result.attribution, checkedAt: new Date().toISOString(),
          detail: result.state === 'ready' ? 'Authorized transcripts acquired automatically. Review proposed changes before applying.' : 'The meeting transcript is not ready.'
        })
      }
    } catch (error) {
      if (!(error instanceof GraphMeetingError)) {
        if (!await this.store.replace(partition, key, row.revision + 1, {
          ...updated, proposals: [], status: { ...status, state: 'paused', detail: 'Acquisition stopped. Reconnect or review the operation error before continuing.' }
        })) throw new Error('The stopped acquisition could not be persisted.', { cause: error })
        throw error
      }
      updated = { ...updated, proposals: [], status: { ...status, state: error.state, detail: error.message, checkedAt: new Date().toISOString() } }
    }
    if (!await this.store.replace(partition, key, row.revision + 1, updated)) {
      throw new Error('The acquisition result could not be persisted. No business changes were applied.')
    }
    return {
      status: updated.status, proposals: updated.proposals,
      ...(updated.status.state === 'ready' ? { evidenceVersion: createHash('sha256').update(canonicalJson(updated.versions)).digest('hex') } : {})
    }
  }
  async review(principal: ExecutionPrincipal, id: string): Promise<MeetingChangeSetProposal[]> {
    requireRole(principal, 'TLC.Teams.User')
    await new CollaborationLifecycle(this.store).assertReadable(principal)
    const row = await this.store.read(principalPartition(principal), `acquisition:${id}`)
    if (!row) throw new Error('The acquired meeting draft is unavailable for this user.')
    const record = recordSchema.parse(row.value)
    if (record.status.state !== 'ready') throw new Error('The meeting draft is not ready.')
    await this.options.readOpportunity(principal, record.request.opportunityId)
    const current = await this.options.getTranscripts(principal, record.request)
    if (canonicalJson(current.contentVersions) !== canonicalJson(record.versions)) {
      throw new Error('Transcript evidence changed. Acquire and review a new draft.')
    }
    return record.proposals
  }
}
