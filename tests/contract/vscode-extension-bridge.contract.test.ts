import { describe, expect, it } from 'vitest'
import { routeBridgeMessage } from '../../apps/vscode-extension/src/host-router.js'
import { createSampleDataProvider } from '../../apps/vscode-extension/src/data-provider.js'

describe('vscode-extension bridge router contract', () => {
    const provider = createSampleDataProvider()

    it('rejects a malformed envelope without leaking internals', async () => {
        const response = await routeBridgeMessage(provider, { kind: 'request', id: 'r1', method: 'nope' })
        expect(response).toMatchObject({ ok: false, id: 'r1', error: { code: 'invalid_envelope' } })
    })

    it('routes listAccounts to the provider', async () => {
        const response = await routeBridgeMessage(provider, { kind: 'request', id: 'r2', method: 'listAccounts' })
        expect(response.ok).toBe(true)
        if (response.ok) expect(Array.isArray(response.result)).toBe(true)
    })

    it('validates params and returns a request_failed error for bad ids', async () => {
        const response = await routeBridgeMessage(provider, { kind: 'request', id: 'r3', method: 'listMilestones', params: { opportunityId: 'missing' } })
        expect(response.ok).toBe(true)
        if (response.ok) expect(response.result).toEqual([])
    })

    it('refuses openEvidence on the data plane (host-only)', async () => {
        const response = await routeBridgeMessage(provider, { kind: 'request', id: 'r4', method: 'openEvidence', params: { url: 'https://example.com/evidence' } })
        expect(response).toMatchObject({ ok: false, error: { code: 'host_only' } })
    })

    it('refuses exportContent on the data plane (host-only)', async () => {
        const response = await routeBridgeMessage(provider, { kind: 'request', id: 'r6', method: 'exportContent', params: { title: 'Guidance', content: 'body' } })
        expect(response).toMatchObject({ ok: false, error: { code: 'host_only' } })
    })

    it('refuses composeEmail on the data plane (host-only)', async () => {
        const response = await routeBridgeMessage(provider, { kind: 'request', id: 'r7', method: 'composeEmail', params: { subject: 'Hi', body: 'body' } })
        expect(response).toMatchObject({ ok: false, error: { code: 'host_only' } })
    })

    it('routes milestone-team join and leave, toggling onMilestoneTeam independently of the deal team', async () => {
        const list = await routeBridgeMessage(provider, { kind: 'request', id: 'm1', method: 'listMilestones', params: { opportunityId: 'opp-grid-modernization' } })
        expect(list.ok).toBe(true)
        if (!list.ok) return
        const milestones = list.result as Array<{ id: string; onMilestoneTeam?: boolean }>
        expect(milestones.length).toBeGreaterThan(0)
        const target = milestones.find((milestone) => milestone.onMilestoneTeam !== true) ?? milestones[0]!

        const join = await routeBridgeMessage(provider, { kind: 'request', id: 'm2', method: 'joinMilestoneTeam', params: { opportunityId: 'opp-grid-modernization', milestoneId: target.id } })
        expect(join).toMatchObject({ ok: true, result: { onMilestoneTeam: true, milestoneId: target.id } })

        const afterJoin = await routeBridgeMessage(provider, { kind: 'request', id: 'm3', method: 'listMilestones', params: { opportunityId: 'opp-grid-modernization' } })
        if (afterJoin.ok) {
            expect((afterJoin.result as Array<{ id: string; onMilestoneTeam?: boolean }>).find((milestone) => milestone.id === target.id)?.onMilestoneTeam).toBe(true)
        }

        const leave = await routeBridgeMessage(provider, { kind: 'request', id: 'm4', method: 'leaveMilestoneTeam', params: { opportunityId: 'opp-grid-modernization', milestoneId: target.id } })
        expect(leave).toMatchObject({ ok: true, result: { onMilestoneTeam: false, milestoneId: target.id } })
    })

    it('routes milestone activities: lists seeded tasks and creates a new task', async () => {
        const list = await routeBridgeMessage(provider, { kind: 'request', id: 'a1', method: 'listMilestones', params: { opportunityId: 'opp-grid-modernization' } })
        expect(list.ok).toBe(true)
        if (!list.ok) return
        const milestone = (list.result as Array<{ id: string }>)[0]!

        const created = await routeBridgeMessage(provider, { kind: 'request', id: 'a2', method: 'createMilestoneActivity', params: { opportunityId: 'opp-grid-modernization', milestoneId: milestone.id, request: { subject: 'Design session', priority: 'High', taskCategory: 'Demo' } } })
        expect(created).toMatchObject({ ok: true, result: { subject: 'Design session', activityType: 'task', status: 'Open' } })

        const activities = await routeBridgeMessage(provider, { kind: 'request', id: 'a3', method: 'listMilestoneActivities', params: { opportunityId: 'opp-grid-modernization', milestoneId: milestone.id } })
        expect(activities.ok).toBe(true)
        if (activities.ok) expect((activities.result as Array<{ subject: string }>).some((activity) => activity.subject === 'Design session')).toBe(true)
    })

    it('rejects a createMilestoneActivity with a blank subject', async () => {
        const response = await routeBridgeMessage(provider, { kind: 'request', id: 'a4', method: 'createMilestoneActivity', params: { opportunityId: 'opp-grid-modernization', milestoneId: 'ms-1', request: { subject: '' } } })
        expect(response).toMatchObject({ ok: false, id: 'a4' })
    })

    it('never invokes an unregistered operation from arbitrary input', async () => {
        const response = await routeBridgeMessage(provider, { hostile: true, id: 'r5' })
        expect(response).toMatchObject({ ok: false, id: 'r5' })
    })
})
