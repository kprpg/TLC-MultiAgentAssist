import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticationSession } from 'vscode'

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn()
}))

vi.mock('vscode', () => ({
  authentication: { getSession }
}))

import { acquireDelegatedToken, createDelegatedTokenProvider, createVsCodeTokenCredential } from '../../../apps/vscode-extension/src/authentication.js'

const resource = 'https://microsoftsales.crm.dynamics.com'
const session: AuthenticationSession = {
  id: 'test-session',
  accessToken: 'msx-token',
  account: { id: 'seller-account', label: 'seller@microsoft.com' },
  scopes: [`${resource}/.default`]
}

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
    getSession.mockResolvedValue(session)

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

  it('never opens interactive sign-in for silent resource requests', async () => {
    getSession.mockResolvedValue(session)
    await expect(acquireDelegatedToken(resource, false)).resolves.toEqual({
      token: session.accessToken, account: session.account.label
    })
    expect(getSession).toHaveBeenCalledWith('microsoft', [`${resource}/.default`], { silent: true })
  })

  it('coalesces concurrent sign-in requests and permits an explicit retry after cancellation', async () => {
    let cancel!: (error: Error) => void
    getSession.mockReturnValueOnce(new Promise<AuthenticationSession>((_resolve, reject) => { cancel = reject }))
    const first = acquireDelegatedToken(resource, true)
    const second = acquireDelegatedToken(`${resource}/`, true)
    const cancelled = Promise.allSettled([first, second])
    expect(getSession).toHaveBeenCalledOnce()
    cancel(new Error('User cancelled sign-in.'))
    expect(await cancelled).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ message: 'User cancelled sign-in.' }) },
      { status: 'rejected', reason: expect.objectContaining({ message: 'User cancelled sign-in.' }) }
    ])

    getSession.mockResolvedValue(session)
    await expect(acquireDelegatedToken(resource, true)).resolves.toHaveProperty('token', session.accessToken)
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('does not share an interactive request with a silent request', async () => {
    getSession.mockResolvedValue(session)
    await Promise.all([acquireDelegatedToken(resource, true), acquireDelegatedToken(resource, false)])
    expect(getSession).toHaveBeenCalledTimes(2)
    expect(getSession).toHaveBeenLastCalledWith('microsoft', [`${resource}/.default`], { silent: true })
  })

  it('silently renews live tokens for the originally selected account', async () => {
    getSession.mockResolvedValueOnce(session)
    const provider = await createDelegatedTokenProvider(resource)
    expect(provider.account).toBe(session.account.label)
    getSession.mockResolvedValue({ ...session, accessToken: 'renewed-msx-token' })
    await expect(provider.getToken()).resolves.toBe('renewed-msx-token')
    expect(getSession).toHaveBeenLastCalledWith('microsoft', [`${resource}/.default`], {
      silent: true, account: session.account
    })
  })

  it('requires explicit reconnection instead of reopening sign-in when the live session is missing', async () => {
    getSession.mockResolvedValueOnce(session).mockResolvedValue(undefined)
    const provider = await createDelegatedTokenProvider(resource)
    await expect(provider.getToken()).rejects.toThrow('TLC: Use Live Data')
    await expect(provider.getToken()).rejects.toThrow('TLC: Use Live Data')
    expect(getSession.mock.calls.slice(1).map((call) => call[2])).toEqual([
      { silent: true, account: session.account }, { silent: true, account: session.account }
    ])
    expect(getSession.mock.calls.filter((call) => call[2].createIfNone)).toHaveLength(1)
  })

  it('rejects another account even when its display label matches', async () => {
    getSession.mockResolvedValueOnce(session).mockResolvedValue({
      ...session, account: { ...session.account, id: 'another-account' }
    })
    const provider = await createDelegatedTokenProvider(resource)
    await expect(provider.getToken()).rejects.toThrow('The Microsoft account changed.')
  })

  it('does not retain access tokens after a completed request', async () => {
    getSession.mockResolvedValueOnce(session).mockResolvedValueOnce({ ...session, accessToken: 'fresh-token' })
    await expect(acquireDelegatedToken(resource, true)).resolves.toHaveProperty('token', 'msx-token')
    await expect(acquireDelegatedToken(resource, true)).resolves.toHaveProperty('token', 'fresh-token')
    expect(getSession).toHaveBeenCalledTimes(2)
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

  it('coalesces Foundry authentication without combining different tenants or resources', async () => {
    getSession.mockResolvedValue(session)
    const credential = createVsCodeTokenCredential('foundry-tenant')
    const otherTenant = createVsCodeTokenCredential('other-tenant')
    await Promise.all([
      credential.getToken('https://ai.azure.com/.default'),
      credential.getToken(['https://ai.azure.com/.default']),
      otherTenant.getToken('https://ai.azure.com/.default'),
      credential.getToken('https://cognitiveservices.azure.com/.default')
    ])
    expect(getSession).toHaveBeenCalledTimes(3)
  })
})
