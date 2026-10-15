import { describe, expect, it } from 'vitest'
import { contractVersion, opportunitySchema } from '../../packages/common/index.js'

const opportunity = {
  id: 'opportunity-1',
  accountId: 'account-1',
  name: 'Consumption expansion',
  recordedStage: 2,
  value: 1_000_000,
  currency: 'USD',
  closeDate: '2027-01-15'
}

describe('opportunity contract', () => {
  it('uses contract v1.1 and accepts multiple Opportunity Intent labels', () => {
    expect(contractVersion).toBe('1.1')
    expect(opportunitySchema.parse({
      ...opportunity,
      opportunityIntent: ['Billed', 'Consumption']
    }).opportunityIntent).toEqual(['Billed', 'Consumption'])
  })

  it('rejects a scalar Opportunity Intent value', () => {
    expect(opportunitySchema.safeParse({
      ...opportunity,
      opportunityIntent: 'Consumption'
    }).success).toBe(false)
  })
})
