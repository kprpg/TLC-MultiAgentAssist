import {
  cacheSyncVersion, mutationSyncRequestSchema, syncMutationOperationSchema,
  type MutationSyncRequest, type MutationSyncResponse, type SyncMutationOperation
} from '../../common/contracts/cache-sync.js'
import type { MutationState } from '../../connectors/common/mutation-state.js'
import type { ThinSliceOrchestrator } from '../index.js'
import { createCoreMutationHost, delegatedMutationActor } from './core-adapter.js'
import { MutationDispatchPreventedError, MutationRuntime, type MutationActor, type SharedMutationHost } from './host.js'
import type { ApplicationServices } from '../application-runtime.js'

export interface MutationSession {
  invoke(request: MutationSyncRequest): Promise<MutationSyncResponse>
  drain(): Promise<void>
  resumeAdmission(): Promise<void>
}

export function createMutationSession(options: {
  core: ThinSliceOrchestrator
  mode: 'sample' | 'live'
  source: string
  state: MutationState
  enabled: boolean
  readCacheOwner: 'host' | 'client'
  getToken?(): Promise<string>
  actor?: MutationActor
  runtime?: MutationRuntime
  isCurrent?(): boolean
  conditionalOperations?(): Promise<ReadonlyArray<'updateOpportunity' | 'updateMilestone' | 'transitionOpportunityStage'>>
  excludeOperations?: readonly SyncMutationOperation[]
  assertAllowed?(operation: SyncMutationOperation): Promise<void>
  reviewContext?(): Promise<unknown>
  applyMeeting?: ApplicationServices['meetings']['applyMeetingChangeSet']
}): MutationSession {
  const runtime = options.runtime ?? new MutationRuntime()
  let resolved: Promise<SharedMutationHost> | undefined
  const available = options.state.durable && options.state.store?.delete !== undefined
  const resolve = async () => {
    if (resolved) return resolved
    resolved = (async () => {
      const identity = options.getToken ? delegatedMutationActor(options.source, options.getToken, options.isCurrent) : undefined
      const actor: MutationActor = options.actor ?? (options.mode === 'sample'
        ? { partition: `${options.source}:sample`, assertCurrent: async () => {
          if (options.isCurrent && !options.isCurrent()) throw new MutationDispatchPreventedError('session-changed', 'The sample source session changed.')
        } } : identity ? await identity.resolve() : (() => { throw new MutationDispatchPreventedError('auth-required', 'A verified source actor is required.') })())
      const store = options.state.store
      if (!store) throw new MutationDispatchPreventedError('storage-unavailable', 'Durable mutation state is unavailable.')
      const health = await store.read('mutation-store:health', 'v1')
      if (!health && !await store.insert('mutation-store:health', 'v1', 'ready')
        && !(await store.read('mutation-store:health', 'v1'))) throw new MutationDispatchPreventedError('storage-unavailable', 'Mutation storage could not be verified.')
      const supported: SyncMutationOperation[] = !options.enabled ? [] : options.mode === 'sample'
        ? syncMutationOperationSchema.options.filter((operation) => operation !== 'applyMeetingChangeSet' || options.applyMeeting !== undefined)
        : ['addAccount', 'setAccountVisibility', ...(await options.conditionalOperations?.() ?? [])]
      const operations = supported.filter((operation) => !options.excludeOperations?.includes(operation))
      return createCoreMutationHost({
        core: options.core, actor, store, durable: true, operations, runtime, readCacheOwner: options.readCacheOwner,
        ...(options.mode === 'live' ? { requireNativeVersions: true } : {}),
        ...(identity ? { verifyAccessToken: identity.verify } : {}),
        ...(options.assertAllowed ? { assertAllowed: options.assertAllowed } : {}),
        ...(options.reviewContext ? { reviewContext: options.reviewContext } : {}),
        ...(options.applyMeeting ? { applyMeeting: options.applyMeeting } : {}),
        onError: (code) => console.error(`[mutation-sync] ${code}`)
      })
    })().catch((error: unknown) => { resolved = undefined; throw error })
    return resolved
  }
  return {
    async invoke(rawRequest) {
      const request = mutationSyncRequestSchema.parse(rawRequest)
      if (!available) {
        if (request.operation !== 'capabilities') throw new MutationDispatchPreventedError('storage-unavailable', 'Protected durable background writes are not configured.')
        return { contractVersion: cacheSyncVersion, kind: 'capabilities', capabilities: {
          contractVersion: cacheSyncVersion, available: false, readCacheOwner: options.readCacheOwner, operations: [],
          reason: options.enabled ? 'Protected durable receipt storage is unavailable. Saves use acknowledged mode.'
            : 'Background writes are not enabled. Saves use acknowledged mode.'
        } }
      }
      return (await resolve()).invoke(request)
    },
    drain: () => runtime.drain(),
    resumeAdmission: async () => { runtime.closing = false }
  }
}
