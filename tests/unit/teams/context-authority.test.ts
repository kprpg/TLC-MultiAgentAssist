import { describe, expect, it, vi } from 'vitest'
import { GraphContextAuthority } from '../../../packages/connectors/teams/context-authority.js'

const principal = { tenantId: 'tenant', userId: 'user', environmentId: 'env' }
const policy = {
  contractVersion: '1.0', revision: 'approved-v1', expiresAt: '2099-01-01T00:00:00.000Z',
  contexts: [{
    kind: 'channel', contextId: 'channel', teamId: 'team',
    eligibleFteIds: ['user', 'colleague'], configurerIds: ['user'], publisherIds: ['user']
  }]
}
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

describe('authoritative context membership and FTE disclosure', () => {
  it('uses allMembers rather than only direct membership, with app-only metadata permission', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ value: [
      { userId: 'user', tenantId: 'tenant' }, { userId: 'colleague', tenantId: 'tenant' }
    ] }))
    const authority = new GraphContextAuthority(policy, async () => 'context-metadata-token', fetcher)
    expect(await authority.verify(principal, { kind: 'channel', contextId: 'channel' })).toEqual({
      revision: 'approved-v1', canConfigure: true, canPublish: true, audienceEligible: true
    })
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://graph.microsoft.com/v1.0/teams/team/channels/channel/allMembers')
  })
  it('allows only the calling member and rejects unknown, expired, external or incomplete audiences', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({ value: [
      { userId: 'user', tenantId: 'tenant' }, { userId: 'guest', tenantId: 'external' }
    ] }))
    const authority = new GraphContextAuthority(policy, async () => 'token', fetcher)
    expect((await authority.verify(principal, { kind: 'channel', contextId: 'channel' })).audienceEligible).toBe(false)
    await expect(authority.verify({ ...principal, userId: 'outsider' }, { kind: 'channel', contextId: 'channel' })).rejects.toThrow(/member/i)
    await expect(authority.verify(principal, { kind: 'channel', contextId: 'unapproved' })).rejects.toThrow(/policy/i)
    const expired = new GraphContextAuthority({ ...policy, expiresAt: '2000-01-01T00:00:00.000Z' }, async () => 'token', fetcher)
    await expect(expired.verify(principal, { kind: 'channel', contextId: 'channel' })).rejects.toThrow(/expired/i)
  })
  it('never sends a metadata token to an untrusted continuation URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({
      value: [{ userId: 'user', tenantId: 'tenant' }], '@odata.nextLink': 'https://evil.example.com/members'
    }))
    await expect(new GraphContextAuthority(policy, async () => 'token', fetcher).verify(principal, { kind: 'channel', contextId: 'channel' })).rejects.toThrow(/continuation/i)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
