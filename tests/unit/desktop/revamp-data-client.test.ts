import { describe, expect, it, vi } from 'vitest'
import { createWebApiClient } from '../../../apps/desktop/renderer-revamp/src/data-client.js'
import { contractVersion } from '../../../packages/common/index.js'

describe('revamp live web data client', () => {
    it('downloads the rich email draft returned by the web host', async () => {
        const click = vi.fn()
        const anchor = { href: '', download: '', click }
        const createObjectURL = vi.fn(() => 'blob:email-draft')
        const revokeObjectURL = vi.fn()
        vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('MIME-Version: 1.0', {
            status: 200,
            headers: { 'content-type': 'message/rfc822', 'x-tlc-file-name': 'Account guidance.eml' }
        }))

        await expect(createWebApiClient(fetcher).openEmailCompose({
            contractVersion,
            recipients: ['seller@example.com'],
            subject: 'Account guidance',
            responseTitle: 'Account Pulse',
            responseMarkdown: '## Guidance'
        })).resolves.toEqual({ state: 'opened' })

        expect(anchor.download).toBe('Account guidance.eml')
        expect(click).toHaveBeenCalledOnce()
        expect(createObjectURL).toHaveBeenCalledOnce()
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:email-draft')
        vi.unstubAllGlobals()
    })

    it('retrieves the authenticated email used to pre-populate email recipients', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
            JSON.stringify({ email: 'signed-in-user@microsoft.com' }),
            { status: 200, headers: { 'content-type': 'application/json' } }
        ))

        await expect(createWebApiClient(fetcher).getCurrentUserEmail()).resolves.toBe('signed-in-user@microsoft.com')
        expect(fetcher).toHaveBeenCalledWith('/api/me', expect.objectContaining({ credentials: 'same-origin' }))
    })

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

    it('retrieves and validates milestones from the authenticated web API', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{
            id: 'milestone-1', opportunityId: 'opportunity-1', name: 'Customer pilot', status: 'On track'
        }]), { status: 200, headers: { 'content-type': 'application/json' } }))

        await expect(createWebApiClient(fetcher).listMilestones('opportunity/one')).resolves.toEqual([
            { id: 'milestone-1', opportunityId: 'opportunity-1', name: 'Customer pilot', status: 'On track' }
        ])
        expect(fetcher).toHaveBeenCalledWith('/api/opportunities/opportunity%2Fone/milestones', expect.any(Object))
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

    it('dispatches the selected prompt without replacing it with generic guidance', async () => {
        const response = {
            contractVersion,
            correlationId: '4df83249-8309-46a7-a78b-0af491ef497f',
            capability: 'account-pulse',
            agentVersion: '1.0.0',
            generatedAt: '2026-04-01T12:00:00.000Z',
            mode: 'live',
            state: 'complete',
            content: 'Grounded response',
            sourceHealth: [{ source: 'msx', state: 'live', detail: 'Ready', checkedAt: '2026-04-01T12:00:00.000Z' }]
        }
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }))

        await createWebApiClient(fetcher).runAgentTask('account-pulse', 'account-1', 'opportunity-1', 'Show milestone drift.')

        expect(fetcher).toHaveBeenCalledWith('/api/agent-task', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ contractVersion, capability: 'account-pulse', accountId: 'account-1', opportunityId: 'opportunity-1', prompt: 'Show milestone drift.' })
        }))
    })
})