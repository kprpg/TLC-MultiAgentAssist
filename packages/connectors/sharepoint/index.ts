import type { McemGuidanceConnector, StageGuidance } from '../common/index.js'

export { GraphMcemAccessProbe } from './live.js'
export type { GraphTokenProvider, McemPageMetadata } from './live.js'
export { LocalPdfMcemGuidanceConnector } from './local-pdf.js'

const stageThreeGuidance: StageGuidance = {
  stage: 3,
  title: 'MCEM Stage 3: Solution Design',
  version: '2026.07',
  effectiveDate: '2026-07-01',
  sourceUrl: 'https://microsoft.sharepoint.com/sites/mcem/sample/stage-3',
  criteria: [
    { id: 'customer-outcome', label: 'Measurable customer outcome', ownerRole: 'Specialist', actionWhenMissing: 'Agree a baseline, target, and measurement owner with the customer.', rationale: 'A measurable outcome anchors value and later adoption tracking.' },
    { id: 'decision-team', label: 'Decision team coverage', ownerRole: 'Account Executive', actionWhenMissing: 'Map the economic buyer, technical approver, procurement path, and customer sponsor.', rationale: 'Stage progression requires a credible decision path.' },
    { id: 'technical-validation', label: 'Technical validation', ownerRole: 'Solution Engineer', actionWhenMissing: 'Define a customer-approved technical validation plan and acceptance criteria.', rationale: 'Solution confidence must be based on customer evidence.' },
    { id: 'business-case', label: 'Supported business case', ownerRole: 'Specialist', actionWhenMissing: 'Build and validate a quantified value hypothesis with the customer.', rationale: 'A supported business case is needed before commitment.' },
    { id: 'next-step', label: 'Mutually agreed next step', ownerRole: 'Account Executive', actionWhenMissing: 'Secure a dated customer next step with named attendees and purpose.', rationale: 'A mutual next step demonstrates active customer progression.' }
  ],
  sourceHealth: {
    source: 'mcem',
    state: 'sample',
    detail: 'Versioned fixture derived for development; canonical SharePoint path remains unverified.',
    checkedAt: '2026-08-24T00:00:00.000Z'
  }
}

export class FixtureMcemGuidanceConnector implements McemGuidanceConnector {
  async getStageGuidance(stage: number): Promise<StageGuidance> {
    if (stage !== 3) {
      return { ...stageThreeGuidance, stage, title: `MCEM Stage ${stage} guidance (sample)` }
    }
    return structuredClone(stageThreeGuidance)
  }
}