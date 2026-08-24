import { describe, expect, it, vi } from 'vitest'
import { InteractiveGraphTokenProvider } from '../../apps/desktop/electron/main/graph-token-provider.js'

describe('InteractiveGraphTokenProvider', () => {
  it('connects explicitly and validates delegated Graph access for the CORP user', async () => {
    const token = createToken({
      aud: '00000003-0000-0000-c000-000000000000',
      scp: 'Sites.Read.All User.Read',
      preferred_username: 'signed-in-user@microsoft.com'
    })
    const credential = {
      authenticate: vi.fn().mockResolvedValue({ username: 'signed-in-user@microsoft.com' }),
      getToken: vi.fn().mockResolvedValue({ token, expiresOnTimestamp: Date.now() + 60 * 60 * 1000 })
    }
    const provider = new InteractiveGraphTokenProvider(credential)

    await expect(provider.connect()).resolves.toMatchObject({
      state: 'ready',
      displayName: 'signed-in-user@microsoft.com'
    })
    expect(credential.authenticate).toHaveBeenCalledWith('https://graph.microsoft.com/Sites.Read.All')
    expect(credential.getToken).toHaveBeenCalledWith('https://graph.microsoft.com/Sites.Read.All')
  })

  it('reports a token missing the delegated permission without assuming a consent failure', async () => {
    const token = createToken({
      aud: '00000003-0000-0000-c000-000000000000',
      scp: 'User.Read',
      preferred_username: 'signed-in-user@microsoft.com'
    })
    const provider = new InteractiveGraphTokenProvider({
      authenticate: vi.fn().mockResolvedValue({}),
      getToken: vi.fn().mockResolvedValue({ token, expiresOnTimestamp: Date.now() + 60 * 60 * 1000 })
    })

    await expect(provider.connect()).resolves.toMatchObject({
      state: 'permission-missing',
      detail: expect.stringContaining('does not contain delegated Sites.Read.All')
    })
  })

  it('reports a documented tenant consent-policy failure with safe diagnostics', async () => {
    const error = Object.assign(new Error('Authentication failed.'), {
      errorResponse: {
        errorCodes: [90094],
        correlationId: 'correlation-id',
        traceId: 'trace-id'
      }
    })
    const provider = new InteractiveGraphTokenProvider({
      authenticate: vi.fn().mockRejectedValue(error),
      getToken: vi.fn()
    })

    await expect(provider.connect()).resolves.toMatchObject({
      state: 'consent-required',
      detail: expect.stringContaining('AADSTS90094; correlation correlation-id; trace trace-id')
    })
  })

  it('does not launch interactive authentication during a status check', async () => {
    const credential = {
      authenticate: vi.fn(),
      getToken: vi.fn().mockRejectedValue(new Error('Authentication required'))
    }
    const provider = new InteractiveGraphTokenProvider(credential)

    await expect(provider.getAuthStatus()).resolves.toMatchObject({ state: 'login-required' })
    expect(credential.authenticate).not.toHaveBeenCalled()
  })
})

function createToken(claims: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(claims)}.signature`
}