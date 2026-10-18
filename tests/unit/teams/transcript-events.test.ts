import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { GraphSubscriptionConnector } from '../../../packages/connectors/graph/subscriptions.js'
import { TranscriptEventService } from '../../../packages/orchestrator/collaboration/transcript-events.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import { CollaborationLifecycle } from '../../../packages/orchestrator/collaboration/lifecycle.js'

const principal: ExecutionPrincipal = { key: 'tenant:user', tenantId: 'tenant', userId: 'user', environmentId: 'env', roles: ['TLC.Teams.User'], mode: 'live' }
const subscriptionId = '66666666-6666-4666-8666-666666666666'
const stores: SqliteDocumentStore[] = []
afterEach(() => { vi.restoreAllMocks(); for (const store of stores.splice(0)) store.close() })
function fixture() {
  const store = new SqliteDocumentStore(); stores.push(store)
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: subscriptionId, expirationDateTime: new Date(Date.now() + 50 * 60_000).toISOString() }))
  const connector = new GraphSubscriptionConnector('https://tlc.example.com', async () => 'delegated-graph-token', transport)
  const available = vi.fn().mockResolvedValue(undefined)
  const events = new TranscriptEventService(store, { tenantId: 'tenant', environmentId: 'env' }, () => connector, available)
  return { store, transport, events, available }
}
const request = { meetingId: 'meeting', opportunityId: 'opp', meetingType: 'internal' as const }

describe('delegated transcript subscription lifecycle', () => {
  it('automatically renews due active subscriptions without a UI request and never resumes a paused generation', async () => {
    const { store, events, transport } = fixture()
    const now = Date.now()
    await events.ensure(principal, request)
    vi.spyOn(Date, 'now').mockReturnValue(now + 46 * 60_000)
    expect(await events.maintain(principal)).toEqual([expect.objectContaining({ state: 'active' })])
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls[1]?.[1]?.method).toBe('PATCH')
    await events.maintain(principal)
    expect(transport).toHaveBeenCalledTimes(2)
    await new CollaborationLifecycle(store).set(principal, 'pause')
    await events.maintain(principal)
    await new CollaborationLifecycle(store).set(principal, 'resume')
    await events.maintain(principal)
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('stops callbacks, renewal and queued acquisition on pause; resume does not replay stale hints', async () => {
    const { store, events, transport, available } = fixture()
    await events.ensure(principal, request)
    const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body)) as { clientState: string }
    const event = { subscriptionId, clientState: body.clientState, resourceData: { id: 'old-transcript' } }
    await events.receive({ value: [event] })
    const lifecycle = new CollaborationLifecycle(store)
    await lifecycle.set(principal, 'pause')
    await expect(events.ensure(principal, request)).rejects.toMatchObject({ code: 'collaboration_paused' })
    await events.receive({ value: [{ ...event, resourceData: { id: 'late-transcript' } }] })
    await events.drain(principal)
    expect(available).not.toHaveBeenCalled()
    await lifecycle.set(principal, 'resume')
    await events.drain(principal)
    expect(available).not.toHaveBeenCalled()
    await events.ensure(principal, request)
    expect(transport).toHaveBeenCalledTimes(2)
    await events.receive({ value: [{ ...event, resourceData: { id: 'new-transcript' } }] })
    await events.drain(principal)
    expect(available).toHaveBeenCalledTimes(1)
  })
  it('creates one bounded per-meeting subscription and authenticates/deduplicates notifications before processing', async () => {
    const { events, transport, available } = fixture()
    expect((await events.ensure(principal, request)).state).toBe('active')
    await events.ensure(principal, request)
    expect(transport).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body)) as { clientState: string; resource: string; notificationUrl: string }
    expect(body.resource).toBe('communications/onlineMeetings/meeting/transcripts')
    expect(body.notificationUrl).toBe('https://tlc.example.com/api/teams/graph/notifications')
    const event = { subscriptionId, clientState: body.clientState, resourceData: { id: 'transcript' } }
    await expect(events.receive({ value: [{ ...event, clientState: 'forged' }] })).rejects.toThrow(/notification/i)
    await events.receive({ value: [event, event] })
    expect(available).not.toHaveBeenCalled()
    await events.drain(principal)
    await events.drain(principal)
    expect(available).toHaveBeenCalledTimes(1)
  })
  it('retains an unknown create outcome and never blindly repeats the external subscription write', async () => {
    const { events, transport } = fixture()
    transport.mockRejectedValue(new Error('Create response lost'))
    expect((await events.ensure(principal, request)).state).toBe('unconfirmed')
    expect((await events.ensure(principal, request)).state).toBe('unconfirmed')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('keeps another principal from draining owner events', async () => {
    const { events, transport, available } = fixture()
    await events.ensure(principal, request)
    const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body)) as { clientState: string }
    await events.receive({ value: [{ subscriptionId, clientState: body.clientState, resourceData: { id: 't' } }] })
    await events.drain({ ...principal, userId: 'other', key: 'tenant:other' })
    expect(available).not.toHaveBeenCalled()
  })
})
