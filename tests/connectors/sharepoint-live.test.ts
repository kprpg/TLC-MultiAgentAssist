import { describe, expect, it, vi } from 'vitest'
import { GraphMcemAccessProbe } from '../../packages/connectors/sharepoint/index.js'

describe('GraphMcemAccessProbe', () => {
  it('resolves the canonical MCEM site and home-page metadata with delegated access', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('secret-token')
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-token' })
      if (url.pathname.endsWith('/sites/microsoft.sharepoint.com:/teams/MCEM-Portal')) {
        return json({ id: 'tenant.sharepoint.com,site-collection,site' })
      }
      if (url.pathname.includes('/pages/microsoft.graph.sitePage')) {
        expect(url.searchParams.get('$select')).toBe('id,name,title,webUrl,lastModifiedDateTime')
        return json({ value: [{
          id: 'page-id',
          name: 'MCEM-Home-Page.aspx',
          title: 'MCEM Home Page',
          webUrl: 'https://microsoft.sharepoint.com/teams/MCEM-Portal/SitePages/MCEM-Home-Page.aspx',
          lastModifiedDateTime: '2026-08-24T12:00:00Z'
        }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const probe = new GraphMcemAccessProbe({ getAccessToken }, request as typeof fetch)

    await expect(probe.getCanonicalPageMetadata()).resolves.toMatchObject({
      siteId: 'tenant.sharepoint.com,site-collection,site',
      pageId: 'page-id',
      name: 'MCEM-Home-Page.aspx'
    })
    expect(request.mock.calls.every(([input]) => !String(input).includes('secret-token'))).toBe(true)
  })

  it('maps a denied Graph response without exposing response content or the bearer token', async () => {
    const probe = new GraphMcemAccessProbe(
      { getAccessToken: vi.fn().mockResolvedValue('secret-token') },
      vi.fn().mockResolvedValue(new Response('{"error":{"message":"secret server detail"}}', {
        status: 403,
        headers: { 'request-id': 'request-id' }
      })) as typeof fetch
    )

    await expect(probe.getCanonicalPageMetadata()).rejects.toThrow(
      'Microsoft Graph MCEM metadata request failed (403; request-id request-id).'
    )
  })
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}