import { stat } from 'node:fs/promises'
import { PDFParse } from 'pdf-parse'
import type { McemGuidanceConnector, StageCriterion, StageGuidance } from '../common/index.js'

const stageOneCriteria: StageCriterion[] = [
  { id: 'budget', label: 'Budget availability', ownerRole: 'Specialist / SSP', actionWhenMissing: 'Validate available funding or the process and timing required to request it.', rationale: 'The MCEM Overview requires budget, outcomes, approval, and timing before an opportunity is qualified.' },
  { id: 'customer-outcome', label: 'Customer outcomes', ownerRole: 'ATS', actionWhenMissing: 'Identify the expected outcomes, returns, KPIs, or capabilities and their priority for the customer.', rationale: 'Customer outcomes connect the opportunity to measurable business priorities.' },
  { id: 'approval', label: 'Approval process', ownerRole: 'Account Executive', actionWhenMissing: 'Identify the stakeholders, decision makers, sponsor, and approval path.', rationale: 'Qualification requires a known approval process and sponsorship.' },
  { id: 'timing', label: 'Decision and implementation timing', ownerRole: 'Specialist / SSP', actionWhenMissing: 'Confirm funding, decision, purchase, and implementation timing plus any compelling event.', rationale: 'Qualification requires a credible timeline and reason to act.' }
]

const stageCriteria: Record<number, StageCriterion[]> = {
  1: stageOneCriteria,
  2: [
    { id: 'customer-outcome', label: 'Customer value is quantified', ownerRole: 'ATS', actionWhenMissing: 'Quantify the customer outcomes, value hypothesis, and measures of success.', rationale: 'Stage 2 must establish a credible customer value case before execution begins.' },
    { id: 'decision-team', label: 'Customer and Microsoft teams are aligned', ownerRole: 'Account Executive', actionWhenMissing: 'Confirm sponsors, decision makers, technical stakeholders, and Microsoft owners.', rationale: 'The design must have an aligned decision team and accountable v-team.' },
    { id: 'technical-validation', label: 'Solution and technical fit are credible', ownerRole: 'Solution Engineer (SE)', actionWhenMissing: 'Validate solution fit, technical feasibility, risks, and the evidence plan.', rationale: 'Technical fit and a credible validation route are required to progress.' },
    { id: 'business-case', label: 'Business case and execution plans are credible', ownerRole: 'Specialist / SSP', actionWhenMissing: 'Document the business case, commercial path, success plan, and required resources.', rationale: 'The customer and account team need a credible plan to achieve the stated value.' },
    { id: 'next-step', label: 'Delivery route is agreed', ownerRole: 'CSA / CSAM', actionWhenMissing: 'Name the delivery route, owners, next commitment, and target date.', rationale: 'Progression requires a practical delivery path, not only a solution concept.' }
  ],
  3: [
    { id: 'customer-outcome', label: 'Customer agreement is documented', ownerRole: 'ATS', actionWhenMissing: 'Capture customer agreement on scope, outcomes, measures, and implementation intent.', rationale: 'Stage 3 closes only when customer agreement is explicit.' },
    { id: 'decision-team', label: 'Committed pipeline is confirmed', ownerRole: 'Account Executive', actionWhenMissing: 'Confirm commercial commitment, pipeline state, accountable owners, and dates.', rationale: 'The opportunity must be commercially committed before handoff.' },
    { id: 'technical-validation', label: 'Technical close is complete', ownerRole: 'Solution Engineer (SE)', actionWhenMissing: 'Close technical validation, risks, architecture decisions, and acceptance criteria.', rationale: 'All material technical questions must be closed or explicitly accepted.' },
    { id: 'business-case', label: 'Value and delivery commitments are approved', ownerRole: 'Specialist / SSP', actionWhenMissing: 'Confirm the approved value case, funding, delivery scope, and commitments.', rationale: 'Execution must be backed by an approved customer and commercial commitment.' },
    { id: 'next-step', label: 'CSU handoff is accepted', ownerRole: 'CSA / CSAM', actionWhenMissing: 'Complete and obtain acceptance of the delivery handoff, owners, dependencies, and first milestones.', rationale: 'The receiving delivery team must accept an actionable handoff.' }
  ],
  4: [
    { id: 'customer-outcome', label: 'Measurable business value is demonstrated', ownerRole: 'CSAM', actionWhenMissing: 'Measure realized outcomes against the customer-approved baseline and targets.', rationale: 'Stage 4 must demonstrate customer value, not merely deployment completion.' },
    { id: 'decision-team', label: 'Adoption owners and governance are active', ownerRole: 'CSAM', actionWhenMissing: 'Activate customer adoption owners and a recurring value governance rhythm.', rationale: 'Scaling requires active customer ownership and governance.' },
    { id: 'technical-validation', label: 'Production solution is healthy and scalable', ownerRole: 'Cloud Solution Architect', actionWhenMissing: 'Validate production health, capacity, reliability, security, and scale readiness.', rationale: 'The implemented solution must be able to sustain and expand realized value.' },
    { id: 'business-case', label: 'Scale case is validated', ownerRole: 'Specialist / SSP', actionWhenMissing: 'Validate the economic case and customer commitment for broader adoption or consumption.', rationale: 'Scale must be justified by measurable outcomes and a credible economic case.' },
    { id: 'next-step', label: 'Optimization plan is agreed', ownerRole: 'CSAM', actionWhenMissing: 'Agree the next adoption, optimization, and value-realization milestones.', rationale: 'Stage 5 begins with an owned plan to manage and optimize value.' }
  ],
  5: [
    { id: 'customer-outcome', label: 'Value realization remains measurable', ownerRole: 'CSAM', actionWhenMissing: 'Refresh outcome measures, baselines, and the customer value review.', rationale: 'Manage and Optimize continuously measures realized business value.' },
    { id: 'decision-team', label: 'Customer governance remains engaged', ownerRole: 'CSAM', actionWhenMissing: 'Re-engage accountable customer stakeholders and Microsoft owners.', rationale: 'Sustained value depends on active customer governance.' },
    { id: 'technical-validation', label: 'Service health and optimization are managed', ownerRole: 'Cloud Solution Architect', actionWhenMissing: 'Review operational health, optimization opportunities, and technical risks.', rationale: 'The deployed capability must remain healthy, efficient, and fit for evolving needs.' },
    { id: 'business-case', label: 'Expansion signals are value-backed', ownerRole: 'Specialist / SSP', actionWhenMissing: 'Tie any expansion signal to a new customer question, workload, and measurable value.', rationale: 'Expansion should create a new qualified opportunity rather than silently extending Stage 5.' },
    { id: 'next-step', label: 'Next lifecycle action is explicit', ownerRole: 'Account Executive', actionWhenMissing: 'Remain in Stage 5, recycle to Stage 4 for a value-health gap, or qualify a new opportunity at Stage 1 or 2.', rationale: 'Stage 5 has no automatic Stage 6; the next lifecycle action must be explicit.' }
  ]
}

const stageTitles = ['Listen & Consult', 'Inspire & Design', 'Empower & Achieve', 'Realize Value', 'Manage & Optimize']

export class LocalPdfMcemGuidanceConnector implements McemGuidanceConnector {
  private sourcePromise?: Promise<{ effectiveDate: string; version: string; checkedAt: string }>

  constructor(private readonly pdfPath: string) { }

  async getStageGuidance(stage: number): Promise<StageGuidance> {
    const source = await (this.sourcePromise ??= this.loadSource())
    return {
      stage,
      title: `MCEM Stage ${stage}: ${stageTitles[stage - 1] ?? 'Guidance'}`,
      version: source.version,
      effectiveDate: source.effectiveDate,
      criteria: structuredClone(stageCriteria[stage] ?? []),
      sourceHealth: {
        source: 'mcem',
        state: 'partial',
        detail: 'Stage gates use the supplied MCEM Stage Gates and Role Matrix; docs/knowledge/MCEM Overview.pdf validates the local guidance source. No live SharePoint request was made.',
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