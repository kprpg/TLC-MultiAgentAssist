import { describe, expect, it, vi } from 'vitest'
import { createSampleSellerDashboard } from '../../../packages/common/fixtures/seller-dashboard.js'
import { SellerDashboardSourceError } from '../../../packages/connectors/common/seller-dashboard.js'
import { createSellerDashboardHost, SharedSellerDashboardHost } from '../../../packages/orchestrator/seller-dashboard.js'

describe('Shared Seller Dashboard host', () => {
    it('uses one offline sample snapshot and never resolves a live identity', async () => {
        const resolveUserEmail = vi.fn()
        const host = createSellerDashboardHost({ mode: 'sample', resolveUserEmail })
        const get = await host.invoke({ contractVersion: '1.0', operation: 'get' })
        const refresh = await host.invoke({ contractVersion: '1.0', operation: 'refresh', confirmed: true })
        expect(get).toEqual(refresh)
        expect(get).toMatchObject({ kind: 'snapshot', mode: 'sample' })
        expect(resolveUserEmail).not.toHaveBeenCalled()
    })

    it('rejects invalid or unconfirmed operations before any source call', async () => {
        const read = vi.fn().mockResolvedValue(createSampleSellerDashboard())
        const refresh = vi.fn().mockResolvedValue(createSampleSellerDashboard())
        const host = new SharedSellerDashboardHost({ read, refresh })
        await expect(host.invoke({ contractVersion: '1.0', operation: 'refresh' })).rejects.toThrow()
        await expect(host.invoke({ contractVersion: '2.0', operation: 'get' })).rejects.toThrow()
        expect(read).not.toHaveBeenCalled()
        expect(refresh).not.toHaveBeenCalled()
    })

    it('returns explicit unavailable source health instead of a success-shaped sample fallback', async () => {
        const denied = vi.fn().mockRejectedValue(new SellerDashboardSourceError('identity-mismatch', 'No private data was read.'))
        const host = new SharedSellerDashboardHost({ read: denied, refresh: denied })
        expect(await host.invoke({ contractVersion: '1.0', operation: 'get' })).toEqual({
            contractVersion: '1.0', kind: 'unavailable', mode: 'live', code: 'identity-mismatch', message: 'No private data was read.'
        })
    })

    it('denies a server-user profile in hosted multi-user Web before resolving local identity', async () => {
        const resolveUserEmail = vi.fn()
        const host = createSellerDashboardHost({ mode: 'live', allowLocalProfile: false, resolveUserEmail })
        expect(await host.invoke({ contractVersion: '1.0', operation: 'get' })).toMatchObject({
            kind: 'unavailable', mode: 'live', code: 'hosted-profile-denied'
        })
        expect(resolveUserEmail).not.toHaveBeenCalled()
    })

    it('does not hide implementation errors as absent source data', async () => {
        const unexpected = vi.fn().mockRejectedValue(new TypeError('Implementation defect'))
        const host = new SharedSellerDashboardHost({ read: unexpected, refresh: unexpected })
        await expect(host.invoke({ contractVersion: '1.0', operation: 'get' })).rejects.toThrow('Implementation defect')
    })
})
