import { createHash, randomUUID } from 'node:crypto'
import {
  contractVersion,
  recordCreationCatalogSchema,
  recordCreationDraftSchema,
  recordCreationMaxMutations,
  recordCreationResultSchema,
  type ChoiceRef,
  type LookupRef,
  type MilestoneCreateInput,
  type RecordCreationCatalog,
  type RecordCreationDraft,
  type RecordCreationResult
} from '../../common/index.js'
import type { LocalStore } from './local-store.js'

function reference(row: Record<string, unknown>): LookupRef {
  return { id: String(row['id']), label: String(row['name']) }
}

function selectReference(
  value: LookupRef | undefined,
  fallback: LookupRef | undefined,
  choices: readonly LookupRef[],
  name: string
): LookupRef {
  const selected = value ?? fallback
  const current = choices.find((item) => item.id === selected?.id)
  if (!current || current.label !== selected?.label) throw new Error(`${name} is unavailable or has changed.`)
  return current
}

function selectChoice(value: ChoiceRef, choices: readonly ChoiceRef[], name: string): ChoiceRef {
  const current = choices.find((item) => item.value === value.value)
  if (!current || current.label !== value.label) throw new Error(`${name} is unavailable or has changed.`)
  return current
}

export class LocalStoreRecordCreation {
  constructor(private readonly store: LocalStore, private readonly currentUserId: string) {}

  getCatalog(accountId: string): RecordCreationCatalog {
    const account = this.store.get('SELECT * FROM account WHERE id = ? AND visibility = ?', accountId, 'visible')
    if (!account) throw new Error('The selected Account is unavailable or hidden.')
    const ownerRow = this.store.get('SELECT id, fullname AS name FROM systemuser WHERE id = ?', this.currentUserId)
    if (!ownerRow) throw new Error('The signed-in user is unavailable in the SQLite test store.')

    const priceLists = this.store.all('SELECT id, name FROM price_level ORDER BY name').map(reference)
    const currencies = this.store.all('SELECT id, name, iso_code FROM transaction_currency ORDER BY name').map((row) => ({
      ...reference(row),
      isoCode: String(row['iso_code'])
    }))
    const workloads = this.store.all('SELECT id, name FROM workload ORDER BY name').map(reference)
    const owners = this.store.all('SELECT id, fullname AS name FROM systemuser ORDER BY fullname').map(reference)
    const options = this.store.all('SELECT option_set, code, label FROM option_value ORDER BY option_set, code')
    const choices = {
      intent: this.choiceValues(options, 'msp_opportunitytype'),
      category: this.choiceValues(options, 'msp_milestonecategory'),
      status: this.choiceValues(options, 'msp_milestonestatus'),
      commitment: this.choiceValues(options, 'msp_commitmentrecommendation'),
      customerBudgetApproved: this.choiceValues(options, 'msp_customerbudgetapproved'),
      solutionArea: this.choiceValues(options, 'msp_solutionarea'),
      technicalCapability: this.choiceValues(options, 'msp_technicalcapability')
    }
    const defaultPriceList = priceLists.find((item) => item.id === account['default_price_level_id'])
    const defaultCurrency = currencies.find((item) => item.id === account['default_currency_id'])
    const opportunities = this.store.all(
      `SELECT o.id, o.name, o.currency, o.transaction_currency_id FROM opportunity o WHERE o.account_id = ? AND (
        EXISTS (SELECT 1 FROM opportunity_dealteam dt WHERE dt.opportunity_id = o.id AND dt.systemuser_id = ?)
        OR EXISTS (SELECT 1 FROM milestone_team_member mt WHERE mt.opportunity_id = o.id AND mt.systemuser_id = ?)
      ) ORDER BY o.name`, accountId, this.currentUserId, this.currentUserId
    ).map((row) => {
      const matches = row['transaction_currency_id']
        ? currencies.filter((item) => item.id === row['transaction_currency_id'])
        : currencies.filter((item) => item.isoCode === row['currency'])
      const currency = matches.length === 1 && matches[0]?.isoCode === row['currency'] ? matches[0] : undefined
      return { ...reference(row), ...(currency ? { currency } : {}) }
    })
    const data = {
      account: { id: accountId, label: String(account['name']) },
      opportunities,
      priceLists,
      currencies,
      workloads,
      owners,
      defaults: {
        owner: { id: this.currentUserId, label: String(ownerRow['name']) },
        ...(defaultPriceList ? { priceList: defaultPriceList } : {}),
        ...(defaultCurrency ? { currency: defaultCurrency } : {})
      },
      choices
    }
    const revision = createHash('sha256').update(JSON.stringify(data)).digest('hex')
    return recordCreationCatalogSchema.parse({
      contractVersion,
      target: 'sqlite',
      revision,
      ...data,
      maxMutations: recordCreationMaxMutations
    })
  }

  getReceipt(batchId: string, digest: string): RecordCreationResult | undefined {
    const saved = this.store.get('SELECT digest, created_by, result_json FROM creation_batch WHERE batch_id = ?', batchId)
    if (!saved) return undefined
    if (saved['digest'] !== digest || saved['created_by'] !== this.currentUserId) {
      throw new Error('This creation batch was already committed with different content or by another user.')
    }
    return recordCreationResultSchema.parse(JSON.parse(String(saved['result_json'])))
  }

  async commit(input: RecordCreationDraft, batchId: string, digest: string): Promise<RecordCreationResult> {
    const draft = recordCreationDraftSchema.parse(input)
    if (!batchId.trim() || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error('A valid batch ID and preview digest are required.')
    }
    this.store.exec('BEGIN IMMEDIATE')
    try {
      const receipt = this.getReceipt(batchId, digest)
      if (receipt) {
        this.store.exec('COMMIT')
        return receipt
      }

      const catalog = this.getCatalog(draft.account.id)
      if (catalog.account.label !== draft.account.label) throw new Error('The selected Account has changed.')
      const opportunityCount = draft.kind === 'opportunity-batch' ? draft.opportunities.length : 0
      const milestoneCount = draft.kind === 'opportunity-batch'
        ? draft.opportunities.reduce((count, bundle) => count + bundle.milestones.length, 0)
        : draft.milestones.length
      if (opportunityCount * 2 + milestoneCount > catalog.maxMutations) {
        throw new Error('The creation batch exceeds the allowed number of mutations.')
      }

      const created: RecordCreationResult['created'] = []
      if (draft.kind === 'opportunity-batch') {
        for (const bundle of draft.opportunities) {
          const inputOpportunity = bundle.opportunity
          const priceList = selectReference(inputOpportunity.priceList, catalog.defaults.priceList, catalog.priceLists, 'Price List')
          const currency = selectReference(inputOpportunity.currency, catalog.defaults.currency, catalog.currencies, 'Currency')
          const currencyIsoCode = catalog.currencies.find((item) => item.id === currency.id)!.isoCode
          const owner = selectReference(inputOpportunity.owner, catalog.defaults.owner, catalog.owners, 'Owner')
          const intent = inputOpportunity.intent.map((choice) => selectChoice(choice, catalog.choices.intent, 'Opportunity Intent'))
          const solutionArea = inputOpportunity.solutionArea
            ? selectChoice(inputOpportunity.solutionArea, catalog.choices.solutionArea, 'Solution Area')
            : undefined
          const technicalCapability = inputOpportunity.technicalCapability
            ? selectChoice(inputOpportunity.technicalCapability, catalog.choices.technicalCapability, 'Technical Capability')
            : undefined
          const opportunityId = `opp-${randomUUID()}`
          this.store.run(
            `INSERT INTO opportunity
              (id, account_id, name, owner_id, price_level_id, transaction_currency_id, opportunity_intent_codes,
               recorded_stage, estimated_value, currency, estimated_close_date, description, solution_area, technical_capability)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
            opportunityId, catalog.account.id, inputOpportunity.name, owner.id, priceList.id, currency.id,
            intent.map((choice) => choice.value).join(','), inputOpportunity.estimatedValue, currencyIsoCode,
            inputOpportunity.estimatedCloseDate, inputOpportunity.need ?? null, solutionArea?.label ?? null,
            technicalCapability?.label ?? null
          )
          created.push({ kind: 'opportunity', clientKey: inputOpportunity.clientOpportunityKey, recordId: opportunityId })
          this.store.run('INSERT INTO opportunity_dealteam (opportunity_id, systemuser_id) VALUES (?, ?)', opportunityId, this.currentUserId)
          created.push({ kind: 'deal-team', clientKey: inputOpportunity.clientOpportunityKey, parentRecordId: opportunityId })
          for (const milestone of bundle.milestones) {
            created.push(this.insertMilestone(milestone, opportunityId, catalog, currency.id))
          }
        }
      } else {
        const parent = this.store.get(
          `SELECT o.id, o.name, o.account_id, o.currency, o.transaction_currency_id FROM opportunity o WHERE o.id = ? AND o.account_id = ? AND (
             EXISTS (SELECT 1 FROM opportunity_dealteam dt WHERE dt.opportunity_id = o.id AND dt.systemuser_id = ?)
             OR EXISTS (SELECT 1 FROM milestone_team_member mt WHERE mt.opportunity_id = o.id AND mt.systemuser_id = ?)
           )`,
          draft.opportunity.id, draft.account.id, this.currentUserId, this.currentUserId
        )
        if (!parent || parent['name'] !== draft.opportunity.label) throw new Error('The parent Opportunity is unavailable or does not belong to this Account.')
        const currency = catalog.opportunities.find((item) => item.id === draft.opportunity.id)?.currency
        if (!currency || currency.isoCode !== parent['currency']
          || (parent['transaction_currency_id'] && currency.id !== parent['transaction_currency_id'])) {
          throw new Error('The parent Opportunity currency is unavailable or has changed.')
        }
        for (const milestone of draft.milestones) {
          created.push(this.insertMilestone(milestone, draft.opportunity.id, catalog, currency.id))
        }
      }

      const result = recordCreationResultSchema.parse({
        contractVersion,
        batchId,
        target: 'sqlite',
        state: 'committed',
        created,
        audit: { correlationId: batchId, opportunityCount, milestoneCount, committedAt: new Date().toISOString() },
        message: 'All reviewed records were created in the SQLite sample store.'
      })
      this.store.run(
        'INSERT INTO creation_batch (batch_id, digest, account_id, created_by, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        batchId, digest, catalog.account.id, this.currentUserId, JSON.stringify(result), result.audit.committedAt!
      )
      for (const [ordinal, item] of result.created.entries()) {
        this.store.run(
          'INSERT INTO creation_batch_item (batch_id, client_key, kind, ordinal, record_id, parent_record_id) VALUES (?, ?, ?, ?, ?, ?)',
          batchId, item.clientKey, item.kind, ordinal, item.recordId ?? null, item.parentRecordId ?? null
        )
      }
      this.store.exec('COMMIT')
      return result
    } catch (error) {
      this.store.exec('ROLLBACK')
      throw error
    }
  }

  private choiceValues(rows: Record<string, unknown>[], optionSet: string): ChoiceRef[] {
    return rows.filter((row) => row['option_set'] === optionSet).map((row) => ({
      value: Number(row['code']),
      label: String(row['label'])
    }))
  }

  private insertMilestone(
    milestone: MilestoneCreateInput,
    opportunityId: string,
    catalog: RecordCreationCatalog,
    currencyId: string
  ): RecordCreationResult['created'][number] {
    const category = selectChoice(milestone.category, catalog.choices.category, 'Milestone Category')
    const status = milestone.status
      ? selectChoice(milestone.status, catalog.choices.status, 'Milestone Status')
      : catalog.choices.status.find((choice) => choice.value === 861980000)
    if (!status) throw new Error('An On Track milestone status is unavailable in the SQLite catalog.')
    const commitment = milestone.commitment
      ? selectChoice(milestone.commitment, catalog.choices.commitment, 'Customer Commitment')
      : undefined
    const budget = milestone.customerBudgetApproved
      ? selectChoice(milestone.customerBudgetApproved, catalog.choices.customerBudgetApproved, 'Customer Budget Approved')
      : undefined
    const workload = selectReference(milestone.workload, undefined, catalog.workloads, 'Workload')
    const owner = selectReference(milestone.owner, catalog.defaults.owner, catalog.owners, 'Owner')
    const id = `ms-${randomUUID()}`
    this.store.run(
      `INSERT INTO engagement_milestone
        (id, opportunity_id, name, status, milestone_date, owner_id, milestone_category, workload_id,
         parent_account_id, transaction_currency_id, commitment, monthly_use, risk_details,
         forecast_comments, customer_budget_approved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, opportunityId, milestone.name, status.value, milestone.milestoneDate, owner.id, category.value,
      workload.id, catalog.account.id, currencyId, commitment?.value ?? null, milestone.estimatedMonthlyUsage ?? null,
      milestone.riskDetails ?? null, milestone.comments ?? null, budget?.value ?? null
    )
    return { kind: 'milestone', clientKey: milestone.clientMilestoneKey, recordId: id, parentRecordId: opportunityId }
  }
}
