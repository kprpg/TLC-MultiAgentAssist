import { createHash, randomUUID } from 'node:crypto'
import {
  cacheSyncVersion, mutationSyncRequestSchema, mutationSyncResponseSchema,
  type MutationFailureCode, type MutationReceipt, type MutationReview, type MutationSyncResponse,
  type SyncMutationOperation
} from '../../common/contracts/cache-sync.js'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import { canonicalJson } from '../collaboration/reviewed-actions.js'
import { MutationJournal, MutationJournalError } from './journal.js'

export interface MutationActor {
  partition: string
  assertCurrent(): Promise<void>
}
export interface MutationAuthorization {
  before: unknown
  revisionTokens?: Record<string, string>
  recordKeys: string[]
}
export interface MutationHostOptions {
  actor: MutationActor
  store?: ScopedDocumentStore
  durable?: boolean
  operations: readonly SyncMutationOperation[]
  readCacheOwner?: 'host' | 'client'
  validate(operation: SyncMutationOperation, input: Record<string, unknown>): Record<string, unknown>
  authorize(operation: SyncMutationOperation, input: Record<string, unknown>): Promise<MutationAuthorization>
  authorizeResult?(operation: SyncMutationOperation, input: Record<string, unknown>): Promise<void>
  execute(operation: SyncMutationOperation, input: Record<string, unknown>, reviewed: { revisionTokens: Record<string, string>; onDispatch?: () => void }): Promise<unknown>
  tracksDispatch?: readonly SyncMutationOperation[]
  reconcile?(operation: SyncMutationOperation, input: Record<string, unknown>): Promise<boolean>
  runtime?: MutationRuntime
  now?: () => number
  onError?(code: string): void
}

export class MutationDispatchPreventedError extends Error {
  readonly effect = 'not-dispatched'
  readonly status: number
  constructor(readonly code: MutationFailureCode, message: string) {
    super(message); this.name = 'MutationDispatchPreventedError'
    this.status = ['auth-required', 'session-changed'].includes(code) ? 401 : code === 'access-denied' ? 403 : 409
  }
}

export class MutationRuntime {
  readonly jobs = new Map<string, Promise<void>>()
  readonly results = new Map<string, unknown>()
  closing = false

  async drain(timeoutMs = 10_000): Promise<void> {
    this.closing = true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled([...this.jobs.values()]),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs) })
      ])
    } finally { if (timer) clearTimeout(timer) }
  }
}

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
const ongoing = (receipt: MutationReceipt) => ['accepted', 'dispatching', 'effect-unknown'].includes(receipt.state)
const errorStatus = (error: unknown): number | undefined => error !== null && typeof error === 'object'
  && 'status' in error && typeof error.status === 'number' ? error.status : undefined

export class SharedMutationHost {
  private readonly now: () => number
  private readonly runtime: MutationRuntime
  private readonly journal: MutationJournal | undefined

  constructor(private readonly options: MutationHostOptions) {
    this.now = options.now ?? Date.now
    this.runtime = options.runtime ?? new MutationRuntime()
    this.journal = options.store && options.durable && options.store.delete ? new MutationJournal(options.store, this.now) : undefined
  }

  async invoke(rawRequest: unknown): Promise<MutationSyncResponse> {
    const request = mutationSyncRequestSchema.parse(rawRequest)
    await this.options.actor.assertCurrent()
    if (request.operation === 'capabilities') {
      return mutationSyncResponseSchema.parse({ contractVersion: cacheSyncVersion, kind: 'capabilities', capabilities: {
        contractVersion: cacheSyncVersion, available: Boolean(this.journal && this.options.operations.length && !this.runtime.closing),
        recoveryAvailable: Boolean(this.journal),
        readCacheOwner: this.options.readCacheOwner ?? 'client', operations: this.journal ? this.options.operations : [],
        ...(!this.journal ? { reason: 'Durable protected mutation storage is not configured. Existing acknowledged writes remain available.' }
          : !this.options.operations.length ? { reason: 'Background admission is disabled. Existing private receipts remain available.' } : {})
      } })
    }
    const journal = this.requireJournal()
    if (request.operation === 'prepare') {
      if (!this.options.operations.includes(request.mutation)) throw new MutationDispatchPreventedError('unsupported', 'This source operation does not support safe background execution.')
      if (this.runtime.closing) throw new MutationDispatchPreventedError('session-changed', 'The source session is closing.')
      const input = this.options.validate(request.mutation, request.input)
      const authorization = await this.options.authorize(request.mutation, input)
      await this.options.actor.assertCurrent()
      const id = randomUUID()
      const expiresAt = new Date(this.now() + 300_000).toISOString()
      const beforeDigest = hash(authorization.before)
      const digest = hash({ partition: this.options.actor.partition, id, operation: request.mutation,
        input, beforeDigest, revisionTokens: authorization.revisionTokens ?? {}, expiresAt })
      const review: MutationReview = {
        contractVersion: cacheSyncVersion, id, operation: request.mutation, input, digest, expiresAt,
        before: authorization.before, recordKeys: authorization.recordKeys
      }
      await journal.prune(this.options.actor.partition)
      await journal.prepare(this.options.actor.partition, review, beforeDigest, authorization.revisionTokens ?? {})
      return mutationSyncResponseSchema.parse({ contractVersion: cacheSyncVersion, kind: 'review', review })
    }
    if (request.operation === 'pending') {
      const pending = await journal.pending(this.options.actor.partition)
      const receipts: MutationReceipt[] = []
      for (const receipt of pending) {
        receipts.push(['accepted', 'dispatching'].includes(receipt.state)
          && this.now() - Date.parse(receipt.updatedAt) > 120_000
          ? await journal.transition(this.options.actor.partition, receipt.id, { state: 'effect-unknown', code: 'outcome-unconfirmed' })
          : receipt)
      }
      await this.options.actor.assertCurrent()
      return mutationSyncResponseSchema.parse({ contractVersion: cacheSyncVersion, kind: 'pending', receipts })
    }
    const { record } = await journal.read(this.options.actor.partition, request.id)
    if (request.operation === 'submit') {
      if (!this.options.operations.includes(record.review.operation)) throw new MutationDispatchPreventedError('access-denied', 'This operation is not allowed in the current source profile.')
      if (record.review.digest !== request.digest) throw new MutationJournalError('review-changed', 'The reviewed mutation digest changed.')
      if (record.receipt) return this.receiptResponse(record.receipt)
      if (this.runtime.closing) throw new MutationDispatchPreventedError('session-changed', 'The source session is closing.')
      if (Date.parse(record.review.expiresAt) <= this.now()) throw new MutationJournalError('review-expired', 'The source review expired.')
      const current = await this.options.authorize(record.review.operation, record.review.input)
      await this.options.actor.assertCurrent()
      if (hash(current.before) !== record.beforeDigest) throw new MutationJournalError('review-changed', 'Source state changed. Review current values before saving.')
      let admission: Awaited<ReturnType<MutationJournal['claim']>>
      try {
        admission = await journal.claim(this.options.actor.partition, request.id, request.digest, request.reason)
      } catch (error) {
        if (!(error instanceof MutationJournalError) || error.code !== 'capacity') throw error
        return this.receiptResponse(await journal.failBeforeSend(this.options.actor.partition, request.id, 'capacity'))
      }
      if (admission.claimed) {
        const key = this.jobKey(request.id)
        const job = this.execute(request.id, record.review.operation, record.review.input, record.revisionTokens)
        this.runtime.jobs.set(key, job)
        void job.then(() => this.runtime.jobs.delete(key), () => this.runtime.jobs.delete(key))
      }
      return this.receiptResponse(admission.receipt)
    }
    if (!record.receipt) {
      if (request.operation === 'reconcile') return this.receiptResponse(
        await journal.failBeforeSend(this.options.actor.partition, request.id, 'validation'))
      throw new MutationJournalError('review-changed', 'This review has not been submitted.')
    }
    if (request.operation === 'reconcile') {
      if (!ongoing(record.receipt)) return this.receiptResponse(record.receipt)
      if (this.runtime.jobs.has(this.jobKey(request.id))) return this.receiptResponse(record.receipt)
      const matching = await this.options.reconcile?.(record.review.operation, record.review.input)
      await this.options.actor.assertCurrent()
      const receipt = await journal.transition(this.options.actor.partition, request.id,
        matching ? { state: 'reconciled-current-state' } : { state: 'effect-unknown', code: 'outcome-unconfirmed' })
      return this.receiptResponse(receipt)
    }
    if (['accepted', 'dispatching'].includes(record.receipt.state)
      && this.now() - Date.parse(record.receipt.updatedAt) > 120_000) {
      return this.receiptResponse(await journal.transition(this.options.actor.partition, request.id, { state: 'effect-unknown', code: 'outcome-unconfirmed' }))
    }
    return this.receiptResponse(record.receipt)
  }

  drain(timeoutMs?: number): Promise<void> { return this.runtime.drain(timeoutMs) }

  private async execute(id: string, operation: SyncMutationOperation, input: Record<string, unknown>, revisionTokens: Record<string, string>): Promise<void> {
    const journal = this.requireJournal()
    let dispatched = false
    let sourceReturned = false
    try {
      await this.options.actor.assertCurrent()
      await journal.transition(this.options.actor.partition, id, { state: 'dispatching' })
      const tracked = this.options.tracksDispatch?.includes(operation)
      dispatched = !tracked
      const result = await this.options.execute(operation, input, { revisionTokens, ...(tracked ? { onDispatch: () => { dispatched = true } } : {}) })
      sourceReturned = true
      await this.options.actor.assertCurrent()
      if (result !== null && typeof result === 'object' && 'state' in result && result.state === 'rolled-back') {
        await journal.transition(this.options.actor.partition, id, { state: 'effect-unknown', code: 'outcome-unconfirmed' })
        return
      }
      await journal.transition(this.options.actor.partition, id, { state: 'confirmed' })
      if (this.runtime.results.size >= 100) this.runtime.results.delete(this.runtime.results.keys().next().value!)
      this.runtime.results.set(this.jobKey(id), result)
    } catch (error) {
      this.options.onError?.(errorStatus(error) === 412 ? 'source-conflict' : 'mutation-unconfirmed')
      const prevented = !sourceReturned && (error instanceof MutationDispatchPreventedError || error !== null && typeof error === 'object' && 'effect' in error && error.effect === 'not-dispatched')
      try {
        await journal.transition(this.options.actor.partition, id, errorStatus(error) === 412
          ? { state: 'conflict', code: 'source-conflict' }
          : !sourceReturned && (!dispatched || prevented) ? { state: 'failed-before-send', code: error instanceof MutationDispatchPreventedError ? error.code : 'validation' }
            : { state: 'effect-unknown', code: 'outcome-unconfirmed' })
      } catch (persistenceError) {
        this.options.onError?.('receipt-persistence-unconfirmed')
        throw persistenceError
      }
    }
  }

  private async receiptResponse(receipt: MutationReceipt): Promise<MutationSyncResponse> {
    await this.options.actor.assertCurrent()
    let result = this.runtime.results.get(this.jobKey(receipt.id))
    if (receipt.state === 'confirmed' && result !== undefined) {
      const { record } = await this.requireJournal().read(this.options.actor.partition, receipt.id)
      try {
        if (this.options.authorizeResult) await this.options.authorizeResult(record.review.operation, record.review.input)
        else await this.options.authorize(record.review.operation, record.review.input)
      } catch (error) {
        this.options.onError?.('result-authorization-unavailable')
        result = undefined
        receipt = { ...receipt, code: errorStatus(error) === 403 ? 'access-denied'
          : errorStatus(error) === 401 ? 'auth-required' : 'source-unavailable' }
      }
      await this.options.actor.assertCurrent()
    }
    return mutationSyncResponseSchema.parse({
      contractVersion: cacheSyncVersion, kind: 'receipt',
      receipt: { ...receipt, ...(receipt.state === 'confirmed' && result !== undefined ? { result } : {}) }
    })
  }

  private requireJournal(): MutationJournal {
    if (!this.journal) throw new MutationDispatchPreventedError('storage-unavailable', 'Durable protected mutation storage is unavailable.')
    return this.journal
  }
  private jobKey(id: string): string { return `${this.options.actor.partition}:${id}` }
}
