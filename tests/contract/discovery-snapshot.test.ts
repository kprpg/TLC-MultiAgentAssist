import { describe, expect, it } from 'vitest'
import { discoverySnapshotRequestSchema, discoverySnapshotSchema } from '../../packages/common/contracts/index.js'

describe('independently versioned Discovery snapshot', () => {
  const snapshot = {
    contractVersion: '1.0', generatedAt: '2026-10-21T12:00:00.000Z', accounts: [],
    portfolioOpportunities: [], opportunities: [], milestoneTeamOpportunityIds: []
  }
  it('requires its version and rejects unknown fields at every boundary', () => {
    expect(discoverySnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(discoverySnapshotRequestSchema.parse({ contractVersion: '1.0' })).toEqual({ contractVersion: '1.0' })
    for (const input of [{}, { contractVersion: '1.2' }, { contractVersion: '1.0', token: 'rejected' }]) {
      expect(() => discoverySnapshotRequestSchema.parse(input)).toThrow()
    }
    expect(() => discoverySnapshotSchema.parse({ ...snapshot, accessToken: 'rejected' })).toThrow()
    expect(() => discoverySnapshotSchema.parse({
      ...snapshot, accounts: [{ id: 'a', name: 'Synthetic', segment: 'test', secret: 'rejected' }]
    })).toThrow()
    expect(() => discoverySnapshotSchema.parse({ ...snapshot, generatedAt: 'not-a-date' })).toThrow()
  })
})
