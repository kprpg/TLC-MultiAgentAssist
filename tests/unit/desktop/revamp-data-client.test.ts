import { describe, expect, it, vi } from 'vitest'
import { createWebApiClient } from '../../../apps/desktop/renderer-revamp/src/data-client.js'

describe('revamp live web data client', () => {
    it('uses the same-origin account API and validates its response', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
            { id: 'account-1', name: 'Account One', segment: 'Enterprise' }
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))

        const result = await createWebApiClient(fetcher).listAccounts()

        expect(result).toEqual([{ id: 'account-1', name: 'Account One', segment: 'Enterprise' }])
        expect(fetcher).toHaveBeenCalledWith('/api/accounts', expect.objectContaining({ credentials: 'same-origin' }))
    })

    it('encodes account identifiers and surfaces sanitized API errors', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
            JSON.stringify({ error: 'MSX access is not authorized.' }),
            { status: 403, headers: { 'content-type': 'application/json' } }
        ))

        await expect(createWebApiClient(fetcher).listOpportunities('account/one'))
            .rejects.toThrow('MSX access is not authorized.')
        expect(fetcher).toHaveBeenCalledWith('/api/accounts/account%2Fone/opportunities', expect.any(Object))
    })

    it('requests a same-origin application exit from the web host', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
            JSON.stringify({ state: 'exiting' }),
            { status: 202, headers: { 'content-type': 'application/json' } }
        ))

        await createWebApiClient(fetcher).exitApplication()

        expect(fetcher).toHaveBeenCalledWith('/api/exit', expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin'
        }))
    })
})