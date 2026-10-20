import { describe, expect, it } from 'vitest'
import { contractVersion, discoverableOpportunitySchema, opportunitySchema } from '../../packages/common/index.js'

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
  it('uses contract v1.2 and accepts multiple Opportunity Intent labels', () => {
    expect(contractVersion).toBe('1.2')
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

  it.each([-1250.75, -0.01, 0, 1_000_000])('preserves the signed source value %s in Portfolio and Discover', (value) => {
    expect(opportunitySchema.parse({ ...opportunity, value }).value).toBe(value)
    expect(discoverableOpportunitySchema.parse({ ...opportunity, value, domain: 'infra', onDealTeam: false }).value).toBe(value)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '-1250.75', null])('rejects non-finite or non-numeric source values (%s)', (value) => {
    expect(opportunitySchema.safeParse({ ...opportunity, value }).success).toBe(false)
    expect(discoverableOpportunitySchema.safeParse({ ...opportunity, value, domain: 'infra', onDealTeam: false }).success).toBe(false)
  })
})
