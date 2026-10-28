import { describe, expect, it, vi } from 'vitest'
import { createFoundryOpenAIClient, FoundryPromptAgent } from '../../../packages/connectors/foundry/index.js'
import { withFoundrySignIn } from '../../../apps/vscode-extension/src/foundry-sign-in.js'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('vscode', () => ({ authentication: { getSession } }))
import { createVsCodeTokenCredential } from '../../../apps/vscode-extension/src/authentication.js'

describe('real Foundry SDK authentication callbacks', () => {
  it.each(['account-pulse', 'mcem-coach', 'pursuit-executive', 'risk-solution-play'])('keeps the selected identity across three %s preflight and SDK invocations', async (capability) => {
    const tenantId = '77777777-7777-4777-8777-777777777777'
    const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({
      tid: tenantId, exp: Math.floor(Date.now() / 1000) + 3600
    })).toString('base64url')}.signature`
    const account = { id: 'synthetic-user', label: 'synthetic@example.test' }
    getSession.mockReset().mockResolvedValueOnce(undefined).mockResolvedValue({
      id: 'foundry-session', accessToken: token, account, scopes: ['https://ai.azure.com/.default']
    })
    const credential = createVsCodeTokenCredential(tenantId)
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: 'response-test', object: 'response', created_at: 1, status: 'completed', model: 'synthetic',
      output: [{ id: 'message-test', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'Grounded sample response.', annotations: [] }] }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createFoundryOpenAIClient('https://synthetic.services.ai.azure.com/api/projects/test', credential, { fetch: fetcher, maxRetries: 0 })
    const agent = new FoundryPromptAgent({
      projectEndpoint: 'https://synthetic.services.ai.azure.com/api/projects/test', agentName: capability,
      credential, openAIClient: client, requestTimeoutMs: 1000,
      prepareCredential: async () => { await credential.getToken('https://ai.azure.com/.default') }
    })
    for (let prompt = 0; prompt < 3; prompt++) {
      await expect(withFoundrySignIn(() => agent.invoke({ prompt: `Synthetic prompt ${prompt}` }))).resolves.toBe('Grounded sample response.')
    }
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(getSession.mock.calls.filter((call) => call[2].createIfNone || call[2].forceNewSession)).toHaveLength(1)
    expect(getSession.mock.calls.slice(2).every((call) => call[2].account?.id === account.id)).toBe(true)
    expect(getSession.mock.calls.every((call) => call[1].includes(`VSCODE_TENANT:${tenantId}`))).toBe(true)
  })
})
