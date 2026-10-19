import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalBrowserConnection } from '../../../apps/teams/src/client/local-connection.js'
import { localConnectionVersion } from '../../../packages/common/contracts/local-connection.js'
import { TeamsApiClient } from '../../../apps/teams/src/client/data-client.js'
import { z } from 'zod'

afterEach(() => { vi.unstubAllGlobals() })
const pending = () => ({
  contractVersion: localConnectionVersion, requestId: randomUUID(), userCode: 'ABCDEF12',
  expiresAt: new Date(Date.now() + 300_000).toISOString(), state: 'pending-owner-approval'
})
describe('native browser connection with no source credentials or live calls', () => {
  it('creates a verifier challenge and retains only a memory-local opaque API capability', async () => {
    const source = pending()
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(source))
      .mockResolvedValueOnce(Response.json({ contractVersion: localConnectionVersion, state: 'pending-owner-approval', expiresAt: source.expiresAt }))
      .mockResolvedValueOnce(Response.json({ contractVersion: localConnectionVersion, state: 'paired', token: 'L'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() }))
    vi.stubGlobal('fetch', transport)
    const local = new LocalBrowserConnection()
    await expect(local.getToken()).rejects.toThrow(/pair/i)
    expect(await local.begin()).toMatchObject({ userCode: source.userCode })
    expect(await local.poll()).toBe(false)
    expect(await local.poll()).toBe(true)
    expect(await local.getToken()).toBe('L'.repeat(43))
    expect(transport.mock.calls.map(([input]) => input)).toEqual(['/api/teams/local/requests', '/api/teams/local/exchange', '/api/teams/local/exchange'])
    const start = String(transport.mock.calls[0]?.[1]?.body)
    expect(start).toContain('challenge')
    expect(start).not.toContain('verifier')
    expect(transport.mock.calls.every(([, options]) => options?.credentials === 'omit')).toBe(true)
    local.clear()
    await expect(local.getToken()).rejects.toThrow(/pair/i)
  })
  it('does not accept a downstream JWT, forged fields or expired local capability', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(pending()))
      .mockResolvedValueOnce(Response.json({ contractVersion: localConnectionVersion, state: 'paired', token: 'msx.access.token', expiresAt: new Date(Date.now() + 60_000).toISOString() }))
    vi.stubGlobal('fetch', transport)
    const local = new LocalBrowserConnection()
    await local.begin()
    await expect(local.poll()).rejects.toThrow()
    await expect(local.getToken()).rejects.toThrow(/pair/i)
  })
  it('discards a late exchange after disconnect rather than restoring private access', async () => {
    let complete: ((value: Response) => void) | undefined
    const response = new Promise<Response>((resolve) => { complete = resolve })
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(pending())).mockReturnValueOnce(response)
    vi.stubGlobal('fetch', transport)
    const local = new LocalBrowserConnection()
    await local.begin()
    const exchange = local.poll()
    local.clear()
    complete?.(Response.json({ contractVersion: localConnectionVersion, state: 'paired', token: 'L'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() }))
    await expect(exchange).rejects.toThrow(/changed/i)
    await expect(local.getToken()).rejects.toThrow(/pair/i)
  })
  it('does not release an old private API response into a disconnected/repaired page', async () => {
    let complete: ((value: Response) => void) | undefined
    const response = new Promise<Response>((resolve) => { complete = resolve })
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(pending()))
      .mockResolvedValueOnce(Response.json({ contractVersion: localConnectionVersion, state: 'paired', token: 'L'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() }))
      .mockReturnValueOnce(response)
    vi.stubGlobal('fetch', transport)
    const local = new LocalBrowserConnection()
    await local.begin(); await local.poll()
    const api = new TeamsApiClient(() => local.getToken(), undefined, (token) => local.isCurrentToken(token))
    const result = api.request('private-fixture', z.array(z.string()))
    await Promise.resolve()
    local.clear()
    complete?.(Response.json(['old-private-fixture']))
    await expect(result).rejects.toMatchObject({ code: 'local_connection_changed' })
  })
  it('revokes the page capability over the local API and then forgets it, without disconnecting the owner', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(pending()))
      .mockResolvedValueOnce(Response.json({ contractVersion: localConnectionVersion, state: 'paired', token: 'L'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() }))
      .mockResolvedValueOnce(Response.json({ contractVersion: localConnectionVersion, state: 'disconnected' }))
    vi.stubGlobal('fetch', transport)
    const local = new LocalBrowserConnection()
    await local.begin(); await local.poll(); await local.disconnect()
    expect(transport.mock.calls[2]?.[0]).toBe('/api/teams/local/revoke')
    expect(new Headers(transport.mock.calls[2]?.[1]?.headers).get('authorization')).toBe(`Bearer ${'L'.repeat(43)}`)
    await expect(local.getToken()).rejects.toThrow(/pair/i)
    expect(transport.mock.calls.some(([input]) => String(input).includes('/connect'))).toBe(false)
  })
})
