import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../packages/connectors/msx/live.js'

const sourceUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const entraUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
function fixture(mapping: Record<string, unknown>, whoAmI = sourceUserId) {
  const transport = vi.fn<typeof fetch>(async (input) => {
    if (String(input).endsWith('/WhoAmI')) return Response.json({ UserId: whoAmI })
    return Response.json(mapping)
  })
  return { msx: new LiveMsxConnector({ getAccessToken: async () => 'native-private-token' }, transport), transport }
}
describe('own native Dataverse identity mapping', () => {
  it('maps WhoAmI systemuser to the verified Entra oid without assuming equality', async () => {
    const { msx, transport } = fixture({ azureactivedirectoryobjectid: entraUserId, isdisabled: false })
    await expect(msx.assertNativeIdentity(entraUserId)).resolves.toBe(sourceUserId)
    expect(String(transport.mock.calls[1]?.[0])).toContain(`systemusers(${sourceUserId})`)
    expect(new URL(String(transport.mock.calls[1]?.[0])).searchParams.get('$select')).toBe('azureactivedirectoryobjectid,isdisabled')
  })
  it.each([
    { azureactivedirectoryobjectid: sourceUserId, isdisabled: false },
    { azureactivedirectoryobjectid: entraUserId, isdisabled: true },
    { azureactivedirectoryobjectid: entraUserId },
    {}
  ])('fails closed on an absent, disabled or mismatched source identity: %j', async (mapping) => {
    await expect(fixture(mapping).msx.assertNativeIdentity(entraUserId)).rejects.toThrow(/identity/i)
  })
  it('does not place a malformed WhoAmI id into another source query', async () => {
    const { msx, transport } = fixture({}, 'malformed)/accounts')
    await expect(msx.assertNativeIdentity(entraUserId)).rejects.toThrow(/identity/i)
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
