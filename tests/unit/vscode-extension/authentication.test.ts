import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn()
}))

vi.mock('vscode', () => ({
  authentication: { getSession }
}))

import { acquireDelegatedToken, createVsCodeTokenCredential } from '../../../apps/vscode-extension/src/authentication.js'

function createToken(expiresOnSeconds: number): string {
  return [
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ exp: expiresOnSeconds })).toString('base64url'),
    'signature'
  ].join('.')
}

describe('VS Code delegated authentication', () => {
  beforeEach(() => {
    getSession.mockReset()
  })

  it('acquires resource tokens through the built-in Microsoft provider', async () => {
    getSession.mockResolvedValue({
      accessToken: 'msx-token',
      account: { label: 'seller@microsoft.com' }
    })

    await expect(acquireDelegatedToken('https://microsoftsales.crm.dynamics.com/', true)).resolves.toEqual({
      token: 'msx-token',
      account: 'seller@microsoft.com'
    })
    expect(getSession).toHaveBeenCalledWith(
      'microsoft',
      ['https://microsoftsales.crm.dynamics.com/.default'],
      { createIfNone: true }
    )
  })

  it('targets the configured Foundry tenant without invoking Azure CLI', async () => {
    const expiresOnSeconds = Math.floor(Date.now() / 1000) + 3_600
    const accessToken = createToken(expiresOnSeconds)
    getSession.mockResolvedValue({
      accessToken,
      account: { label: 'seller@microsoft.com' }
    })

    const credential = createVsCodeTokenCredential('173eb3fc-9ba1-437f-99a1-89d5e53b91d1')
    await expect(credential.getToken('https://ai.azure.com/.default')).resolves.toEqual({
      token: accessToken,
      expiresOnTimestamp: expiresOnSeconds * 1000
    })
    expect(getSession).toHaveBeenCalledWith(
      'microsoft',
      [
        'VSCODE_TENANT:173eb3fc-9ba1-437f-99a1-89d5e53b91d1',
        'https://ai.azure.com/.default'
      ],
      { createIfNone: true }
    )
  })
})
