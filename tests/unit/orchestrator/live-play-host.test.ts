import { describe, expect, it, vi } from 'vitest'
import { createDealTeamScopeResolver, LIVE_PLAY_ROW_LIMIT } from '../../../packages/orchestrator/workflows/index.js'

describe('live play workflow host', () => {
    it('reads enough rows for a play beyond the per-call Dataverse read_query cap', () => {
        expect(LIVE_PLAY_ROW_LIMIT).toBeGreaterThan(20)
    })

    it('scopes reads to the signed-in user without enumerating the portfolio', async () => {
        const resolveCurrentUserId = vi.fn().mockResolvedValue('8a496494-f17e-e511-80e1-3863bb35ce00')
        const resolve = createDealTeamScopeResolver(resolveCurrentUserId)

        expect(await resolve()).toEqual({
            currentUserId: '8a496494-f17e-e511-80e1-3863bb35ce00',
            delegatedUserAccountIds: [],
            delegatedUserOpportunityIds: []
        })
    })

    it('resolves the signed-in user id once across repeated play runs', async () => {
        const resolveCurrentUserId = vi.fn().mockResolvedValue('user-1')
        const resolve = createDealTeamScopeResolver(resolveCurrentUserId)

        await Promise.all([resolve(), resolve()])
        await resolve()

        expect(resolveCurrentUserId).toHaveBeenCalledTimes(1)
    })

    it('retries identity resolution after a failure', async () => {
        const resolveCurrentUserId = vi.fn()
            .mockRejectedValueOnce(new Error('token expired'))
            .mockResolvedValue('user-2')
        const resolve = createDealTeamScopeResolver(resolveCurrentUserId)

        await expect(resolve()).rejects.toThrow('token expired')
        expect((await resolve()).currentUserId).toBe('user-2')
    })
})
