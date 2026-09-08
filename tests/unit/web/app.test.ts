import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { contractVersion } from '../../../packages/common/index.js'

const authenticationHeaders = {
    'x-ms-client-principal': 'encoded-principal',
    'x-ms-client-principal-name': 'signed-in-user@microsoft.com',
    'x-ms-token-aad-access-token': 'delegated-msx-token'
}

describe('hosted web API', () => {
    let server: Server | undefined

    afterEach(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
        server = undefined
    })

    it('requires App Service Authentication headers before creating a user runtime', async () => {
        const createRuntime = vi.fn(() => runtime())
        const baseUrl = await listen(buildWebApiHandler({ createRuntime }))

        const response = await fetch(`${baseUrl}/api/accounts`)

        expect(response.status).toBe(401)
        expect(await response.json()).toMatchObject({ error: 'Sign in with Microsoft Entra ID to access live data.' })
        expect(createRuntime).not.toHaveBeenCalled()
    })

    it('creates an isolated runtime with the delegated MSX token and validates account output', async () => {
        const createRuntime = vi.fn(() => runtime())
        const baseUrl = await listen(buildWebApiHandler({ createRuntime }))

        const [firstResponse, secondResponse] = await Promise.all([
            fetch(`${baseUrl}/api/accounts`, { headers: authenticationHeaders }),
            fetch(`${baseUrl}/api/accounts`, { headers: authenticationHeaders })
        ])

        expect(firstResponse.status).toBe(200)
        expect(secondResponse.status).toBe(200)
        expect(await firstResponse.json()).toEqual([{ id: 'account-1', name: 'Contoso', segment: 'Live MSX' }])
        expect(createRuntime).toHaveBeenCalledTimes(2)
        expect(createRuntime).toHaveBeenNthCalledWith(1, {
            accessToken: 'delegated-msx-token',
            clientPrincipal: 'encoded-principal',
            userEmail: 'signed-in-user@microsoft.com'
        })
    })

    it('returns the authenticated user email without creating a data runtime', async () => {
        const createRuntime = vi.fn(() => runtime())
        const baseUrl = await listen(buildWebApiHandler({ createRuntime }))

        const response = await fetch(`${baseUrl}/api/me`, { headers: authenticationHeaders })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ email: 'signed-in-user@microsoft.com' })
        expect(createRuntime).not.toHaveBeenCalled()
    })

    it('uses host-provided local authentication without trusting request headers', async () => {
        const authenticate = vi.fn(async () => ({
            accessToken: 'local-azure-cli-token',
            clientPrincipal: 'signed-in-user@microsoft.com',
            userEmail: 'signed-in-user@microsoft.com'
        }))
        const createRuntime = vi.fn(() => runtime())
        const baseUrl = await listen(buildWebApiHandler({ authenticate, createRuntime }))

        const response = await fetch(`${baseUrl}/api/accounts`, {
            headers: {
                'x-ms-client-principal': 'spoofed-principal',
                'x-ms-token-aad-access-token': 'spoofed-token'
            }
        })

        expect(response.status).toBe(200)
        expect(authenticate).toHaveBeenCalledTimes(1)
        expect(createRuntime).toHaveBeenCalledWith({
            accessToken: 'local-azure-cli-token',
            clientPrincipal: 'signed-in-user@microsoft.com',
            userEmail: 'signed-in-user@microsoft.com'
        })
    })

    it('acknowledges a same-origin local exit before invoking host shutdown', async () => {
        const shutdown = vi.fn()
        const baseUrl = await listen(buildWebApiHandler({ createRuntime: () => runtime(), shutdown }))

        const response = await fetch(`${baseUrl}/api/exit`, {
            method: 'POST',
            headers: { 'sec-fetch-site': 'same-origin' }
        })

        expect(response.status).toBe(202)
        expect(await response.json()).toEqual({ state: 'exiting' })
        await vi.waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1))
    })

    it('rejects cross-origin exit requests', async () => {
        const shutdown = vi.fn()
        const baseUrl = await listen(buildWebApiHandler({ createRuntime: () => runtime(), shutdown }))

        const response = await fetch(`${baseUrl}/api/exit`, {
            method: 'POST',
            headers: { 'sec-fetch-site': 'cross-site' }
        })

        expect(response.status).toBe(403)
        expect(shutdown).not.toHaveBeenCalled()
    })

    it('does not expose application exit without a local shutdown callback', async () => {
        const baseUrl = await listen(buildWebApiHandler({ createRuntime: () => runtime() }))

        const response = await fetch(`${baseUrl}/api/exit`, {
            method: 'POST',
            headers: { ...authenticationHeaders, 'sec-fetch-site': 'same-origin' }
        })

        expect(response.status).toBe(404)
    })

    it('returns validated milestones for an authenticated web opportunity', async () => {
        const webRuntime = runtime()
        vi.mocked(webRuntime.listMilestones).mockResolvedValue([{
            id: 'milestone-1', opportunityId: 'opportunity-1', name: 'Customer pilot', status: 'On track'
        }])
        const baseUrl = await listen(buildWebApiHandler({ createRuntime: () => webRuntime }))

        const response = await fetch(`${baseUrl}/api/opportunities/opportunity-1/milestones`, { headers: authenticationHeaders })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([{
            id: 'milestone-1', opportunityId: 'opportunity-1', name: 'Customer pilot', status: 'On track'
        }])
        expect(webRuntime.listMilestones).toHaveBeenCalledWith('opportunity-1')
    })

    it('validates and forwards partial MSX updates', async () => {
        const webRuntime = runtime()
        vi.mocked(webRuntime.updateMilestone).mockResolvedValue({
            id: 'milestone-1', opportunityId: 'opportunity-1', name: 'Customer pilot', status: 'At Risk'
        })
        vi.mocked(webRuntime.updateOpportunity).mockResolvedValue({
            id: 'opportunity-1', accountId: 'account-1', name: 'Pilot', recordedStage: 2, value: 100, currency: 'USD', closeDate: '2026-10-01', comments: 'Customer confirmed.'
        })
        const baseUrl = await listen(buildWebApiHandler({ createRuntime: () => webRuntime }))
        const headers = { ...authenticationHeaders, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }

        const milestoneResponse = await fetch(`${baseUrl}/api/opportunities/opportunity-1/milestones/milestone-1`, {
            method: 'PATCH', headers, body: JSON.stringify({ status: 'At Risk' })
        })
        const opportunityResponse = await fetch(`${baseUrl}/api/opportunities/opportunity-1`, {
            method: 'PATCH', headers, body: JSON.stringify({ comments: 'Customer confirmed.' })
        })

        expect(milestoneResponse.status).toBe(200)
        expect(opportunityResponse.status).toBe(200)
        expect(webRuntime.updateMilestone).toHaveBeenCalledWith('opportunity-1', 'milestone-1', { status: 'At Risk' })
        expect(webRuntime.updateOpportunity).toHaveBeenCalledWith('opportunity-1', { comments: 'Customer confirmed.' })
    })

    it('rejects an empty milestone update before invoking the runtime', async () => {
        const webRuntime = runtime()
        const baseUrl = await listen(buildWebApiHandler({ createRuntime: () => webRuntime }))
        const response = await fetch(`${baseUrl}/api/opportunities/opportunity-1/milestones/milestone-1`, {
            method: 'PATCH',
            headers: { ...authenticationHeaders, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
            body: '{}'
        })

        expect(response.status).toBe(400)
        expect(webRuntime.updateMilestone).not.toHaveBeenCalled()
    })

    it('rejects malformed contract requests without invoking the orchestrator', async () => {
        const webRuntime = runtime()
        const baseUrl = await listen(buildWebApiHandler({ createRuntime: () => webRuntime }))

        const response = await fetch(`${baseUrl}/api/mcem-coach`, {
            method: 'POST',
            headers: { ...authenticationHeaders, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
            body: JSON.stringify({ accountId: 'account-1' })
        })

        expect(response.status).toBe(400)
        expect(webRuntime.runMcemCoach).not.toHaveBeenCalled()
        expect(response.headers.get('x-correlation-id')).toMatch(/[0-9a-f-]{36}/)
    })

    it('sanitizes unexpected runtime errors', async () => {
        const webRuntime = runtime()
        vi.mocked(webRuntime.listAccounts).mockRejectedValue(new Error('secret downstream detail'))
        const baseUrl = await listen(buildWebApiHandler({ createRuntime: () => webRuntime }))

        const response = await fetch(`${baseUrl}/api/accounts`, { headers: authenticationHeaders })

        expect(response.status).toBe(500)
        const body = await response.text()
        expect(JSON.parse(body)).toMatchObject({ error: 'The server could not complete the request.' })
        expect(body).not.toContain('secret downstream detail')
    })

    it('downloads a rich unsent email draft without sending the response', async () => {
        const createRuntime = vi.fn(() => runtime())
        const baseUrl = await listen(buildWebApiHandler({ createRuntime }))

        const response = await fetch(`${baseUrl}/api/open-email-compose`, {
            method: 'POST',
            headers: { ...authenticationHeaders, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
            body: JSON.stringify({
                contractVersion,
                recipients: ['seller@example.com'],
                subject: 'Account guidance',
                responseTitle: 'Account Pulse',
                responseMarkdown: '## Next step\n\n**Owner:** Confirm owner\n\n[Open opportunity](https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=opp-1)'
            })
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('message/rfc822; charset=utf-8')
        expect(response.headers.get('x-tlc-file-name')).toBe('Account guidance.eml')
        const draft = await response.text()
        expect(draft).toContain('X-Unsent: 1')
        expect(draft).toContain('Content-Type: text/html; charset="UTF-8"')
        const encodedHtml = Buffer.from(draft.split('Content-Type: text/html; charset="UTF-8"')[1]!.split('\r\n\r\n')[1]!.split('\r\n------tlc-agent-response-boundary--')[0]!.replaceAll('\r\n', ''), 'base64').toString('utf8')
        expect(encodedHtml).toContain('<h2>Next step</h2>')
        expect(encodedHtml).toContain('<strong>Owner:</strong>')
        expect(encodedHtml).toContain('<a href="https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&amp;etn=opportunity&amp;id=opp-1">Open opportunity</a>')
        expect(createRuntime).not.toHaveBeenCalled()
    })

    it('exports the Markdown response as an authenticated Word document', async () => {
        const createRuntime = vi.fn(() => runtime())
        const baseUrl = await listen(buildWebApiHandler({ createRuntime }))

        const response = await fetch(`${baseUrl}/api/export-agent-response`, {
            method: 'POST',
            headers: { ...authenticationHeaders, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
            body: JSON.stringify({
                contractVersion,
                responseTitle: 'Account Pulse: Contoso?',
                responseMarkdown: '# Account Pulse\n\n| Owner | Action |\n| --- | --- |\n| Alex | Confirm |',
                generatedAt: '2026-04-01T12:00:00.000Z'
            })
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        expect(response.headers.get('x-tlc-file-name')).toBe('Account Pulse- Contoso-.docx')
        expect(Buffer.from(await response.arrayBuffer()).subarray(0, 2).toString()).toBe('PK')
        expect(createRuntime).not.toHaveBeenCalled()
    })

    function listen(handler: ReturnType<typeof buildWebApiHandler>): Promise<string> {
        server = createServer((request, response) => void handler(request, response))
        return new Promise((resolve) => {
            server!.listen(0, '127.0.0.1', () => {
                const address = server!.address()
                if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP.')
                resolve(`http://127.0.0.1:${address.port}`)
            })
        })
    }
})

function runtime(): WebRuntime {
    return {
        listAccounts: vi.fn(async () => [{ id: 'account-1', name: 'Contoso', segment: 'Live MSX' }]),
        listOpportunities: vi.fn(async () => []),
        listMilestones: vi.fn(async () => []),
        updateMilestone: vi.fn(),
        updateOpportunity: vi.fn(),
        runMcemCoach: vi.fn(),
        runAgentTask: vi.fn()
    }
}