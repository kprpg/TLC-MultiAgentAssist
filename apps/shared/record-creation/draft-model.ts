import {
  recordCreationDraftSchema,
  type ChoiceRef,
  type LookupRef,
  type MilestoneCreateInput,
  type OpportunityCreateInput,
  type RecordCreationCatalog,
  type RecordCreationDraft
} from '../../../packages/common/contracts/record-creation.js'

export interface MilestoneRow {
  key: string
  name: string
  categoryValue: string
  milestoneDate: string
  workloadId: string
  ownerId: string
  statusValue: string
  commitmentValue: string
  estimatedMonthlyUsage: string
  comments: string
  riskDetails: string
  budgetValue: string
}

export interface OpportunityRow {
  key: string
  name: string
  intentValues: string[]
  estimatedValue: string
  estimatedCloseDate: string
  priceListId: string
  currencyId: string
  ownerId: string
  need: string
  solutionAreaValue: string
  technicalCapabilityValue: string
  milestones: MilestoneRow[]
}

export function newOpportunityRow(key: string, catalog?: RecordCreationCatalog): OpportunityRow {
  return {
    key, name: '', intentValues: [], estimatedValue: '', estimatedCloseDate: '',
    priceListId: catalog?.defaults.priceList?.id ?? '',
    currencyId: catalog?.defaults.currency?.id ?? '',
    ownerId: catalog?.defaults.owner.id ?? '',
    need: '', solutionAreaValue: '', technicalCapabilityValue: '', milestones: []
  }
}

export function newMilestoneRow(key: string, catalog?: RecordCreationCatalog): MilestoneRow {
  return {
    key, name: '', categoryValue: '', milestoneDate: '', workloadId: '',
    ownerId: catalog?.defaults.owner.id ?? '',
    statusValue: catalog?.choices.status.find((value) => value.value === 861980000)?.value.toString() ?? '',
    commitmentValue: '', estimatedMonthlyUsage: '', comments: '', riskDetails: '', budgetValue: ''
  }
}

function selectedChoice(value: string, choices: readonly ChoiceRef[], label: string): ChoiceRef {
  const result = choices.find((choice) => String(choice.value) === value)
  if (!result) throw new Error(`Select a valid ${label}.`)
  return result
}

function selectedLookup(value: string, choices: readonly LookupRef[], label: string): LookupRef {
  const result = choices.find((choice) => choice.id === value)
  if (!result) throw new Error(`Select a valid ${label}.`)
  return { id: result.id, label: result.label }
}

function optionalLookup(value: string, choices: readonly LookupRef[], label: string): LookupRef | undefined {
  return value ? selectedLookup(value, choices, label) : undefined
}

function optionalChoice(value: string, choices: readonly ChoiceRef[], label: string): ChoiceRef | undefined {
  return value ? selectedChoice(value, choices, label) : undefined
}

function amount(value: string, label: string): number {
  if (!value.trim() || !/^\d+(\.\d+)?$/.test(value)) throw new Error(`Enter a valid ${label}.`)
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`Enter a valid ${label}.`)
  return number
}

function milestoneInput(row: MilestoneRow, catalog: RecordCreationCatalog): MilestoneCreateInput {
  return {
    clientMilestoneKey: row.key,
    name: row.name,
    category: selectedChoice(row.categoryValue, catalog.choices.category, 'Milestone category'),
    milestoneDate: row.milestoneDate,
    workload: selectedLookup(row.workloadId, catalog.workloads, 'Workload'),
    ...(optionalLookup(row.ownerId, catalog.owners, 'Owner') ? { owner: selectedLookup(row.ownerId, catalog.owners, 'Owner') } : {}),
    ...(optionalChoice(row.statusValue, catalog.choices.status, 'Milestone status') ? { status: selectedChoice(row.statusValue, catalog.choices.status, 'Milestone status') } : {}),
    ...(optionalChoice(row.commitmentValue, catalog.choices.commitment, 'Customer commitment') ? { commitment: selectedChoice(row.commitmentValue, catalog.choices.commitment, 'Customer commitment') } : {}),
    ...(row.estimatedMonthlyUsage ? { estimatedMonthlyUsage: amount(row.estimatedMonthlyUsage, 'Estimated monthly usage') } : {}),
    ...(row.comments ? { comments: row.comments } : {}),
    ...(row.riskDetails ? { riskDetails: row.riskDetails } : {}),
    ...(optionalChoice(row.budgetValue, catalog.choices.customerBudgetApproved, 'Customer budget approval')
      ? { customerBudgetApproved: selectedChoice(row.budgetValue, catalog.choices.customerBudgetApproved, 'Customer budget approval') }
      : {})
  }
}

function opportunityInput(row: OpportunityRow, catalog: RecordCreationCatalog): OpportunityCreateInput {
  return {
    clientOpportunityKey: row.key,
    name: row.name,
    intent: row.intentValues.map((value) => selectedChoice(value, catalog.choices.intent, 'Opportunity Intent')),
    estimatedValue: amount(row.estimatedValue, 'Estimated value'),
    estimatedCloseDate: row.estimatedCloseDate,
    ...(optionalLookup(row.priceListId, catalog.priceLists, 'Price List') ? { priceList: selectedLookup(row.priceListId, catalog.priceLists, 'Price List') } : {}),
    ...(optionalLookup(row.currencyId, catalog.currencies, 'Currency') ? { currency: selectedLookup(row.currencyId, catalog.currencies, 'Currency') } : {}),
    ...(optionalLookup(row.ownerId, catalog.owners, 'Owner') ? { owner: selectedLookup(row.ownerId, catalog.owners, 'Owner') } : {}),
    ...(row.need ? { need: row.need } : {}),
    ...(optionalChoice(row.solutionAreaValue, catalog.choices.solutionArea, 'Solution Area') ? { solutionArea: selectedChoice(row.solutionAreaValue, catalog.choices.solutionArea, 'Solution Area') } : {}),
    ...(optionalChoice(row.technicalCapabilityValue, catalog.choices.technicalCapability, 'Technical Capability')
      ? { technicalCapability: selectedChoice(row.technicalCapabilityValue, catalog.choices.technicalCapability, 'Technical Capability') }
      : {})
  }
}

export function buildOpportunityDraft(catalog: RecordCreationCatalog, rows: readonly OpportunityRow[]): RecordCreationDraft {
  return recordCreationDraftSchema.parse({
    kind: 'opportunity-batch',
    account: catalog.account,
    opportunities: rows.map((row) => ({
      opportunity: opportunityInput(row, catalog),
      milestones: row.milestones.map((milestone) => milestoneInput(milestone, catalog))
    }))
  })
}

export function buildExistingMilestoneDraft(
  catalog: RecordCreationCatalog,
  parent: LookupRef,
  rows: readonly MilestoneRow[]
): RecordCreationDraft {
  if (!catalog.opportunities.some((item) => item.id === parent.id && item.label === parent.label)) {
    throw new Error('Select an Opportunity in the current Account.')
  }
  return recordCreationDraftSchema.parse({
    kind: 'existing-opportunity-milestone-batch',
    account: catalog.account,
    opportunity: { id: parent.id, label: parent.label },
    milestones: rows.map((row) => milestoneInput(row, catalog))
  })
}

export function opportunityRowFromInput(input: OpportunityCreateInput, milestones: readonly MilestoneCreateInput[]): OpportunityRow {
  return {
    key: input.clientOpportunityKey,
    name: input.name,
    intentValues: input.intent.map((item) => String(item.value)),
    estimatedValue: String(input.estimatedValue),
    estimatedCloseDate: input.estimatedCloseDate,
    priceListId: input.priceList?.id ?? '',
    currencyId: input.currency?.id ?? '',
    ownerId: input.owner?.id ?? '',
    need: input.need ?? '',
    solutionAreaValue: input.solutionArea ? String(input.solutionArea.value) : '',
    technicalCapabilityValue: input.technicalCapability ? String(input.technicalCapability.value) : '',
    milestones: milestones.map(milestoneRowFromInput)
  }
}

export function milestoneRowFromInput(input: MilestoneCreateInput): MilestoneRow {
  return {
    key: input.clientMilestoneKey,
    name: input.name,
    categoryValue: String(input.category.value),
    milestoneDate: input.milestoneDate,
    workloadId: input.workload.id,
    ownerId: input.owner?.id ?? '',
    statusValue: input.status ? String(input.status.value) : '',
    commitmentValue: input.commitment ? String(input.commitment.value) : '',
    estimatedMonthlyUsage: input.estimatedMonthlyUsage === undefined ? '' : String(input.estimatedMonthlyUsage),
    comments: input.comments ?? '',
    riskDetails: input.riskDetails ?? '',
    budgetValue: input.customerBudgetApproved ? String(input.customerBudgetApproved.value) : ''
  }
}
