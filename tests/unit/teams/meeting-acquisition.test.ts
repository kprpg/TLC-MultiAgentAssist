import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { MeetingAcquisitionService } from '../../../packages/orchestrator/collaboration/meeting-acquisition.js'
import { GraphMeetingError } from '../../../packages/connectors/graph/meetings.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import { CollaborationLifecycle } from '../../../packages/orchestrator/collaboration/lifecycle.js'
import { RequestQuotaError } from '../../../packages/orchestrator/collaboration/request-budget.js'

const user: ExecutionPrincipal = { key: 't:u', tenantId: 't', userId: 'u', environmentId: 'env', roles: ['TLC.Teams.User'], mode: 'sample' }
const stores: SqliteDocumentStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture() {
  const store = new SqliteDocumentStore()
  stores.push(store)
  const getTranscripts = vi.fn().mockResolvedValue({
    state: 'ready', meetingId: 'meeting', attribution: 'unattributed', contentVersions: { transcript: 'version1' },
    transcripts: [{ id: 'transcript', source: 'teams', meetingType: 'internal', opportunityId: 'opp', segments: [{ segmentId: 's1', text: 'Review outcome' }] }]
  })
  const propose = vi.fn().mockResolvedValue({
    changeSetId: 'change', transcriptId: 'transcript', opportunityId: 'opp', meetingType: 'internal',
    slots: [], newMilestones: [], suggestedMilestoneIds: [], unmappedSignals: [], proposedAt: '2026-10-17T20:00:00.000Z'
  })
  const readOpportunity = vi.fn().mockResolvedValue(undefined)
  return { store, getTranscripts, propose, readOpportunity, service: new MeetingAcquisitionService(store, { getTranscripts, propose, readOpportunity }) }
}
const input = { meetingId: 'meeting', opportunityId: 'opp', meetingType: 'internal' }

describe('automatic meeting acquisition orchestration', () => {
  it('lets a deduplicated server notification trigger a fresh bounded pass after foreground polling is exhausted', async () => {
    const { service, getTranscripts } = fixture()
    const ready = getTranscripts.getMockImplementation()
    getTranscripts.mockResolvedValue({ state: 'waiting', meetingId: 'meeting', transcripts: [], attribution: 'unknown', contentVersions: {} })
    for (let attempt = 0; attempt < 10; attempt++) await service.acquire(user, input)
    expect((await service.acquire(user, input)).status.state).toBe('paused')
    if (!ready) throw new Error('The ready transcript fixture implementation is missing.')
    getTranscripts.mockImplementation(ready)
    const result = await service.acquire(user, input, { notificationId: 'verified-owner-hint' })
    expect(result.status.state).toBe('ready')
    expect(result.proposals).toHaveLength(1)
    expect(result.evidenceVersion).toMatch(/^[a-f0-9]{64}$/)
    expect(getTranscripts).toHaveBeenCalledTimes(11)
    getTranscripts.mockResolvedValue({ state: 'waiting', meetingId: 'meeting', transcripts: [], attribution: 'unknown', contentVersions: {} })
    for (let attempt = 0; attempt < 9; attempt++) await service.acquire(user, input)
    expect((await service.acquire(user, input, { notificationId: 'verified-owner-hint' })).status.state).toBe('paused')
    expect(getTranscripts).toHaveBeenCalledTimes(20)
    await expect(service.acquire(user, { ...input, notificationId: 'client-cannot-reset-budget' })).rejects.toThrow()
  })
  it('checks pause/retirement in the shared service before any native read, not just in the HTTP adapter', async () => {
    const { store, service, readOpportunity, getTranscripts } = fixture()
    await new CollaborationLifecycle(store).set(user, 'pause')
    await expect(service.acquire(user, input)).rejects.toMatchObject({ code: 'collaboration_paused' })
    expect(readOpportunity).not.toHaveBeenCalled()
    expect(getTranscripts).not.toHaveBeenCalled()
  })
  it('bounds distinct notification recovery passes at twenty without issuing another Graph/model request', async () => {
    const { service, getTranscripts, propose } = fixture()
    for (let index = 0; index < 20; index++) {
      expect((await service.acquire(user, input, { notificationId: `verified-hint-${index}` })).status.state).toBe('ready')
    }
    expect((await service.acquire(user, input, { notificationId: 'over-budget-hint' })).status.state).toBe('paused')
    expect(getTranscripts).toHaveBeenCalledTimes(20)
    expect(propose).toHaveBeenCalledTimes(20)
  })
  it('shares the live per-user agent budget before extracting a transcript, including callback-triggered acquisition', async () => {
    const { service, propose } = fixture()
    const liveUser = { ...user, mode: 'live' as const }
    for (let index = 0; index < 4; index++) await service.acquire(liveUser, input, { notificationId: `hint-${index}` })
    await expect(service.acquire(liveUser, input, { notificationId: 'over-agent-budget' })).rejects.toBeInstanceOf(RequestQuotaError)
    expect(propose).toHaveBeenCalledTimes(4)
  })
  it('automatically fetches and proposes under native access, without writing business data', async () => {
    const { service, getTranscripts, propose, readOpportunity } = fixture()
    const result = await service.acquire(user, input)
    expect(result.status).toMatchObject({ state: 'ready', attribution: 'unattributed', transcriptIds: ['transcript'] })
    expect(getTranscripts).toHaveBeenCalledTimes(1)
    expect(readOpportunity).toHaveBeenCalledWith(user, 'opp')
    expect(propose).toHaveBeenCalledTimes(1)
    expect(result.proposals).toHaveLength(1)
    expect(await service.review(user, result.status.id)).toHaveLength(1)
    await expect(service.review({ ...user, userId: 'other' }, result.status.id)).rejects.toThrow(/unavailable/i)
  })
  it('suspends for expired authority and respects administrator denial', async () => {
    const { service, getTranscripts, propose } = fixture()
    getTranscripts.mockRejectedValueOnce(new GraphMeetingError('auth-required', 'expired'))
    expect((await service.acquire(user, input)).status.state).toBe('auth-required')
    getTranscripts.mockRejectedValueOnce(new GraphMeetingError('admin-blocked', 'GraphAccessToTranscriptsDisabled'))
    expect((await service.acquire(user, input)).status.state).toBe('admin-blocked')
    expect(propose).not.toHaveBeenCalled()
  })
  it('bounds repeated not-ready discovery and does not reset its budget on a new service instance', async () => {
    const { service, store, getTranscripts, propose, readOpportunity } = fixture()
    getTranscripts.mockResolvedValue({ state: 'waiting', meetingId: 'meeting', transcripts: [], attribution: 'unknown', contentVersions: {} })
    for (let n = 0; n < 10; n++) expect((await service.acquire(user, input)).status.state).toBe('waiting')
    const resumed = new MeetingAcquisitionService(store, { getTranscripts, propose, readOpportunity })
    expect((await resumed.acquire(user, input)).status.state).toBe('paused')
    expect(getTranscripts).toHaveBeenCalledTimes(10)
  })
  it('requires fresh evidence before serving a reviewed draft and rejects a changed transcript', async () => {
    const { service, getTranscripts } = fixture()
    const result = await service.acquire(user, input)
    getTranscripts.mockResolvedValue({ state: 'ready', meetingId: 'meeting', transcripts: [], attribution: 'unattributed', contentVersions: { transcript: 'version2' } })
    await expect(service.review(user, result.status.id)).rejects.toThrow(/changed/i)
  })
})
