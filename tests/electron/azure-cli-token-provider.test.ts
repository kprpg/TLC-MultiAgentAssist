import { describe, expect, it, vi } from 'vitest'
import { AzureCliMsxTokenProvider } from '../../apps/desktop/electron/main/azure-cli-token-provider.js'

describe('AzureCliMsxTokenProvider', () => {
  it('derives the logged-in Microsoft CORP ID from the MSX token', async () => {
    const token = createToken({ preferred_username: 'signed-in-user@microsoft.com' })
    const credential = {
      getToken: vi.fn().mockResolvedValue({ token, expiresOnTimestamp: Date.now() + 60 * 60 * 1000 })
    }
    const provider = new AzureCliMsxTokenProvider(credential)

    await expect(provider.getAccessToken()).resolves.toBe(token)
    await expect(provider.getAuthStatus()).resolves.toMatchObject({
      state: 'ready',
      displayName: 'signed-in-user@microsoft.com'
    })
    expect(credential.getToken).toHaveBeenCalledWith('https://microsoftsales.crm.dynamics.com/.default')
    expect(credential.getToken).toHaveBeenCalledTimes(1)
  })

  it('rejects a token that is not for a Microsoft corporate identity', async () => {
    const token = createToken({ preferred_username: 'personal@example.com' })
    const provider = new AzureCliMsxTokenProvider({
      getToken: vi.fn().mockResolvedValue({ token, expiresOnTimestamp: Date.now() + 60 * 60 * 1000 })
    })

    await expect(provider.getAccessToken()).rejects.toThrow('@microsoft.com CORP ID')
    await expect(provider.getAuthStatus()).resolves.toMatchObject({ state: 'tenant-mismatch' })
  })
})

function createToken(claims: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(claims)}.signature`
}
