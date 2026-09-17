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

    it('never invokes an unregistered operation from arbitrary input', async () => {
        const response = await routeBridgeMessage(provider, { hostile: true, id: 'r5' })
        expect(response).toMatchObject({ ok: false, id: 'r5' })
    })
})
