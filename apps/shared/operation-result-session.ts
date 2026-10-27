import type { MeetingChangeSetProposal } from '../../packages/common/contracts/meeting.js'
import type {
  WorkingSessionPrepareRequest, WorkingSessionResult, WorkingSessionTopicRequest, WorkingSessionTopicResponse
} from '../../packages/common/contracts/working-session.js'

export interface OperationScope { opportunityId: string; milestoneId?: string }
interface OperationInputs {
  'meeting-extract': { opportunityName: string }
  'working-session-topic': WorkingSessionTopicRequest
  'working-session-prepare': WorkingSessionPrepareRequest
}
interface OperationResults {
  'meeting-extract': MeetingChangeSetProposal
  'working-session-topic': WorkingSessionTopicResponse
  'working-session-prepare': WorkingSessionResult
}
export type OperationKind = keyof OperationResults
type Seed<K extends OperationKind> = { kind: K; scope: OperationScope; input: OperationInputs[K] }
type PendingOperation = { [K in OperationKind]: Seed<K> & { requestId: number; status: 'pending' } }[OperationKind]
type CompletedOperation = { [K in OperationKind]: Seed<K> & { requestId: number } & (
  { status: 'succeeded'; result: OperationResults[K] } | { status: 'failed'; error: string }
) }[OperationKind]
export type SessionOperation = PendingOperation | CompletedOperation
const allKinds: readonly OperationKind[] = ['meeting-extract', 'working-session-topic', 'working-session-prepare']
const keyFor = (kind: OperationKind, scope: OperationScope) =>
  JSON.stringify([kind, scope.opportunityId, scope.milestoneId ?? null])

/** Presentation ownership only: dispatches existing calls once, without scheduling, retry or persistence. */
export class OperationResultSession {
  private readonly active = new Map<number, PendingOperation>()
  private readonly completed = new Map<string, CompletedOperation>()
  private readonly latest = new Map<string, number>()
  private readonly listeners = new Set<() => void>()
  private sequence = 0
  private revision = 0
  private generation = 0
  private disposed = false

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  readonly getRevision = (): number => this.revision
  getGeneration(): number { return this.generation }
  activeCount(): number { return this.active.size }
  completedCount(): number { return this.completed.size }

  startMeeting(scope: OperationScope, input: OperationInputs['meeting-extract'], invoke: () => Promise<MeetingChangeSetProposal>): number {
    const seed: Seed<'meeting-extract'> = { kind: 'meeting-extract', scope: structuredClone(scope), input: structuredClone(input) }
    return this.run(
      (requestId) => ({ ...seed, requestId, status: 'pending' }), async () => {
        const result = await invoke()
        if (result.opportunityId !== seed.scope.opportunityId) throw new Error('The meeting result belongs to a different opportunity.')
        return result
      },
      (requestId, result) => ({ ...seed, requestId, status: 'succeeded', result })
    )
  }

  startTopic(input: WorkingSessionTopicRequest, invoke: () => Promise<WorkingSessionTopicResponse>): number {
    const seed: Seed<'working-session-topic'> = {
      kind: 'working-session-topic',
      scope: { opportunityId: input.opportunityId, ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}) },
      input: structuredClone(input)
    }
    return this.run(
      (requestId) => ({ ...seed, requestId, status: 'pending' }), invoke,
      (requestId, result) => ({ ...seed, requestId, status: 'succeeded', result })
    )
  }

  startPreparation(scope: OperationScope, input: WorkingSessionPrepareRequest, invoke: () => Promise<WorkingSessionResult>): number {
    if (scope.opportunityId !== input.opportunityId) throw new Error('The preparation scope targets a different opportunity.')
    const seed: Seed<'working-session-prepare'> = {
      kind: 'working-session-prepare', scope: structuredClone(scope), input: structuredClone(input)
    }
    return this.run(
      (requestId) => ({ ...seed, requestId, status: 'pending' }), invoke,
      (requestId, result) => ({ ...seed, requestId, status: 'succeeded', result })
    )
  }

  getLatest(scope: OperationScope, kinds: readonly OperationKind[] = allKinds): SessionOperation | undefined {
    return this.findLatest((entry) => kinds.includes(entry.kind) && keyFor(entry.kind, entry.scope) === keyFor(entry.kind, scope))
  }

  getLatestForOpportunity(opportunityId: string, kinds: readonly OperationKind[]): SessionOperation | undefined {
    return this.findLatest((entry) => entry.scope.opportunityId === opportunityId && kinds.includes(entry.kind))
  }

  touch(requestId: number): void {
    for (const [key, entry] of this.completed) {
      if (entry.requestId !== requestId) continue
      this.completed.delete(key)
      this.completed.set(key, entry)
      return
    }
  }

  consume(requestId: number): void {
    for (const [key, entry] of this.completed) {
      if (entry.requestId !== requestId) continue
      this.completed.delete(key)
      this.cleanupKey(key)
      this.changed()
      return
    }
  }

  clear(): void {
    this.generation++
    this.active.clear()
    this.completed.clear()
    this.latest.clear()
    this.changed()
  }

  dispose(): void {
    this.clear()
    this.disposed = true
    this.listeners.clear()
  }

  private run<T>(
    pending: (requestId: number) => PendingOperation,
    invoke: () => Promise<T>,
    success: (requestId: number, result: T) => CompletedOperation
  ): number {
    if (this.disposed) throw new Error('The operation session is closed. Reload before starting more work.')
    const requestId = ++this.sequence
    const entry = pending(requestId)
    const generation = this.generation
    this.active.set(requestId, entry)
    this.latest.set(keyFor(entry.kind, entry.scope), requestId)
    this.changed()
    void Promise.resolve().then(() => {
      if (this.disposed || generation !== this.generation) throw new DOMException('The source session changed before dispatch.', 'AbortError')
      return invoke()
    }).then(
      (result) => this.finish(success(requestId, result), generation),
      (error: unknown) => this.finish({
        ...entry, status: 'failed', error: error instanceof Error ? error.message || 'The operation failed.' : String(error)
      }, generation)
    )
    return requestId
  }

  private finish(entry: CompletedOperation, generation: number): void {
    if (this.disposed || generation !== this.generation) return
    this.active.delete(entry.requestId)
    const key = keyFor(entry.kind, entry.scope)
    if (this.latest.get(key) === entry.requestId) {
      this.completed.delete(key)
      this.completed.set(key, entry)
      while (this.completed.size > 20) {
        for (const oldest of this.completed.keys()) {
          this.completed.delete(oldest)
          this.cleanupKey(oldest)
          break
        }
      }
    }
    this.cleanupKey(key)
    this.changed()
  }

  private findLatest(matches: (entry: SessionOperation) => boolean): SessionOperation | undefined {
    let result: SessionOperation | undefined
    for (const entry of [...this.active.values(), ...this.completed.values()]) {
      if (!matches(entry) || this.latest.get(keyFor(entry.kind, entry.scope)) !== entry.requestId) continue
      if (!result || entry.requestId > result.requestId) result = entry
    }
    return result
  }

  private cleanupKey(key: string): void {
    if (!this.completed.has(key) && ![...this.active.values()].some((entry) => keyFor(entry.kind, entry.scope) === key)) this.latest.delete(key)
  }

  private changed(): void {
    this.revision++
    for (const listener of this.listeners) listener()
  }
}
