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
  },
  {
    id: 'opp-cloud-security-readiness',
    accountId: 'account-contoso',
    name: 'Cloud security readiness',
    recordedStage: 1,
    value: 900000,
    currency: 'USD',
    closeDate: '2027-02-26'
  },
  {
    id: 'opp-data-estate-consolidation',
    accountId: 'account-contoso',
    name: 'Data estate consolidation',
    recordedStage: 2,
    value: 2650000,
    currency: 'USD',
    closeDate: '2027-01-29'
  },
  {
    id: 'opp-ai-factory-rollout',
    accountId: 'account-contoso',
    name: 'AI factory rollout',
    recordedStage: 4,
    value: 6100000,
    currency: 'USD',
    closeDate: '2026-11-20'
  },
  {
    id: 'opp-store-modernization',
    accountId: 'account-fabrikam',
    name: 'Connected store modernization',
    recordedStage: 1,
    value: 1200000,
    currency: 'USD',
    closeDate: '2027-03-19'
  },
  {
    id: 'opp-unified-commerce',
    accountId: 'account-fabrikam',
    name: 'Unified commerce platform',
    recordedStage: 3,
    value: 3800000,
    currency: 'USD',
    closeDate: '2026-12-11'
  },
  {
    id: 'opp-copilot-expansion',
    accountId: 'account-fabrikam',
    name: 'Store associate Copilot expansion',
    recordedStage: 4,
    value: 2400000,
    currency: 'USD',
    closeDate: '2026-10-23'
  },
  {
    id: 'opp-resilient-cloud-foundation',
    accountId: 'account-contoso',
    name: 'Resilient cloud foundation - ready to advance',
    recordedStage: 1,
    value: 1450000,
    currency: 'USD',
    closeDate: '2027-03-12'
  },
  {
    id: 'opp-predictive-maintenance-scale',
    accountId: 'account-contoso',
    name: 'Predictive maintenance scale-out - ready to advance',
    recordedStage: 3,
    value: 4750000,
    currency: 'USD',
    closeDate: '2026-12-04'
  },
  {
    id: 'opp-customer-data-platform',
    accountId: 'account-fabrikam',
    name: 'Customer data platform - ready to advance',
    recordedStage: 2,
    value: 3200000,
    currency: 'USD',
    closeDate: '2027-01-15'
  },
  {
    id: 'opp-ai-store-operations',
    accountId: 'account-fabrikam',
    name: 'AI store operations deployment - ready to advance',
    recordedStage: 4,
    value: 5250000,
    currency: 'USD',
    closeDate: '2026-11-13'
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
  ],
  'opp-cloud-security-readiness': [
    { criterionId: 'budget', status: 'met', detail: 'The security program has approved discovery funding for the current fiscal year.' },
    { criterionId: 'customer-outcome', status: 'partial', detail: 'Reducing critical cloud findings is the stated outcome, but the baseline and target are not recorded.' },
    { criterionId: 'approval', status: 'missing', detail: 'The executive sponsor and security approval path have not been confirmed.' },
    { criterionId: 'timing', status: 'met', detail: 'The customer must select a remediation approach before its February audit window.' }
  ],
  'opp-data-estate-consolidation': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer targets a 25% reduction in data-platform operating cost.' },
    { criterionId: 'decision-team', status: 'partial', detail: 'The data and infrastructure leads are engaged; the economic buyer is not confirmed.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'Discovery documented the current estate, migration constraints, and candidate landing zones.' },
    { criterionId: 'business-case', status: 'partial', detail: 'A cost model exists but excludes migration and change-management costs.' },
    { criterionId: 'next-step', status: 'met', detail: 'A design review is scheduled with named customer and Microsoft owners.' }
  ],
  'opp-ai-factory-rollout': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'Three production use cases have agreed adoption and cycle-time targets.' },
    { criterionId: 'decision-team', status: 'met', detail: 'The executive sponsor, AI council, security approver, procurement lead, and delivery team are engaged.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'The pilot met its quality, safety, latency, and integration acceptance criteria.' },
    { criterionId: 'business-case', status: 'met', detail: 'Finance validated the investment case and phased funding envelope.' },
    { criterionId: 'next-step', status: 'partial', detail: 'The rollout plan is approved, but the first production deployment date has not been committed.' }
  ],
  'opp-store-modernization': [
    { criterionId: 'budget', status: 'partial', detail: 'Innovation funding is available for a pilot, but rollout funding has not been identified.' },
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer wants to reduce checkout abandonment by 10% and improve inventory accuracy.' },
    { criterionId: 'approval', status: 'met', detail: 'The retail operations sponsor and technology decision makers are identified.' },
    { criterionId: 'timing', status: 'missing', detail: 'No decision date, purchase window, or compelling event is recorded.' }
  ],
  'opp-unified-commerce': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The program has measurable revenue, conversion, and order-fulfillment outcomes.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Commerce, finance, security, procurement, and executive stakeholders are mapped.' },
    { criterionId: 'technical-validation', status: 'partial', detail: 'Core integration patterns are validated; peak-volume testing remains open.' },
    { criterionId: 'business-case', status: 'met', detail: 'The customer approved a quantified business case and funding range.' },
    { criterionId: 'next-step', status: 'partial', detail: 'A validation workshop is planned, but customer attendees are not final.' }
  ],
  'opp-copilot-expansion': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The expansion targets a 20% reduction in associate task time across 300 stores.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Retail operations, HR, security, finance, and deployment owners approved the expansion path.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'The production pilot met groundedness, adoption, and support acceptance criteria.' },
    { criterionId: 'business-case', status: 'partial', detail: 'Benefits are validated, but the support-cost assumption needs finance confirmation.' },
    { criterionId: 'next-step', status: 'met', detail: 'Wave-one deployment has named owners and a committed October start date.' }
  ],
  'opp-resilient-cloud-foundation': [
    { criterionId: 'budget', status: 'met', detail: 'The customer has confirmed funding for discovery, design, and initial implementation.' },
    { criterionId: 'customer-outcome', status: 'met', detail: 'Recovery-time, availability, and operational-efficiency targets have agreed baselines and owners.' },
    { criterionId: 'approval', status: 'met', detail: 'The executive sponsor, economic buyer, architecture authority, and procurement path are confirmed.' },
    { criterionId: 'timing', status: 'met', detail: 'The customer has committed to a November decision ahead of its data-center renewal event.' }
  ],
  'opp-predictive-maintenance-scale': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer approved targets for unplanned downtime, maintenance cost, and asset availability.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Operations, finance, security, procurement, and executive stakeholders are aligned.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'The pilot met model-quality, integration, security, and field-operations acceptance criteria.' },
    { criterionId: 'business-case', status: 'met', detail: 'Finance validated the scale-out business case using measured pilot outcomes.' },
    { criterionId: 'next-step', status: 'met', detail: 'A customer-approved deployment decision meeting has named attendees, owners, and a committed date.' }
  ],
  'opp-customer-data-platform': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer agreed measurable conversion, campaign-cycle, and data-quality outcomes.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Marketing, data, privacy, security, finance, and procurement decision makers are engaged.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'Discovery confirmed source systems, identity resolution, consent, and integration requirements.' },
    { criterionId: 'business-case', status: 'met', detail: 'The expected return and implementation budget are documented and customer validated.' },
    { criterionId: 'next-step', status: 'met', detail: 'The solution-design workshop is confirmed with customer and Microsoft owners.' }
  ],
  'opp-ai-store-operations': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer approved labor-efficiency, task-completion, and associate-adoption targets.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Retail operations, HR, security, finance, legal, and deployment owners approved the path.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'The production pilot met quality, safety, accessibility, support, and integration criteria.' },
    { criterionId: 'business-case', status: 'met', detail: 'Finance approved the deployment business case and full rollout funding.' },
    { criterionId: 'next-step', status: 'met', detail: 'The first deployment wave has a customer-approved date, scope, and accountable owners.' }
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