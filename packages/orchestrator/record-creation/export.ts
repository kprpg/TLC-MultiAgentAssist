import {
  contractVersion,
  recordCreationDraftResultSchema,
  recordCreationResultSchema,
  type MilestoneCreateInput,
  type RecordCreationDraft,
  type RecordCreationDraftResult,
  type RecordCreationPreview
} from '../../common/index.js'

function csvCell(value: string | number | undefined): string {
  const raw = String(value ?? '')
  const firstContent = [...raw].find((character) => character.charCodeAt(0) > 31 && !/\s/.test(character))
  const safe = firstContent && '=+-@'.includes(firstContent) ? `'${raw}` : raw
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

function csv(rows: readonly (readonly (string | number | undefined)[])[]): string {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function reviewText(value: string): string {
  return value.replaceAll('\\', '\\\\').replace(/[<>*_[\]`|]/g, '\\$&').replace(/\r?\n/g, ' ')
}

const opportunityHeaders = [
  'clientOpportunityKey', 'name', 'opportunityIntent', 'estimatedValue', 'priceListId', 'priceListLabel',
  'currencyId', 'currencyLabel', 'ownerId', 'ownerLabel', 'estimatedCloseDate', 'need',
  'solutionArea', 'technicalCapability'
]
const milestoneHeaders = [
  'clientMilestoneKey', 'parentOpportunityKey', 'name', 'milestoneCategory', 'milestoneDate',
  'workloadId', 'workloadLabel', 'ownerId', 'ownerLabel', 'milestoneStatus', 'customerCommitment',
  'estimatedMonthlyUsage', 'comments', 'riskDetails', 'customerBudgetApproved'
]

function milestoneRow(milestone: MilestoneCreateInput, parentKey: string): Array<string | number | undefined> {
  return [
    milestone.clientMilestoneKey, parentKey, milestone.name, milestone.category.label, milestone.milestoneDate,
    milestone.workload.id, milestone.workload.label, milestone.owner?.id, milestone.owner?.label,
    milestone.status?.label, milestone.commitment?.label, milestone.estimatedMonthlyUsage,
    milestone.comments, milestone.riskDetails, milestone.customerBudgetApproved?.label
  ]
}

function creationCsvFiles(draft: RecordCreationDraft) {
  const opportunityRows = draft.kind === 'opportunity-batch'
    ? draft.opportunities.map(({ opportunity }) => [
      opportunity.clientOpportunityKey, opportunity.name, opportunity.intent.map((choice) => choice.label).join('|'),
      opportunity.estimatedValue, opportunity.priceList?.id, opportunity.priceList?.label,
      opportunity.currency?.id, opportunity.currency?.label, opportunity.owner?.id, opportunity.owner?.label,
      opportunity.estimatedCloseDate, opportunity.need, opportunity.solutionArea?.label, opportunity.technicalCapability?.label
    ])
    : []
  const milestoneRows = draft.kind === 'opportunity-batch'
    ? draft.opportunities.flatMap(({ opportunity, milestones }) => milestones.map((milestone) => milestoneRow(milestone, opportunity.clientOpportunityKey)))
    : draft.milestones.map((milestone) => milestoneRow(milestone, draft.opportunity.id))
  return [
    ...(opportunityRows.length > 0 ? [{ name: 'opportunities.csv', content: csv([opportunityHeaders, ...opportunityRows]), mimeType: 'text/csv' }] : []),
    ...(milestoneRows.length > 0 ? [{ name: 'milestones.csv', content: csv([milestoneHeaders, ...milestoneRows]), mimeType: 'text/csv' }] : [])
  ]
}

export function exportCreationDraft(preview: RecordCreationPreview): RecordCreationDraftResult {
  const draft = preview.normalizedDraft
  const opportunityCount = draft.kind === 'opportunity-batch' ? draft.opportunities.length : 0
  const milestoneCount = draft.kind === 'opportunity-batch'
    ? draft.opportunities.reduce((total, item) => total + item.milestones.length, 0)
    : draft.milestones.length
  const result = recordCreationResultSchema.parse({
    contractVersion,
    batchId: preview.batchId,
    target: 'draft',
    state: 'drafted',
    created: [],
    audit: { correlationId: preview.batchId, opportunityCount, milestoneCount },
    message: 'Draft created. No Opportunity or Milestone was written to MSX.'
  })
  const names = draft.kind === 'opportunity-batch'
    ? draft.opportunities.map((item) => item.opportunity.name)
    : [draft.opportunity.label]
  const review = [
    '# Record creation draft',
    '',
    `Account: ${reviewText(draft.account.label)}`,
    `Opportunities to create: ${opportunityCount}`,
    `Milestones to create: ${milestoneCount}`,
    '',
    ...names.map((name) => `- ${reviewText(name)}`),
    '',
    '**No Opportunity or Milestone was written to MSX.**',
    ''
  ].join('\n')
  return recordCreationDraftResultSchema.parse({
    contractVersion,
    result,
    files: [
      { name: 'creation-manifest.json', content: `${JSON.stringify(draft, null, 2)}\n`, mimeType: 'application/json' },
      { name: 'creation-review.md', content: review, mimeType: 'text/markdown' },
      ...creationCsvFiles(draft)
    ]
  })
}
