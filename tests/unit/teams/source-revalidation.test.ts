import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../../packages/connectors/msx/live.js'
import { MemoryPortfolioPreferenceStore } from '../../../packages/connectors/common/portfolio-preferences.js'

describe('hosted Teams source revalidation', () => {
  it('does not serve a cached portfolio after delegated source access was revoked', async () => {
    let revoked = false
    const transport = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (revoked) return Response.json({ error: { message: 'Denied' } }, { status: 403 })
      const url = String(input)
      if (url.endsWith('WhoAmI')) return Response.json({ UserId: 'user' })
      return Response.json({ value: [] })
    })
    const msx = new LiveMsxConnector({ getAccessToken: async () => 'delegated' }, transport, undefined, undefined, {}, new MemoryPortfolioPreferenceStore(), { cachePortfolio: false })
    expect(await msx.listAccounts()).toEqual([])
    revoked = true
    await expect(msx.listAccounts()).rejects.toMatchObject({ status: 403 })
  })
})
