import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SyncMutationOperation } from '../../common/contracts/cache-sync.js'
import * as c from '../../common/contracts/index.js'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import type { ThinSliceOrchestrator } from '../index.js'
import { createCoreMutationOperations } from '../operations.js'
import type { ApplicationServices } from '../application-runtime.js'
import { MutationDispatchPreventedError, SharedMutationHost, type MutationActor, type MutationRuntime } from './host.js'

const subjectSchema = z.object({ tid: z.string().guid(), oid: z.string().guid(), scp: z.string().trim().min(1) })
function sourceSubject(token: string): z.infer<typeof subjectSchema> {
  const part = token.split('.')[1]
  if (!part) throw new MutationDispatchPreventedError('auth-required', 'A verified delegated source token is required.')
  try { return subjectSchema.parse(JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))) } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new MutationDispatchPreventedError('auth-required', 'A verified delegated user identity is required. App-only source tokens cannot authorize these writes.')
    }
    throw error
  }
}
export function bindSourceToken(getToken: () => Promise<string>, source: string, onSessionChanged?: () => void): () => Promise<string> {
  let expected: string | undefined
  return async () => {
    const token = await getToken()
    const subject = sourceSubject(token)
    const identity = createHash('sha256').update(JSON.stringify([source, subject.tid, subject.oid])).digest('hex')
    if (expected !== undefined && identity !== expected) {
      onSessionChanged?.()
      throw new MutationDispatchPreventedError('session-changed', 'The source identity changed. Reconnect before reading private data.')
    }
    expected = identity
    return token
  }
}

export function delegatedMutationActor(source: string, getToken: () => Promise<string>, isCurrent = () => true): {
  resolve(): Promise<MutationActor>
  verify(token: string): void
} {
  let expected: string | undefined
  const subject = (token: string) => {
    const value = sourceSubject(token)
    return createHash('sha256').update(JSON.stringify([source, value.tid, value.oid])).digest('hex')
  }
  const verify = (token: string) => {
    if (!isCurrent() || expected === undefined || subject(token) !== expected) {
      throw new MutationDispatchPreventedError('session-changed', 'The original source identity changed. Reconnect and prepare a new review.')
    }
  }
  return {
    verify,
    async resolve() {
      const partition = subject(await getToken())
      if (expected !== undefined && partition !== expected) throw new MutationDispatchPreventedError('session-changed', 'The source identity changed.')
      expected = partition
      return { partition, assertCurrent: async () => verify(await getToken()) }
    }
  }
}

export function createCoreMutationHost(options: {
  core: ThinSliceOrchestrator
  actor: MutationActor
  store?: ScopedDocumentStore
  durable: boolean
  operations: readonly SyncMutationOperation[]
  runtime?: MutationRuntime
  readCacheOwner: 'host' | 'client'
  verifyAccessToken?: (token: string) => void
  requireNativeVersions?: boolean
  assertAllowed?(operation: SyncMutationOperation): Promise<void>
  reviewContext?(): Promise<unknown>
  applyMeeting?: ApplicationServices['meetings']['applyMeetingChangeSet']
  onError?(code: string): void
}): SharedMutationHost {
  const core = options.core
  const mutations = createCoreMutationOperations(core, options.applyMeeting)
  const snapshot = async (operation: SyncMutationOperation, input: Record<string, unknown>, writing = true) => core.withFreshReadContext(async () => {
    if (writing) await options.assertAllowed?.(operation)
    if (operation === 'addAccount' || operation === 'setAccountVisibility') {
      return { before: await core.listAccounts({ includeHidden: true }), revisionTokens: {}, recordKeys: [`account:${String(input['accountId'])}`] }
    }
    if (operation === 'commitRecordCreation') {
      const request = c.recordCreationCommitRequestSchema.parse(input)
      const catalog = await core.getRecordCreationCatalog({ contractVersion: c.contractVersion, accountId: request.preview.normalizedDraft.account.id })
      if (request.preview.target !== 'draft' && catalog.target !== 'sqlite') throw new MutationDispatchPreventedError('unsupported', 'Live creation remains disabled; export this draft instead.')
      return { before: catalog,
        revisionTokens: {}, recordKeys: [`account:${request.preview.normalizedDraft.account.id}`] }
    }
    const opportunityId = operation === 'applyMeetingChangeSet'
      ? c.meetingChangeSetProposalSchema.parse(input['proposal']).opportunityId : z.string().min(1).parse(input['opportunityId'])
    if (operation === 'joinDealTeam' || operation === 'joinMilestoneTeam') {
      const discovery = await core.getDiscoverySnapshot({ contractVersion: c.discoverySnapshotVersion })
      const candidate = discovery.opportunities.find((item) => item.id === opportunityId)
      if (!candidate) throw new MutationDispatchPreventedError('access-denied', 'The record is outside the current Discovery scope.')
      const milestones = operation === 'joinMilestoneTeam' ? await core.listDiscoverableMilestones(opportunityId) : []
      if (input['milestoneId'] && !milestones.some((item) => item.id === input['milestoneId'])) throw new MutationDispatchPreventedError('access-denied', 'The milestone is outside the selected opportunity.')
      return { before: { opportunity: candidate, milestones }, revisionTokens: {}, recordKeys: [`opportunity:${opportunityId}`] }
    }
    const current = await core.getOpportunitySnapshot(opportunityId)
    const revisionTokens = current.revisionTokens ?? {}
    if (writing && options.requireNativeVersions && ['updateOpportunity', 'updateMilestone', 'transitionOpportunityStage'].includes(operation)) {
      const path = operation === 'updateMilestone'
        ? `msp_engagementmilestones(${String(input['milestoneId'])})` : `opportunities(${opportunityId})`
      if (!revisionTokens[path.toLowerCase()]) throw new MutationDispatchPreventedError('unsupported', 'This record has no authoritative source version for safe background updates.')
    }
    return { before: current, revisionTokens, recordKeys: [`opportunity:${opportunityId}`] }
  })
  return new SharedMutationHost({
    ...options,
    ...(options.requireNativeVersions ? { tracksDispatch: ['updateOpportunity', 'updateMilestone', 'transitionOpportunityStage'] } : {}),
    validate: (operation, input) => mutations[operation].parse(input),
    authorize: async (operation, input) => {
      const value = await snapshot(operation, input)
      return options.reviewContext ? { ...value, before: { source: value.before, context: await options.reviewContext() } } : value
    },
    authorizeResult: async (operation, input) => { await snapshot(operation, input, false) },
    execute: async (operation, input, reviewed) => {
      await options.assertAllowed?.(operation)
      return core.withReviewedVersions(reviewed.revisionTokens,
        () => mutations[operation].run(input), options.verifyAccessToken, reviewed.onDispatch)
    },
    reconcile: async (operation, input) => {
      const current = await snapshot(operation, input, false)
      if (operation === 'setAccountVisibility' || operation === 'addAccount') {
        const accounts = c.accountSchema.array().parse(current.before)
        return accounts.some((account) => account.id === input['accountId']
          && (operation === 'addAccount' || account.visibility === input['visibility']))
      }
      if (operation === 'joinDealTeam') {
        return z.object({ opportunity: c.discoverableOpportunitySchema }).parse(current.before).opportunity.onDealTeam
      }
      if (operation === 'updateOpportunity') {
        const value = z.object({ opportunity: c.opportunitySchema }).parse(current.before)
        return value.opportunity.comments === c.opportunityUpdateSchema.parse(input['update']).comments
      }
      if (operation === 'transitionOpportunityStage') {
        return z.object({ opportunity: c.opportunitySchema }).parse(current.before).opportunity.recordedStage === input['targetStage']
      }
      if (operation === 'updateMilestone') {
        const milestone = z.object({ milestones: z.array(c.milestoneSchema) }).parse(current.before).milestones.find((item) => item.id === input['milestoneId'])
        if (!milestone) return false
        const update = c.milestoneUpdateSchema.parse(input['update'])
        return Object.entries(update).every(([key, value]) => key === 'customerCommitment' ? milestone.commitment === value
          : key === 'status' ? milestone.status === value : key === 'comments' ? milestone.comments === value
            : key === 'targetDate' ? milestone.targetDate === value : milestone.riskDetails === value)
      }
      return false
    }
  })
}
