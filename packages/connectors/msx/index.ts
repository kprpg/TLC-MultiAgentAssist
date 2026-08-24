import type { Account, Opportunity } from '../../common/index.js'
import type { MsxConnector, OpportunityContext } from '../common/index.js'

export { LiveMsxConnector, MsxRequestError, type MsxAccessTokenProvider } from './live.js'

const accounts: Account[] = [
  { id: 'account-contoso', name: 'Contoso Energy', segment: 'Strategic' },
  { id: 'account-fabrikam', name: 'Fabrikam Retail', segment: 'Enterprise' }
]

const opportunities: Opportunity[] = [
  {
    id: 'opp-grid-modernization',
    accountId: 'account-contoso',
    name: 'Grid operations modernization',
    recordedStage: 3,
    value: 4200000,
    currency: 'USD',
    closeDate: '2026-10-30'
  },
  {
    id: 'opp-ai-service',
    accountId: 'account-fabrikam',
    name: 'AI-assisted customer service',
    recordedStage: 2,
    value: 1750000,
    currency: 'USD',
    closeDate: '2026-12-18'
  }
]

const observationsByOpportunity: Record<string, OpportunityContext['observations']> = {
  'opp-grid-modernization': [
    { criterionId: 'customer-outcome', status: 'partial', detail: 'Reliability improvement is named but has no baseline or target.' },
    { criterionId: 'decision-team', status: 'missing', detail: 'Economic buyer and procurement path are not recorded.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'Architecture workshop completed with the customer platform team.' },
    { criterionId: 'business-case', status: 'missing', detail: 'No quantified value hypothesis is attached to the opportunity.' },
    { criterionId: 'next-step', status: 'partial', detail: 'A workshop is proposed without a confirmed customer date.' }
  ],
  'opp-ai-service': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'Target is a 15% reduction in average handling time.' },
    { criterionId: 'decision-team', status: 'partial', detail: 'Business sponsor is known; security stakeholder is not confirmed.' },
    { criterionId: 'technical-validation', status: 'missing', detail: 'No technical discovery artifact is recorded.' },
    { criterionId: 'business-case', status: 'partial', detail: 'Value hypothesis exists but has not been validated by finance.' },
    { criterionId: 'next-step', status: 'met', detail: 'Discovery workshop is confirmed for September 3.' }
  ]
}

export class FixtureMsxConnector implements MsxConnector {
  async listAccounts(): Promise<Account[]> {
    return structuredClone(accounts)
  }

  async listOpportunities(accountId: string): Promise<Opportunity[]> {
    return structuredClone(opportunities.filter((opportunity) => opportunity.accountId === accountId))
  }

  async getOpportunityContext(opportunityId: string): Promise<OpportunityContext> {
    const opportunity = opportunities.find((candidate) => candidate.id === opportunityId)
    if (!opportunity) {
      throw new Error(`Unknown sample opportunity: ${opportunityId}`)
    }

    const account = accounts.find((candidate) => candidate.id === opportunity.accountId)
    if (!account) {
      throw new Error(`Missing account for sample opportunity: ${opportunityId}`)
    }

    const now = new Date().toISOString()
    return {
      account: structuredClone(account),
      opportunity: structuredClone(opportunity),
      observations: structuredClone(observationsByOpportunity[opportunityId] ?? []),
      retrievedAt: now,
      sourceHealth: {
        source: 'msx',
        state: 'sample',
        detail: 'Sanitized fixture data; no live MSX call was made.',
        checkedAt: now
      }
    }
  }
}