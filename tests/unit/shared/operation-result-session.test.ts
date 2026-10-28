import { describe, expect, it, vi } from 'vitest'
import type { MeetingChangeSetProposal } from '../../../packages/common/contracts/meeting.js'
import type { WorkingSessionTopicRequest, WorkingSessionTopicResponse } from '../../../packages/common/contracts/working-session.js'
import { OperationResultSession } from '../../../apps/shared/operation-result-session.js'

const meetingKinds = ['meeting-extract'] as const
const scope = (opportunityId: string, milestoneId?: string) => ({
  opportunityId, ...(milestoneId ? { milestoneId } : {})
})
const proposal = (opportunityId = 'a', changeSetId = 'proposal-a'): MeetingChangeSetProposal => ({
  changeSetId, opportunityId, transcriptId: 'sanitized-transcript', meetingType: 'customer',
  slots: [], newMilestones: [], suggestedMilestoneIds: [], unmappedSignals: [],
  proposedAt: '2026-10-26T12:00:00.000Z'
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const request: WorkingSessionTopicRequest = {
  contractVersion: '1.0', opportunityId: 'a', opportunityName: 'Sanitized opportunity',
  milestoneId: 'm', milestoneName: 'Sanitized milestone'
}
const topicResponse: WorkingSessionTopicResponse = {
  contractVersion: '1.0', mode: 'sample',
  topic: {
    topic: 'Azure Arc', domain: 'Hybrid', azureServices: ['Azure Arc'], deckQueries: ['Arc'], learnQueries: ['Arc'],
    iacScenario: 'Arc POC', confidence: 'high', basis: 'rules', evidence: ['Sanitized title']
  }
}

describe('UI-session operation results', () => {
  it('owns pending work independently of view subscriptions and retains its result', async () => {
    const session = new OperationResultSession()
    const pending = deferred<MeetingChangeSetProposal>()
    const listener = vi.fn()
    const unsubscribe = session.subscribe(listener)
    const id = session.startMeeting(scope('a'), { opportunityName: 'A' }, () => pending.promise)
    expect(session.getLatest(scope('a'), meetingKinds)).toMatchObject({ requestId: id, status: 'pending' })
    unsubscribe()
    pending.resolve(proposal())
    await vi.waitFor(() => expect(session.getLatest(scope('a'), meetingKinds)).toMatchObject({
      status: 'succeeded', result: { changeSetId: 'proposal-a' }
    }))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('isolates opportunity, milestone and operation kind without blocking other scopes', async () => {
    const session = new OperationResultSession()
    const held = deferred<MeetingChangeSetProposal>()
    session.startMeeting(scope('a'), { opportunityName: 'A' }, () => held.promise)
    session.startMeeting(scope('b'), { opportunityName: 'B' }, async () => proposal('b'))
    session.startTopic(request, async () => topicResponse)
    await vi.waitFor(() => expect(session.completedCount()).toBe(2))
    expect(session.getLatest(scope('a'), meetingKinds)?.status).toBe('pending')
    expect(session.getLatest(scope('b'), meetingKinds)?.status).toBe('succeeded')
    expect(session.getLatest(scope('a', 'other'), ['working-session-topic'])).toBeUndefined()
    expect(session.getLatest(scope('a', 'm'), ['working-session-topic'])?.status).toBe('succeeded')
    held.resolve(proposal())
  })

  it('keeps the newer request authoritative when older work completes last', async () => {
    const session = new OperationResultSession()
    const older = deferred<MeetingChangeSetProposal>()
    session.startMeeting(scope('a'), { opportunityName: 'A' }, () => older.promise)
    const newer = session.startMeeting(scope('a'), { opportunityName: 'A' }, async () => proposal('a', 'newer'))
    await vi.waitFor(() => expect(session.getLatest(scope('a'), meetingKinds)?.status).toBe('succeeded'))
    older.resolve(proposal('a', 'older'))
    await vi.waitFor(() => expect(session.activeCount()).toBe(0))
    expect(session.getLatest(scope('a'), meetingKinds)).toMatchObject({
      requestId: newer, result: { changeSetId: 'newer' }
    })
    expect(session.completedCount()).toBe(1)
  })

  it('retains explicit failures without leaking them into another scope or rejecting an unobserved Promise', async () => {
    const session = new OperationResultSession()
    session.startMeeting(scope('a'), { opportunityName: 'A' }, async () => { throw new Error('Extraction unavailable') })
    await vi.waitFor(() => expect(session.getLatest(scope('a'), meetingKinds)).toMatchObject({
      status: 'failed', error: 'Extraction unavailable'
    }))
    expect(session.getLatest(scope('b'), meetingKinds)).toBeUndefined()
    expect(session.activeCount()).toBe(0)
  })

  it('retains exactly twenty completed entries and evicts the least recently used entry', async () => {
    const session = new OperationResultSession()
    const ids = Array.from({ length: 20 }, (_, index) =>
      session.startMeeting(scope(`o-${index}`), { opportunityName: 'Sanitized' }, async () => proposal(`o-${index}`)))
    await vi.waitFor(() => expect(session.completedCount()).toBe(20))
    session.touch(ids[0]!)
    session.startMeeting(scope('o-20'), { opportunityName: 'Sanitized' }, async () => proposal('o-20'))
    await vi.waitFor(() => expect(session.activeCount()).toBe(0))
    expect(session.completedCount()).toBe(20)
    expect(session.getLatest(scope('o-0'), meetingKinds)).toBeDefined()
    expect(session.getLatest(scope('o-1'), meetingKinds)).toBeUndefined()
    expect(session.getLatest(scope('o-20'), meetingKinds)).toBeDefined()
  })

  it('does not evict active operations or impose a new active-operation limit', async () => {
    const session = new OperationResultSession()
    const held = Array.from({ length: 25 }, () => deferred<MeetingChangeSetProposal>())
    held.forEach((value, index) => session.startMeeting(scope(`held-${index}`), { opportunityName: 'Sanitized' }, () => value.promise))
    for (let index = 0; index < 21; index++) {
      session.startMeeting(scope(`done-${index}`), { opportunityName: 'Sanitized' }, async () => proposal(`done-${index}`))
    }
    await vi.waitFor(() => expect(session.completedCount()).toBe(20))
    expect(session.activeCount()).toBe(25)
    expect(session.getLatest(scope('held-0'), meetingKinds)?.status).toBe('pending')
    held.forEach((value, index) => value.resolve(proposal(`held-${index}`)))
    await vi.waitFor(() => expect(session.activeCount()).toBe(0))
    expect(session.completedCount()).toBe(20)
  })

  it('does not count repeated reads or reopening as new operations', async () => {
    const session = new OperationResultSession()
    const invoke = vi.fn(async () => proposal())
    const id = session.startMeeting(scope('a'), { opportunityName: 'A' }, invoke)
    await vi.waitFor(() => expect(session.getLatest(scope('a'), meetingKinds)?.status).toBe('succeeded'))
    for (let index = 0; index < 10; index++) {
      session.getLatest(scope('a'), meetingKinds)
      session.touch(id)
    }
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('captures immutable request settings for preparation restoration', async () => {
    const session = new OperationResultSession()
    const input = {
      contractVersion: '1.0' as const, opportunityId: 'a', opportunityName: 'A', milestoneName: 'M',
      topic: structuredClone(topicResponse.topic), deliverables: { decks: false, learn: true, iac: true }
    }
    session.startPreparation(scope('a', 'm'), input, async () => ({
      contractVersion: '1.0', mode: 'sample', folderName: 'A - M',
      delivery: { kind: 'folder', folderPath: 'C:\\Synthetic\\A - M' }, files: [], gaps: [], summary: 'Prepared 0 file(s).'
    }))
    input.topic.topic = 'Changed after dispatch'
    input.deliverables.iac = false
    await vi.waitFor(() => expect(session.activeCount()).toBe(0))
    const entry = session.getLatest(scope('a', 'm'), ['working-session-prepare'])
    expect(entry).toMatchObject({ input: { topic: { topic: 'Azure Arc' }, deliverables: { iac: true } } })
  })

  it('clears private results and prevents late completion from repopulating a reset session', async () => {
    const session = new OperationResultSession()
    const pending = deferred<MeetingChangeSetProposal>()
    session.startMeeting(scope('a'), { opportunityName: 'A' }, () => pending.promise)
    const generation = session.getGeneration()
    session.clear()
    expect(session.getGeneration()).toBeGreaterThan(generation)
    pending.resolve(proposal())
    await Promise.resolve()
    await Promise.resolve()
    expect(session.getLatest(scope('a'), meetingKinds)).toBeUndefined()
    expect(session.activeCount()).toBe(0)
    expect(session.completedCount()).toBe(0)
  })

  it('does not let pre-reset failures overwrite a new session result', async () => {
    const session = new OperationResultSession()
    const older = deferred<MeetingChangeSetProposal>()
    session.startMeeting(scope('a'), { opportunityName: 'A' }, () => older.promise)
    await Promise.resolve()
    session.clear()
    session.startMeeting(scope('a'), { opportunityName: 'New session' }, async () => proposal('a', 'new-session'))
    older.reject(new Error('Old identity failed'))
    await vi.waitFor(() => expect(session.getLatest(scope('a'), meetingKinds)).toMatchObject({
      status: 'succeeded', result: { changeSetId: 'new-session' }
    }))
  })

  it('does not dispatch queued work after a private-session reset', async () => {
    const session = new OperationResultSession()
    const invoke = vi.fn(async () => proposal())
    session.startMeeting(scope('a'), { opportunityName: 'A' }, invoke)
    session.clear()
    await Promise.resolve()
    await Promise.resolve()
    expect(invoke).not.toHaveBeenCalled()
    expect(session.activeCount()).toBe(0)
    expect(session.completedCount()).toBe(0)
  })

  it('rejects a meeting result belonging to another opportunity', async () => {
    const session = new OperationResultSession()
    session.startMeeting(scope('a'), { opportunityName: 'A' }, async () => proposal('b'))
    await vi.waitFor(() => expect(session.getLatest(scope('a'), meetingKinds)).toMatchObject({
      status: 'failed', error: expect.stringMatching(/opportunity|scope/i)
    }))
    expect(session.getLatest(scope('b'), meetingKinds)).toBeUndefined()
  })

  it('rejects mismatched preparation scope before dispatch', () => {
    const session = new OperationResultSession()
    const invoke = vi.fn()
    expect(() => session.startPreparation(scope('b', 'm'), {
      contractVersion: '1.0', opportunityId: 'a', opportunityName: 'A', milestoneName: 'M',
      topic: topicResponse.topic, deliverables: { decks: false, learn: true, iac: true }
    }, invoke)).toThrow(/opportunity|scope/i)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('consumes a submitted proposal without allowing older work to revive it', async () => {
    const session = new OperationResultSession()
    const older = deferred<MeetingChangeSetProposal>()
    session.startMeeting(scope('a'), { opportunityName: 'A' }, () => older.promise)
    const submitted = session.startMeeting(scope('a'), { opportunityName: 'A' }, async () => proposal('a', 'submitted'))
    await vi.waitFor(() => expect(session.getLatest(scope('a'), meetingKinds)?.status).toBe('succeeded'))
    session.consume(submitted)
    older.resolve(proposal('a', 'obsolete'))
    await vi.waitFor(() => expect(session.activeCount()).toBe(0))
    expect(session.getLatest(scope('a'), meetingKinds)).toBeUndefined()
    expect(session.completedCount()).toBe(0)
  })

  it('does not consume another request or scope when an old review is dismissed', async () => {
    const session = new OperationResultSession()
    const old = session.startMeeting(scope('a'), { opportunityName: 'A' }, async () => proposal())
    await vi.waitFor(() => expect(session.activeCount()).toBe(0))
    const current = session.startMeeting(scope('a'), { opportunityName: 'A' }, async () => proposal('a', 'current'))
    await vi.waitFor(() => expect(session.activeCount()).toBe(0))
    session.consume(old)
    expect(session.getLatest(scope('a'), meetingKinds)?.requestId).toBe(current)
  })

  it('disposes private state and refuses new work without dispatching it', () => {
    const session = new OperationResultSession()
    session.dispose()
    const invoke = vi.fn(async () => proposal())
    expect(() => session.startMeeting(scope('a'), { opportunityName: 'A' }, invoke)).toThrow(/closed|disposed/i)
    expect(invoke).not.toHaveBeenCalled()
    expect(session.completedCount()).toBe(0)
  })
})
