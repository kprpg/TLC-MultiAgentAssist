import { stat } from 'node:fs/promises'
import { PDFParse } from 'pdf-parse'
import type { McemGuidanceConnector, StageCriterion, StageGuidance } from '../common/index.js'

const stageOneCriteria: StageCriterion[] = [
  { id: 'budget', label: 'Budget availability', ownerRole: 'Account Executive', actionWhenMissing: 'Validate available funding or the process and timing required to request it.', rationale: 'The MCEM Overview requires budget, outcomes, approval, and timing before an opportunity is qualified.' },
  { id: 'customer-outcome', label: 'Customer outcomes', ownerRole: 'Account Executive', actionWhenMissing: 'Identify the expected outcomes, returns, KPIs, or capabilities and their priority for the customer.', rationale: 'Customer outcomes connect the opportunity to measurable business priorities.' },
  { id: 'approval', label: 'Approval process', ownerRole: 'Account Executive', actionWhenMissing: 'Identify the stakeholders, decision makers, sponsor, and approval path.', rationale: 'Qualification requires a known approval process and sponsorship.' },
  { id: 'timing', label: 'Decision and implementation timing', ownerRole: 'Account Executive', actionWhenMissing: 'Confirm funding, decision, purchase, and implementation timing plus any compelling event.', rationale: 'Qualification requires a credible timeline and reason to act.' }
]

const lifecycleCriteria: StageCriterion[] = [
  { id: 'customer-outcome', label: 'Measurable customer outcome', ownerRole: 'Specialist', actionWhenMissing: 'Agree the planned outcome, milestone, measurement, and customer review rhythm.', rationale: 'The MCEM Overview says teams should measure progress against planned outcomes and milestones.' },
  { id: 'decision-team', label: 'Customer and v-team alignment', ownerRole: 'Account Executive', actionWhenMissing: 'Align the relevant customer stakeholders and Microsoft v-team roles around the opportunity.', rationale: 'Continuous customer planning coordinates execution across customer stakeholders, ATU, STU, CSU, partners, and executives.' },
  { id: 'technical-validation', label: 'Outcome and exit-criteria evidence', ownerRole: 'Solution Engineer', actionWhenMissing: 'Define the evidence needed to demonstrate the current stage outcomes and exit criteria.', rationale: 'MCEM stage progression is driven by achieved outcomes and exit criteria, not completed activities.' },
  { id: 'business-case', label: 'Business-priority alignment', ownerRole: 'Specialist', actionWhenMissing: 'Connect the opportunity to the customer priority, expected return, and available budget.', rationale: 'MCEM aligns customer needs, business outcomes, and solutions throughout the lifecycle.' },
  { id: 'next-step', label: 'Governed next step', ownerRole: 'Account Executive', actionWhenMissing: 'Agree a dated next step that advances an outcome or exit criterion with named owners.', rationale: 'Customer planning requires coordinated execution and adjustment as needs and priorities evolve.' }
]

export class LocalPdfMcemGuidanceConnector implements McemGuidanceConnector {
  private sourcePromise?: Promise<{ effectiveDate: string; version: string; checkedAt: string }>

  constructor(private readonly pdfPath: string) {}

  async getStageGuidance(stage: number): Promise<StageGuidance> {
    const source = await (this.sourcePromise ??= this.loadSource())
    return {
      stage,
      title: `MCEM Stage ${stage} overview guidance`,
      version: source.version,
      effectiveDate: source.effectiveDate,
      criteria: structuredClone(stage === 1 ? stageOneCriteria : lifecycleCriteria),
      sourceHealth: {
        source: 'mcem',
        state: 'partial',
        detail: 'Local snapshot: docs/knowledge/MCEM Overview.pdf. No live SharePoint request was made; detailed stage guidance remains outside this overview.',
        checkedAt: source.checkedAt
      }
    }
  }

  private async loadSource(): Promise<{ effectiveDate: string; version: string; checkedAt: string }> {
    const file = await stat(this.pdfPath)
    const parser = new PDFParse({ url: new URL(`file://${this.pdfPath.replaceAll('\\', '/')}`).toString() })
    try {
      const { text } = await parser.getText()
      if (!text.includes('MCEM Overview') || !text.includes('Budget, Outcomes, Approval, and Timing')) {
        throw new Error('The configured PDF does not contain the expected MCEM Overview content.')
      }
    } finally {
      await parser.destroy()
    }

    const checkedAt = file.mtime.toISOString()
    const effectiveDate = checkedAt.slice(0, 10)
    return { checkedAt, effectiveDate, version: `local-snapshot-${effectiveDate}` }
  }
}