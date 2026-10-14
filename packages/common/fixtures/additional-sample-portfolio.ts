import {
  accountSchema,
  milestoneSchema,
  opportunitySchema,
  type Account,
  type Milestone,
  type Opportunity
} from '../contracts/index.js'

export interface SampleCriterionObservation {
  criterionId: string
  status: 'met' | 'partial' | 'missing'
  detail: string
}

export const additionalSampleAccounts: readonly Account[] = Object.freeze([
  accountSchema.parse({ id: 'account-fourth-coffee', name: 'Fourth Coffee', segment: 'Enterprise', tpid: '1000006' }),
  accountSchema.parse({ id: 'account-tailspin-toys', name: 'Tailspin Toys', segment: 'Corporate', tpid: '1000007' }),
  accountSchema.parse({ id: 'account-wide-world-importers', name: 'Wide World Importers', segment: 'Strategic', tpid: '1000008' }),
  accountSchema.parse({ id: 'account-woodgrove-bank', name: 'Woodgrove Bank', segment: 'Strategic', tpid: '1000009' })
])

export const additionalSampleOpportunities: readonly Opportunity[] = Object.freeze([
  opportunitySchema.parse({
    id: 'opp-fourth-coffee-loyalty',
    accountId: 'account-fourth-coffee',
    name: 'Customer loyalty Copilot',
    owner: 'Priya Shah',
    recordedStage: 2,
    value: 2_150_000,
    currency: 'USD',
    closeDate: '2027-02-19'
  }),
  opportunitySchema.parse({
    id: 'opp-fourth-coffee-analytics',
    accountId: 'account-fourth-coffee',
    name: 'Store analytics modernization - ready to advance',
    owner: 'Marcus Chen',
    recordedStage: 4,
    value: 5_400_000,
    currency: 'USD',
    closeDate: '2026-12-18'
  }),
  opportunitySchema.parse({
    id: 'opp-tailspin-ecommerce',
    accountId: 'account-tailspin-toys',
    name: 'Global ecommerce expansion',
    recordedStage: 1,
    value: 1_300_000,
    currency: 'USD',
    closeDate: '2027-06-11'
  }),
  opportunitySchema.parse({
    id: 'opp-tailspin-forecasting',
    accountId: 'account-tailspin-toys',
    name: 'Demand forecasting platform',
    owner: 'Elena Ruiz',
    recordedStage: 3,
    value: 3_750_000,
    currency: 'USD',
    closeDate: '2027-01-22'
  }),
  opportunitySchema.parse({
    id: 'opp-wwi-control-tower',
    accountId: 'account-wide-world-importers',
    name: 'Supply chain control tower - ready to advance',
    owner: 'Noah Williams',
    recordedStage: 3,
    value: 6_200_000,
    currency: 'USD',
    closeDate: '2026-11-27'
  }),
  opportunitySchema.parse({
    id: 'opp-wwi-warehouse-edge',
    accountId: 'account-wide-world-importers',
    name: 'Warehouse edge modernization',
    owner: 'Aisha Khan',
    recordedStage: 2,
    value: 2_800_000,
    currency: 'USD',
    closeDate: '2027-04-16'
  }),
  opportunitySchema.parse({
    id: 'opp-woodgrove-fraud-ai',
    accountId: 'account-woodgrove-bank',
    name: 'AI fraud prevention expansion',
    owner: 'Daniel Kim',
    recordedStage: 4,
    value: 7_800_000,
    currency: 'USD',
    closeDate: '2026-12-04'
  }),
  opportunitySchema.parse({
    id: 'opp-woodgrove-regulatory-data',
    accountId: 'account-woodgrove-bank',
    name: 'Regulatory data estate',
    recordedStage: 1,
    value: 4_100_000,
    currency: 'USD',
    closeDate: '2027-05-14'
  })
])

export const additionalSampleMilestones: readonly Milestone[] = Object.freeze([
  milestoneSchema.parse({ id: 'ms-fourth-loyalty-outcome', opportunityId: 'opp-fourth-coffee-loyalty', name: 'Loyalty outcome validation', status: 'Completed', targetDate: '2026-11-06', estimatedMonthlyUsage: 95_000, owner: 'Priya Shah', commitment: 'Committed' }),
  milestoneSchema.parse({ id: 'ms-fourth-loyalty-data', opportunityId: 'opp-fourth-coffee-loyalty', name: 'Customer data readiness', status: 'At Risk', targetDate: '2026-12-04', estimatedMonthlyUsage: 140_000, owner: 'Solution Engineer', commitment: 'Uncommitted', riskDetails: 'Consent and identity-resolution ownership are not confirmed.' }),
  milestoneSchema.parse({ id: 'ms-fourth-loyalty-pilot', opportunityId: 'opp-fourth-coffee-loyalty', name: 'Copilot pilot decision', status: 'On Track', targetDate: '2027-01-15', estimatedMonthlyUsage: 180_000, owner: 'Priya Shah', commitment: 'Committed' }),

  milestoneSchema.parse({ id: 'ms-fourth-analytics-scale', opportunityId: 'opp-fourth-coffee-analytics', name: 'Store telemetry scale validation', status: 'Completed', targetDate: '2026-09-18', estimatedMonthlyUsage: 280_000, owner: 'Marcus Chen', commitment: 'Committed' }),
  milestoneSchema.parse({ id: 'ms-fourth-analytics-funding', opportunityId: 'opp-fourth-coffee-analytics', name: 'Production funding approval', status: 'Completed', targetDate: '2026-10-23', estimatedMonthlyUsage: 360_000, owner: 'Finance sponsor', commitment: 'Committed' }),
  milestoneSchema.parse({ id: 'ms-fourth-analytics-deploy', opportunityId: 'opp-fourth-coffee-analytics', name: 'Wave-one deployment', status: 'On Track', targetDate: '2026-11-20', estimatedMonthlyUsage: 450_000, owner: 'Cloud Solution Architect', commitment: 'Committed' }),

  milestoneSchema.parse({ id: 'ms-tailspin-commerce-discovery', opportunityId: 'opp-tailspin-ecommerce', name: 'International market discovery', status: 'In Progress', targetDate: '2027-01-29', estimatedMonthlyUsage: 55_000, commitment: 'Uncommitted' }),
  milestoneSchema.parse({ id: 'ms-tailspin-commerce-security', opportunityId: 'opp-tailspin-ecommerce', name: 'Payment security review', status: 'Blocked', estimatedMonthlyUsage: 72_000, owner: 'Security lead', commitment: 'Uncommitted', riskDetails: 'The target payment provider and data residency model are undecided.' }),
  milestoneSchema.parse({ id: 'ms-tailspin-commerce-sponsor', opportunityId: 'opp-tailspin-ecommerce', name: 'Executive sponsor confirmation', status: 'At Risk', targetDate: '2027-03-12', estimatedMonthlyUsage: 80_000, commitment: 'Uncommitted', riskDetails: 'No executive sponsor is recorded.' }),

  milestoneSchema.parse({ id: 'ms-tailspin-forecast-data', opportunityId: 'opp-tailspin-forecasting', name: 'Historical demand data validation', status: 'Completed', targetDate: '2026-09-25', estimatedMonthlyUsage: 165_000, owner: 'Data lead', commitment: 'Committed' }),
  milestoneSchema.parse({ id: 'ms-tailspin-forecast-model', opportunityId: 'opp-tailspin-forecasting', name: 'Forecast model acceptance', status: 'At Risk', targetDate: '2026-11-13', estimatedMonthlyUsage: 235_000, owner: 'Elena Ruiz', commitment: 'Uncommitted', riskDetails: 'Seasonal accuracy is below the customer threshold in two regions.' }),
  milestoneSchema.parse({ id: 'ms-tailspin-forecast-business', opportunityId: 'opp-tailspin-forecasting', name: 'Inventory benefit sign-off', status: 'On Track', targetDate: '2026-12-11', estimatedMonthlyUsage: 310_000, owner: 'Operations sponsor', commitment: 'Committed' }),

  milestoneSchema.parse({ id: 'ms-wwi-control-outcome', opportunityId: 'opp-wwi-control-tower', name: 'Control-tower outcomes agreed', status: 'Completed', targetDate: '2026-08-28', estimatedMonthlyUsage: 260_000, owner: 'Noah Williams', commitment: 'Committed' }),
  milestoneSchema.parse({ id: 'ms-wwi-control-validation', opportunityId: 'opp-wwi-control-tower', name: 'End-to-end technical validation', status: 'Completed', targetDate: '2026-09-25', estimatedMonthlyUsage: 390_000, owner: 'Solution Engineer', commitment: 'Committed' }),
  milestoneSchema.parse({ id: 'ms-wwi-control-decision', opportunityId: 'opp-wwi-control-tower', name: 'Production decision', status: 'On Track', targetDate: '2026-10-30', estimatedMonthlyUsage: 515_000, owner: 'Executive sponsor', commitment: 'Committed' }),

  milestoneSchema.parse({ id: 'ms-wwi-edge-sites', opportunityId: 'opp-wwi-warehouse-edge', name: 'Pilot warehouse selection', status: 'Completed', targetDate: '2026-10-09', estimatedMonthlyUsage: 90_000, owner: 'Aisha Khan', commitment: 'Committed' }),
  milestoneSchema.parse({ id: 'ms-wwi-edge-network', opportunityId: 'opp-wwi-warehouse-edge', name: 'Edge network readiness', status: 'Blocked', targetDate: '2026-12-18', estimatedMonthlyUsage: 175_000, owner: 'Network architect', commitment: 'Uncommitted', riskDetails: 'Two pilot sites lack approved resilient connectivity.' }),
  milestoneSchema.parse({ id: 'ms-wwi-edge-pilot', opportunityId: 'opp-wwi-warehouse-edge', name: 'Operational pilot', status: 'On Track', targetDate: '2027-02-12', estimatedMonthlyUsage: 235_000, owner: 'Warehouse operations', commitment: 'Uncommitted' }),

  milestoneSchema.parse({ id: 'ms-woodgrove-fraud-model', opportunityId: 'opp-woodgrove-fraud-ai', name: 'Fraud model validation', status: 'Completed', targetDate: '2026-08-21', estimatedMonthlyUsage: 410_000, owner: 'Daniel Kim', commitment: 'Committed' }),
  milestoneSchema.parse({ id: 'ms-woodgrove-fraud-risk', opportunityId: 'opp-woodgrove-fraud-ai', name: 'Model risk approval', status: 'At Risk', targetDate: '2026-10-16', estimatedMonthlyUsage: 520_000, owner: 'Model risk officer', commitment: 'Committed', riskDetails: 'Explainability evidence needs one final independent review.' }),
  milestoneSchema.parse({ id: 'ms-woodgrove-fraud-rollout', opportunityId: 'opp-woodgrove-fraud-ai', name: 'Regional rollout commitment', status: 'On Track', targetDate: '2026-11-13', estimatedMonthlyUsage: 650_000, owner: 'Fraud operations', commitment: 'Committed' }),

  milestoneSchema.parse({ id: 'ms-woodgrove-data-scope', opportunityId: 'opp-woodgrove-regulatory-data', name: 'Regulatory scope confirmation', status: 'In Progress', targetDate: '2027-01-08', estimatedMonthlyUsage: 120_000, owner: 'Compliance lead', commitment: 'Uncommitted' }),
  milestoneSchema.parse({ id: 'ms-woodgrove-data-owner', opportunityId: 'opp-woodgrove-regulatory-data', name: 'Data ownership mapping', status: 'At Risk', targetDate: '2027-02-19', estimatedMonthlyUsage: 185_000, commitment: 'Uncommitted', riskDetails: 'Ownership is missing for three critical reporting domains.' }),
  milestoneSchema.parse({ id: 'ms-woodgrove-data-architecture', opportunityId: 'opp-woodgrove-regulatory-data', name: 'Target architecture workshop', status: 'On Track', targetDate: '2027-03-26', estimatedMonthlyUsage: 260_000, owner: 'Solution Engineer', commitment: 'Committed' })
])

export const additionalSampleObservationsByOpportunity: Readonly<Record<string, readonly SampleCriterionObservation[]>> = Object.freeze({
  'opp-fourth-coffee-loyalty': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer targets a measurable increase in loyalty enrollment and repeat visits.' },
    { criterionId: 'decision-team', status: 'partial', detail: 'Marketing and data owners are engaged; privacy approval remains open.' },
    { criterionId: 'technical-validation', status: 'partial', detail: 'The pilot architecture is drafted but customer data readiness is at risk.' },
    { criterionId: 'business-case', status: 'met', detail: 'A pilot value hypothesis is quantified and owned by marketing.' },
    { criterionId: 'next-step', status: 'met', detail: 'The pilot decision meeting has a committed date and named attendees.' }
  ],
  'opp-fourth-coffee-analytics': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'Store performance and inventory outcomes have approved targets.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Operations, finance, data, security, and procurement stakeholders are aligned.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'Telemetry scale and production architecture have passed validation.' },
    { criterionId: 'business-case', status: 'met', detail: 'Finance approved production funding based on pilot results.' },
    { criterionId: 'next-step', status: 'met', detail: 'Wave-one deployment has committed owners and dates.' }
  ],
  'opp-tailspin-ecommerce': [
    { criterionId: 'customer-outcome', status: 'partial', detail: 'International growth is stated, but market-level targets are missing.' },
    { criterionId: 'decision-team', status: 'missing', detail: 'An executive sponsor and payment decision owner are not recorded.' },
    { criterionId: 'technical-validation', status: 'missing', detail: 'Payment security and data residency decisions block solution validation.' },
    { criterionId: 'business-case', status: 'partial', detail: 'Revenue potential is estimated without fulfillment and compliance costs.' },
    { criterionId: 'next-step', status: 'partial', detail: 'Discovery is planned, but customer attendance is unconfirmed.' }
  ],
  'opp-tailspin-forecasting': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'Inventory reduction and in-stock targets are agreed.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Supply chain, data, finance, and operations owners are engaged.' },
    { criterionId: 'technical-validation', status: 'partial', detail: 'Model quality is accepted in most regions, with two seasonal gaps.' },
    { criterionId: 'business-case', status: 'partial', detail: 'Benefits are quantified but await final operations sign-off.' },
    { criterionId: 'next-step', status: 'met', detail: 'The acceptance review has named customer attendees and a date.' }
  ],
  'opp-wwi-control-tower': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'Lead-time, disruption, and inventory outcomes are customer validated.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Executive, operations, finance, security, and procurement owners are aligned.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'End-to-end control-tower validation met acceptance criteria.' },
    { criterionId: 'business-case', status: 'met', detail: 'Finance validated the scale business case using pilot evidence.' },
    { criterionId: 'next-step', status: 'met', detail: 'The production decision is committed with named attendees.' }
  ],
  'opp-wwi-warehouse-edge': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'Warehouse latency and availability targets are documented.' },
    { criterionId: 'decision-team', status: 'partial', detail: 'Operations and architecture are engaged; the network approver is missing.' },
    { criterionId: 'technical-validation', status: 'missing', detail: 'Resilient connectivity is blocked at two pilot warehouses.' },
    { criterionId: 'business-case', status: 'partial', detail: 'The pilot cost is known but rollout economics are incomplete.' },
    { criterionId: 'next-step', status: 'met', detail: 'The pilot plan has named site and Microsoft owners.' }
  ],
  'opp-woodgrove-fraud-ai': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'Fraud-loss and false-positive targets are agreed.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Fraud, risk, data, security, and executive stakeholders are engaged.' },
    { criterionId: 'technical-validation', status: 'partial', detail: 'Model performance passed; final explainability review remains.' },
    { criterionId: 'business-case', status: 'met', detail: 'Finance validated the expansion case against measured pilot results.' },
    { criterionId: 'next-step', status: 'met', detail: 'Regional rollout has committed owners and dates.' }
  ],
  'opp-woodgrove-regulatory-data': [
    { criterionId: 'customer-outcome', status: 'partial', detail: 'Regulatory reporting improvement is stated without baseline cycle times.' },
    { criterionId: 'decision-team', status: 'partial', detail: 'Compliance is engaged; ownership is missing for three data domains.' },
    { criterionId: 'technical-validation', status: 'missing', detail: 'The target architecture workshop has not occurred.' },
    { criterionId: 'business-case', status: 'missing', detail: 'No validated cost or risk-reduction model is attached.' },
    { criterionId: 'next-step', status: 'met', detail: 'A target architecture workshop is committed.' }
  ]
})
