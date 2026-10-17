import {
  milestoneCreateInputSchema,
  opportunityCreateInputSchema,
  recordCreationDraftSchema,
  type ChoiceRef,
  type LookupRef,
  type MilestoneCreateInput,
  type OpportunityCreateInput,
  type RecordCreationCatalog,
  type RecordCreationDraft
} from '../../../packages/common/contracts/record-creation.js'

const opportunityColumns = [
  'clientOpportunityKey', 'name', 'opportunityIntent', 'estimatedValue',
  'priceListId', 'priceListLabel', 'currencyId', 'currencyLabel', 'ownerId', 'ownerLabel',
  'estimatedCloseDate', 'need', 'solutionArea', 'technicalCapability'
] as const
const milestoneColumns = [
  'clientMilestoneKey', 'parentOpportunityKey', 'name', 'milestoneCategory', 'milestoneDate',
  'workloadId', 'workloadLabel', 'ownerId', 'ownerLabel', 'milestoneStatus',
  'customerCommitment', 'estimatedMonthlyUsage', 'comments', 'riskDetails', 'customerBudgetApproved'
] as const

export class CreationCsvError extends Error {
  constructor(readonly file: string, readonly row: number, readonly column: string, message: string) {
    super(`${file} row ${row} (${column}): ${message}`)
    this.name = 'CreationCsvError'
  }
}

function parseCsv(text: string, file: string): string[][] {
  if (new TextEncoder().encode(text).length > 1_048_576) {
    throw new CreationCsvError(file, 1, 'file', 'CSV is larger than 1 MiB.')
  }
  const content = text.startsWith('\uFEFF') ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let insideQuotes = false
  let afterQuote = false
  for (let i = 0; i < content.length; i++) {
    const character = content[i]
    if (insideQuotes) {
      if (character === '"') {
        if (content[i + 1] === '"') {
          field += '"'
          i++
        } else {
          insideQuotes = false
          afterQuote = true
        }
      } else {
        field += character
      }
    } else if (character === '"') {
      if (field || afterQuote) throw new CreationCsvError(file, rows.length + 1, String(row.length + 1), 'Unexpected quote in CSV.')
      insideQuotes = true
    } else if (character === ',' || character === '\r' || character === '\n') {
      row.push(field)
      field = ''
      afterQuote = false
      if (character !== ',') {
        rows.push(row)
        row = []
        if (character === '\r' && content[i + 1] === '\n') i++
      }
    } else {
      if (afterQuote) throw new CreationCsvError(file, rows.length + 1, String(row.length + 1), 'Unexpected text after closing quote.')
      field += character
    }
  }
  if (insideQuotes) throw new CreationCsvError(file, rows.length + 1, String(row.length + 1), 'Unclosed quote in CSV.')
  if (field || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  if (rows.length < 2) throw new CreationCsvError(file, 1, 'file', 'CSV needs a header and at least one data row.')
  return rows
}

function records(
  text: string,
  file: string,
  allowed: readonly string[],
  required: readonly string[]
): Array<Record<string, string>> {
  const [head, ...rows] = parseCsv(text, file)
  const headers = head!
  for (const [index, header] of headers.entries()) {
    if (!allowed.includes(header)) throw new CreationCsvError(file, 1, header || String(index + 1), 'Unknown CSV header.')
    if (headers.indexOf(header) !== index) throw new CreationCsvError(file, 1, header, 'Duplicate CSV header.')
  }
  for (const header of required) {
    if (!headers.includes(header)) throw new CreationCsvError(file, 1, header, 'Required CSV header is missing.')
  }
  if (rows.length > 50) throw new CreationCsvError(file, 1, 'file', 'CSV has more than 50 rows.')
  return rows.map((cells, rowIndex) => {
    if (cells.length !== headers.length) throw new CreationCsvError(file, rowIndex + 2, 'row', 'CSV column count differs from the header.')
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]!]))
  })
}

function choice(raw: string | undefined, choices: readonly ChoiceRef[], file: string, row: number, column: string): ChoiceRef {
  if (!raw) throw new CreationCsvError(file, row, column, 'Choose a value.')
  const matches = choices.filter((item) => item.label === raw || String(item.value) === raw)
  if (matches.length !== 1) throw new CreationCsvError(file, row, column, 'Unknown or ambiguous choice.')
  return matches[0]!
}

function lookup(
  id: string | undefined,
  label: string | undefined,
  choices: readonly LookupRef[],
  file: string,
  row: number,
  column: string
): LookupRef | undefined {
  if (!id) {
    if (label) throw new CreationCsvError(file, row, column, 'A lookup ID is required when a label is supplied.')
    return undefined
  }
  const item = choices.find((value) => value.id === id)
  if (!item || (label && item.label !== label)) {
    throw new CreationCsvError(file, row, column, 'The lookup ID or label is unavailable in the current catalog.')
  }
  return { id: item.id, label: item.label }
}

function optionalChoice(raw: string | undefined, options: readonly ChoiceRef[], file: string, row: number, column: string): ChoiceRef | undefined {
  return raw ? choice(raw, options, file, row, column) : undefined
}

function numeric(raw: string | undefined, file: string, row: number, column: string): number {
  if (!raw?.trim() || !/^-?\d+(\.\d+)?$/.test(raw)) throw new CreationCsvError(file, row, column, 'Enter a finite number.')
  const result = Number(raw)
  if (!Number.isFinite(result)) throw new CreationCsvError(file, row, column, 'Enter a finite number.')
  return result
}

function validate<T>(result: { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } }, file: string, row: number): T {
  if (result.success) return result.data
  const issue = result.error.issues[0]
  throw new CreationCsvError(file, row, String(issue?.path[0] ?? 'row'), issue?.message ?? 'Invalid row.')
}

function parseOpportunities(catalog: RecordCreationCatalog, csv: string): OpportunityCreateInput[] {
  const file = 'opportunities.csv'
  const rows = records(csv, file, opportunityColumns, [
    'clientOpportunityKey', 'name', 'opportunityIntent', 'estimatedValue', 'estimatedCloseDate'
  ])
  const keys = new Set<string>()
  return rows.map((row, index) => {
    const line = index + 2
    if (keys.has(row['clientOpportunityKey'] ?? '')) throw new CreationCsvError(file, line, 'clientOpportunityKey', 'Duplicate Opportunity key.')
    keys.add(row['clientOpportunityKey'] ?? '')
    const priceList = lookup(row['priceListId'], row['priceListLabel'], catalog.priceLists, file, line, 'priceListId')
    const currency = lookup(row['currencyId'], row['currencyLabel'], catalog.currencies, file, line, 'currencyId')
    const owner = lookup(row['ownerId'], row['ownerLabel'], catalog.owners, file, line, 'ownerId')
    const value = {
      clientOpportunityKey: row['clientOpportunityKey'],
      name: row['name'],
      intent: (row['opportunityIntent'] ?? '').split('|').map((part) => choice(part.trim(), catalog.choices.intent, file, line, 'opportunityIntent')),
      estimatedValue: numeric(row['estimatedValue'], file, line, 'estimatedValue'),
      estimatedCloseDate: row['estimatedCloseDate'],
      ...(priceList ? { priceList } : {}),
      ...(currency ? { currency } : {}),
      ...(owner ? { owner } : {}),
      ...(row['need'] ? { need: row['need'] } : {}),
      ...(row['solutionArea'] ? { solutionArea: choice(row['solutionArea'], catalog.choices.solutionArea, file, line, 'solutionArea') } : {}),
      ...(row['technicalCapability'] ? { technicalCapability: choice(row['technicalCapability'], catalog.choices.technicalCapability, file, line, 'technicalCapability') } : {})
    }
    return validate(opportunityCreateInputSchema.safeParse(value), file, line)
  })
}

function parseMilestones(catalog: RecordCreationCatalog, csv: string, parentRequired: boolean): Array<{ parentKey: string; milestone: MilestoneCreateInput }> {
  const file = 'milestones.csv'
  const rows = records(csv, file, milestoneColumns, [
    'clientMilestoneKey', ...(parentRequired ? ['parentOpportunityKey'] : []),
    'name', 'milestoneCategory', 'milestoneDate', 'workloadId'
  ])
  const keys = new Set<string>()
  return rows.map((row, index) => {
    const line = index + 2
    if (keys.has(row['clientMilestoneKey'] ?? '')) throw new CreationCsvError(file, line, 'clientMilestoneKey', 'Duplicate Milestone key.')
    keys.add(row['clientMilestoneKey'] ?? '')
    const workload = lookup(row['workloadId'], row['workloadLabel'], catalog.workloads, file, line, 'workloadId')
    if (!workload) throw new CreationCsvError(file, line, 'workloadId', 'Select a Workload.')
    const owner = lookup(row['ownerId'], row['ownerLabel'], catalog.owners, file, line, 'ownerId')
    const status = optionalChoice(row['milestoneStatus'], catalog.choices.status, file, line, 'milestoneStatus')
    const commitment = optionalChoice(row['customerCommitment'], catalog.choices.commitment, file, line, 'customerCommitment')
    const budget = optionalChoice(row['customerBudgetApproved'], catalog.choices.customerBudgetApproved, file, line, 'customerBudgetApproved')
    const value = {
      clientMilestoneKey: row['clientMilestoneKey'],
      name: row['name'],
      category: choice(row['milestoneCategory'], catalog.choices.category, file, line, 'milestoneCategory'),
      milestoneDate: row['milestoneDate'],
      workload,
      ...(owner ? { owner } : {}),
      ...(status ? { status } : {}),
      ...(commitment ? { commitment } : {}),
      ...(budget ? { customerBudgetApproved: budget } : {}),
      ...(row['estimatedMonthlyUsage'] ? { estimatedMonthlyUsage: numeric(row['estimatedMonthlyUsage'], file, line, 'estimatedMonthlyUsage') } : {}),
      ...(row['comments'] ? { comments: row['comments'] } : {}),
      ...(row['riskDetails'] ? { riskDetails: row['riskDetails'] } : {})
    }
    return {
      parentKey: row['parentOpportunityKey'] ?? '',
      milestone: validate(milestoneCreateInputSchema.safeParse(value), file, line)
    }
  })
}

export function importCreationCsv(catalog: RecordCreationCatalog, opportunitiesCsv: string, milestonesCsv?: string): RecordCreationDraft {
  const opportunities = parseOpportunities(catalog, opportunitiesCsv)
  const bundles = opportunities.map((opportunity) => ({ opportunity, milestones: [] as MilestoneCreateInput[] }))
  const byKey = new Map(bundles.map((bundle) => [bundle.opportunity.clientOpportunityKey, bundle]))
  if (milestonesCsv?.trim()) {
    for (const [index, item] of parseMilestones(catalog, milestonesCsv, true).entries()) {
      const parent = byKey.get(item.parentKey)
      if (!parent) throw new CreationCsvError('milestones.csv', index + 2, 'parentOpportunityKey', 'An Opportunity parent key is missing or orphaned.')
      parent.milestones.push(item.milestone)
    }
  }
  return recordCreationDraftSchema.parse({ kind: 'opportunity-batch', account: catalog.account, opportunities: bundles })
}

export function importExistingMilestoneCsv(catalog: RecordCreationCatalog, parent: LookupRef, milestonesCsv: string): RecordCreationDraft {
  if (!catalog.opportunities.some((opportunity) => opportunity.id === parent.id && opportunity.label === parent.label)) {
    throw new CreationCsvError('milestones.csv', 1, 'parent', 'The selected Opportunity is not in the authorized catalog.')
  }
  const parsed = parseMilestones(catalog, milestonesCsv, false)
  if (parsed.some((item) => item.parentKey && item.parentKey !== parent.id)) {
    throw new CreationCsvError('milestones.csv', 2, 'parentOpportunityKey', 'A row refers to a different parent Opportunity.')
  }
  return recordCreationDraftSchema.parse({
    kind: 'existing-opportunity-milestone-batch',
    account: catalog.account,
    opportunity: { id: parent.id, label: parent.label },
    milestones: parsed.map((item) => item.milestone)
  })
}
