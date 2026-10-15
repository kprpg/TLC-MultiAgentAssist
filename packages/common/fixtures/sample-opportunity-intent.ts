import type { Opportunity } from '../contracts/index.js'

const sampleIntents = [
  ['Consumption'],
  ['Billed'],
  ['Billed', 'Consumption']
] as const

export function withSampleOpportunityIntents<T extends Opportunity>(opportunities: readonly T[]): T[] {
  return opportunities.map((opportunity, index) => ({
    ...opportunity,
    opportunityIntent: [...sampleIntents[index % sampleIntents.length]!]
  }))
}
