import { describe, expect, it } from 'vitest'
import { portfolioReadRequestSchema, portfolioWorkspaceRequestSchema, portfolioIndexSchema, portfolioWorkspaceSchema } from '../../packages/common/contracts/index.js'

describe('independently versioned aggregate portfolio reads', () => {
  it('requires version 1.0 and rejects extra input and output fields', () => {
    expect(portfolioReadRequestSchema.parse({ contractVersion: '1.0' })).toEqual({ contractVersion: '1.0' })
    expect(portfolioWorkspaceRequestSchema.parse({ contractVersion: '1.0', accountId: 'a', opportunityId: 'o' })).toMatchObject({ accountId: 'a', opportunityId: 'o' })
    for (const input of [{}, { contractVersion: '1.2' }, { contractVersion: '1.0', token: 'not-allowed' }]) {
      expect(() => portfolioReadRequestSchema.parse(input)).toThrow()
    }
    expect(portfolioIndexSchema.parse({ contractVersion: '1.0', accounts: [], opportunities: [] })).toMatchObject({ accounts: [] })
    expect(() => portfolioWorkspaceSchema.parse({ contractVersion: '1.0', accounts: [], opportunities: [], milestones: [], stale: true })).toThrow()
    expect(() => portfolioIndexSchema.parse({ contractVersion: '1.0', accounts: [{ id: 'a', name: 'A', segment: 'test', secret: 'rejected' }], opportunities: [] })).toThrow()
  })
})
