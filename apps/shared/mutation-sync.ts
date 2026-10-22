import {
  cacheSyncVersion, mutationSyncResponseSchema,
  type MutationCapabilities, type MutationReceipt, type MutationReview, type MutationSyncRequest,
  type MutationSyncResponse, type SyncMutationOperation
} from '../../packages/common/contracts/cache-sync.js'
import { milestoneSchema, milestoneUpdateSchema, opportunitySchema, opportunityUpdateSchema, type DiscoverableOpportunity, type Milestone, type Opportunity } from '../../packages/common/contracts/index.js'

export type MutationInvoker = (request: MutationSyncRequest) => Promise<MutationSyncResponse>
export interface PendingMutationView {
  id: string
  operation: SyncMutationOperation
  input: Record<string, unknown>
  state: 'preparing' | 'submitting' | MutationReceipt['state']
  error?: string
  receipt?: MutationReceipt
  review?: MutationReview
}
export interface MutationUiSnapshot {
  revision: number
  jobs: readonly PendingMutationView[]
  pending: number
  mode: 'unconfigured' | 'background' | 'acknowledged'
  notice?: string
  initializationFailed?: boolean
}
const pending = (state: PendingMutationView['state']) => ['preparing', 'submitting', 'accepted', 'dispatching'].includes(state)
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const stop = () => { clearTimeout(timer); reject(signal.reason) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, ms)
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
})
const orderedInput = (value: unknown): unknown => Array.isArray(value) ? value.map(orderedInput)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, orderedInput(item)])) : value

export function mutationReviewFields(review: MutationReview): Array<{ label: string; current: unknown; proposed: unknown }> {
  const envelope = review.before
  const before = envelope !== null && typeof envelope === 'object' && 'source' in envelope ? envelope.source : envelope
  if (before === null || typeof before !== 'object') return []
  if (review.operation === 'updateMilestone') {
    const milestones = milestoneSchema.array().safeParse('milestones' in before ? before.milestones : undefined)
    const milestone = milestones.success ? milestones.data.find((item) => item.id === review.input['milestoneId']) : undefined
    const update = milestoneUpdateSchema.safeParse(review.input['update'])
    if (!milestone || !update.success) return []
    const current: Record<string, unknown> = milestone
    return Object.entries(update.data).map(([field, proposed]) => ({
      label: field.replace(/([A-Z])/g, ' $1'), proposed, current: current[field === 'customerCommitment' ? 'commitment' : field]
    }))
  }
  const opportunity = opportunitySchema.safeParse('opportunity' in before ? before.opportunity : undefined)
  if (!opportunity.success) return []
  if (review.operation === 'transitionOpportunityStage') return [{ label: 'MCEM stage', current: opportunity.data.recordedStage, proposed: review.input['targetStage'] }]
  const update = opportunityUpdateSchema.safeParse(review.input['update'])
  return update.success ? [{ label: 'Comments', current: opportunity.data.comments, proposed: update.data.comments }] : []
}

export class MutationSyncClient {
  private readonly listeners = new Set<() => void>()
  private jobs: PendingMutationView[] = []
  private capabilities: MutationCapabilities | undefined
  private initialization: Promise<void> | undefined
  private snapshot: MutationUiSnapshot = { revision: 0, jobs: [], pending: 0, mode: 'unconfigured' }
  private generation = 0
  private disposed = false
  private lifetime = new AbortController()
  private initializationError: string | undefined

  constructor(private readonly invoke?: MutationInvoker, private readonly options: {
    onConfirmed?(operation: SyncMutationOperation, result: unknown, input: Record<string, unknown>): void
    onRecovered?(): void
    onAccessDenied?(): void
    validateReview?(review: MutationReview): Promise<void> | void
    captureReview?(operation: SyncMutationOperation, input: Record<string, unknown>): ((review: MutationReview) => Promise<void> | void) | undefined
    pollMs?: number
  } = {}) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => this.listeners.delete(listener)
  }
  readonly getSnapshot = (): MutationUiSnapshot => this.snapshot
  hasPending(): boolean { return this.jobs.some((job) => pending(job.state) || job.state === 'effect-unknown') }
  supports(operation: SyncMutationOperation): boolean { return this.capabilities?.available === true && this.capabilities.operations.includes(operation) }

  initialize(): Promise<void> {
    this.assertCurrent(this.generation)
    this.initialization ??= (async () => {
      if (!this.invoke) { this.changed(); return }
      const generation = this.generation
      const response = mutationSyncResponseSchema.parse(await this.invoke({ contractVersion: cacheSyncVersion, operation: 'capabilities' }))
      this.assertCurrent(generation)
      if (response.kind !== 'capabilities') throw new Error('The source returned an invalid synchronization capability response.')
      this.capabilities = response.capabilities
      this.initializationError = undefined
      this.changed()
      if (response.capabilities.available || response.capabilities.recoveryAvailable) {
        const recovered = await this.invoke({ contractVersion: cacheSyncVersion, operation: 'pending' })
        this.assertCurrent(generation)
        if (recovered.kind !== 'pending') throw new Error('The pending-write response was invalid.')
        for (const receipt of recovered.receipts) {
          if (this.jobs.some((job) => job.id === receipt.id)) continue
          const job: PendingMutationView = { id: receipt.id, operation: receipt.operation, input: {}, state: receipt.state, receipt }
          this.jobs.push(job)
          if (['accepted', 'dispatching'].includes(receipt.state)) {
            void this.finish(receipt, job, generation).then((complete) => {
              if (['confirmed', 'reconciled-current-state'].includes(complete.state)) this.options.onRecovered?.()
            }).catch((error: unknown) => {
              if (generation === this.generation && !this.disposed) this.failed(job, error)
            })
          }
        }
        this.changed()
      }
    })()
    const initialization = this.initialization
    return initialization.catch((error: unknown) => {
      if (this.initialization === initialization) {
        this.initialization = undefined
        this.initializationError = error instanceof Error ? error.message : 'Synchronization initialization failed.'
        this.changed()
      }
      throw error
    })
  }

  async retryInitialization(): Promise<void> {
    this.initializationError = undefined
    this.initialization = undefined
    await this.initialize()
    this.changed()
  }

  async run<T>(operation: SyncMutationOperation, input: Record<string, unknown>, fallback: () => Promise<T>, parse: (result: unknown) => T): Promise<T> {
    const generation = this.generation
    const validateReview = this.options.captureReview?.(operation, input) ?? this.options.validateReview
    await this.initialize()
    this.assertCurrent(generation)
    this.assertRecordAvailable(input)
    if (!this.supports(operation)) {
      const result = await fallback()
      this.assertCurrent(generation)
      this.options.onConfirmed?.(operation, result, input)
      return result
    }
    const job: PendingMutationView = { id: crypto.randomUUID(), operation, input, state: 'preparing' }
    this.jobs.push(job); this.trim(); this.changed()
    try {
      const response = await this.call({ contractVersion: cacheSyncVersion, operation: 'prepare', mutation: operation, input })
      this.assertCurrent(generation)
      if (response.kind !== 'review') throw new Error('The source did not prepare a mutation review.')
      if (response.review.operation !== operation || JSON.stringify(orderedInput(response.review.input)) !== JSON.stringify(orderedInput(input))) {
        throw new Error('The source review did not match the exact requested change. Nothing was submitted.')
      }
      await validateReview?.(response.review)
      const admitted = await this.admit(response.review, 'Confirmed exact changes in the source editor.', job, generation)
      const receipt = await this.finish(admitted, job, generation)
      this.assertCurrent(generation)
      if (receipt.state === 'failed-before-send') throw new Error(receipt.code === 'capacity'
        ? 'No write was sent. Another change is in progress; wait for it to finish, then review this draft again.'
        : 'No write was sent. Refresh and review current source values before saving again.')
      if (receipt.state !== 'confirmed') throw new Error(receipt.state === 'conflict'
        ? 'The source changed. Your draft was not overwritten; refresh and review current values.'
        : 'The source outcome is unconfirmed. Check synchronization status before repeating this operation.')
      if (receipt.result === undefined) throw new Error('The source acknowledged this save, but its result is no longer in memory. Refresh the affected records; do not repeat the write.')
      const result = parse(receipt.result)
      this.options.onConfirmed?.(operation, result, input)
      return result
    } catch (error) {
      this.assertCurrent(generation)
      this.failed(job, error)
      throw error
    }
  }

  async prepareReviewed(operation: SyncMutationOperation, input: Record<string, unknown>): Promise<MutationReview | undefined> {
    const generation = this.generation
    await this.initialize()
    this.assertCurrent(generation)
    this.assertRecordAvailable(input)
    if (!this.supports(operation)) return undefined
    const response = await this.call({ contractVersion: cacheSyncVersion, operation: 'prepare', mutation: operation, input })
    this.assertCurrent(generation)
    if (response.kind !== 'review') throw new Error('The reviewed source action was unavailable.')
    if (response.review.operation !== operation) throw new Error('The source review returned a different operation.')
    return response.review
  }

  async submitReviewed(review: MutationReview, reason: string): Promise<{ receipt: MutationReceipt; completion: Promise<MutationReceipt> }> {
    const generation = this.generation
    this.assertCurrent(generation)
    this.assertRecordAvailable(review.input)
    const job: PendingMutationView = { id: review.id, operation: review.operation, input: review.input, state: 'submitting' }
    this.jobs = this.jobs.filter((item) => item.id !== review.id || pending(item.state) || item.state === 'effect-unknown')
    if (this.jobs.some((item) => item.id === review.id)) throw new Error('This exact source action is already pending. Check its status instead of repeating it.')
    this.jobs.push(job); this.trim(); this.changed()
    try {
      const receipt = await this.admit(review, reason, job, generation)
      if (receipt.state === 'failed-before-send' || receipt.state === 'conflict') throw new Error(
        receipt.code === 'capacity' ? 'No write was sent. Another change is in progress; review this draft again after it finishes.'
          : 'The source did not accept this exact change. Review current values before saving again.')
      const completion = this.finish(receipt, job, generation).then((complete) => {
        if (complete.state === 'confirmed' && complete.result !== undefined) this.options.onConfirmed?.(review.operation, complete.result, review.input)
        return complete
      }).catch((error: unknown) => {
        if (generation === this.generation && !this.disposed) this.failed(job, error)
        throw error
      })
      return { receipt, completion }
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.failed(job, error)
      throw error
    }
  }

  async reconcile(id: string): Promise<void> {
    const generation = this.generation
    const response = await this.call({ contractVersion: cacheSyncVersion, operation: 'reconcile', id })
    this.assertCurrent(generation)
    if (response.kind !== 'receipt') throw new Error('The reconciliation response was invalid.')
    this.observeReceipt(response.receipt)
    const job = this.jobs.find((item) => item.id === id)
    if (job) { job.state = response.receipt.state; job.receipt = response.receipt }
    if (['confirmed', 'reconciled-current-state'].includes(response.receipt.state)) this.options.onRecovered?.()
    this.changed()
  }

  async reviewCurrent(id: string): Promise<void> {
    const generation = this.generation
    const job = this.jobs.find((item) => item.id === id)
    if (!job || !['failed-before-send', 'conflict'].includes(job.state)
      || !['updateOpportunity', 'updateMilestone', 'transitionOpportunityStage'].includes(job.operation)) {
      throw new Error('Resolve the original source outcome before preparing a replacement change.')
    }
    const response = await this.call({ contractVersion: cacheSyncVersion, operation: 'prepare', mutation: job.operation, input: job.input })
    this.assertCurrent(generation)
    if (response.kind !== 'review') throw new Error('The source did not return a fresh review.')
    job.review = response.review
    this.changed()
  }

  dismiss(id: string): void {
    const job = this.jobs.find((item) => item.id === id)
    if (job && (pending(job.state) || job.state === 'effect-unknown')) throw new Error('Pending or uncertain source effects cannot be discarded.')
    this.jobs = this.jobs.filter((item) => item.id !== id)
    this.changed()
  }

  reset(): void {
    this.generation++
    this.lifetime.abort(new DOMException('The source session changed.', 'AbortError'))
    this.lifetime = new AbortController()
    this.jobs = []; this.capabilities = undefined; this.initialization = undefined; this.initializationError = undefined; this.changed()
  }

  dispose(): void { this.disposed = true; this.reset(); this.listeners.clear() }

  pendingForRecord(id: string): boolean {
    return this.jobs.some((job) => pending(job.state) && (job.input['opportunityId'] === id || job.input['milestoneId'] === id || job.input['accountId'] === id))
  }
  pendingMembershipForRecord(id: string): boolean {
    return this.jobs.some((job) => (pending(job.state) || job.state === 'effect-unknown')
      && ['joinDealTeam', 'leaveDealTeam', 'joinMilestoneTeam', 'leaveMilestoneTeam'].includes(job.operation)
      && (job.input['opportunityId'] === id || job.input['milestoneId'] === id))
  }
  projectOpportunity<T extends Opportunity>(record: T): T {
    let value = record
    for (const job of this.jobs.filter((item) => pending(item.state) && item.operation === 'updateOpportunity' && item.input['opportunityId'] === record.id)) {
      const update = opportunityUpdateSchema.safeParse(job.input['update'])
      if (update.success) value = { ...value, ...update.data }
    }
    return value
  }
  projectDiscovery<T extends DiscoverableOpportunity>(record: T): T {
    let value = this.projectOpportunity(record)
    for (const job of this.jobs.filter((item) => pending(item.state) && item.input['opportunityId'] === record.id)) {
      if (job.operation === 'joinDealTeam' || job.operation === 'leaveDealTeam') value = { ...value, onDealTeam: job.operation === 'joinDealTeam' }
    }
    return value
  }
  projectMilestone<T extends Milestone>(record: T): T {
    let value = record
    for (const job of this.jobs.filter((item) => pending(item.state) && item.input['milestoneId'] === record.id)) {
      if (job.operation === 'updateMilestone') {
        const update = milestoneUpdateSchema.safeParse(job.input['update'])
        if (update.success) {
          const { customerCommitment, ...fields } = update.data
          value = { ...value, ...fields, ...(customerCommitment ? { commitment: customerCommitment } : {}) }
        }
      }
      if (job.operation === 'joinMilestoneTeam' || job.operation === 'leaveMilestoneTeam') value = { ...value, onMilestoneTeam: job.operation === 'joinMilestoneTeam' }
    }
    return value
  }

  private async admit(review: MutationReview, reason: string, job: PendingMutationView, generation: number): Promise<MutationReceipt> {
    this.assertCurrent(generation)
    job.id = review.id; job.state = 'submitting'; this.changed()
    const response = await this.call({ contractVersion: cacheSyncVersion, operation: 'submit', id: review.id,
      digest: review.digest, confirmed: true, reason })
    this.assertCurrent(generation)
    if (response.kind !== 'receipt') throw new Error('The source did not acknowledge durable admission.')
    this.observeReceipt(response.receipt)
    job.receipt = response.receipt; job.state = response.receipt.state; this.changed()
    return response.receipt
  }

  private async finish(receipt: MutationReceipt, job: PendingMutationView, generation: number): Promise<MutationReceipt> {
    const deadline = Date.now() + 125_000
    let polls = 0
    this.assertCurrent(generation)
    while (['accepted', 'dispatching'].includes(receipt.state)) {
      if (Date.now() >= deadline) { job.state = 'effect-unknown'; this.changed(); throw new Error('The write outcome requires reconciliation; do not repeat it.') }
      await sleep(this.options.pollMs ?? Math.min(5000, 1000 * 2 ** polls++), this.lifetime.signal)
      this.assertCurrent(generation)
      const response = await this.call({ contractVersion: cacheSyncVersion, operation: 'status', id: receipt.id })
      this.assertCurrent(generation)
      if (response.kind !== 'receipt') throw new Error('The source status response was invalid.')
      this.observeReceipt(response.receipt)
      receipt = response.receipt
      if (job.state !== receipt.state || job.receipt?.code !== receipt.code) {
        job.receipt = receipt; job.state = receipt.state; this.changed()
      }
    }
    this.assertCurrent(generation)
    return receipt
  }
  private failed(job: PendingMutationView, error: unknown): void {
    job.error = error instanceof Error ? error.message : 'Source synchronization failed.'
    if (job.state === 'preparing') job.state = 'failed-before-send'
    else if (pending(job.state)) job.state = 'effect-unknown'
    this.changed()
  }
  private observeReceipt(receipt: MutationReceipt): void {
    if (receipt.code && ['access-denied', 'auth-required', 'session-changed'].includes(receipt.code)) this.options.onAccessDenied?.()
  }
  private assertRecordAvailable(input: Record<string, unknown>): void {
    const keys = ['accountId', 'opportunityId', 'milestoneId'].flatMap((field) => {
      const id = input[field]
      return typeof id === 'string' ? [`${field.replace('Id', '')}:${id}`] : []
    })
    if (this.jobs.some((job) => (pending(job.state) || job.state === 'effect-unknown')
      && keys.some((key) => job.receipt?.recordKeys.includes(key)
        || ['accountId', 'opportunityId', 'milestoneId'].some((field) => typeof job.input[field] === 'string' && `${field.replace('Id', '')}:${String(job.input[field])}` === key)))) {
      throw new Error('This record has a pending or uncertain source change. Check its original receipt before another write.')
    }
  }
  private async call(request: MutationSyncRequest): Promise<MutationSyncResponse> {
    if (!this.invoke) throw new Error('Background source synchronization is unavailable.')
    return mutationSyncResponseSchema.parse(await this.invoke(request))
  }
  private assertCurrent(generation: number): void {
    if (this.disposed || generation !== this.generation) throw new DOMException('The source session changed. Check receipts after reconnecting.', 'AbortError')
  }
  private trim(): void {
    const terminal = this.jobs.filter((job) => !pending(job.state) && job.state !== 'effect-unknown')
    while (this.jobs.length > 100 && terminal.length) {
      const oldest = terminal.shift()
      this.jobs = this.jobs.filter((job) => job !== oldest)
    }
  }
  private changed(): void {
    this.snapshot = {
      revision: this.snapshot.revision + 1, jobs: this.jobs.map((job) => ({ ...job })), pending: this.jobs.filter((job) => pending(job.state)).length,
      mode: this.capabilities?.available ? 'background' : this.invoke ? 'acknowledged' : 'unconfigured',
      ...(this.initializationError ? { notice: this.initializationError, initializationFailed: true }
        : this.capabilities?.reason ? { notice: this.capabilities.reason } : {})
    }
    for (const listener of this.listeners) listener()
  }
}
