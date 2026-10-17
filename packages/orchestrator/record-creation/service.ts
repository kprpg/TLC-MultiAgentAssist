import { randomUUID } from 'node:crypto'
import {
  contractVersion,
  recordCreationCatalogRequestSchema,
  recordCreationCommitRequestSchema,
  recordCreationDraftSchema,
  recordCreationPreviewRequestSchema,
  recordCreationPreviewSchema,
  type ChoiceRef,
  type LookupRef,
  type MilestoneCreateInput,
  type RecordCreationCatalog,
  type RecordCreationDraft,
  type RecordCreationDraftResult,
  type RecordCreationPreview,
  type RecordCreationResult,
  type RecordCreationErrorCode
} from '../../common/index.js'
import type { MsxConnector, AtomicRecordCreationWriter, RecordCreationCatalogProvider } from '../../connectors/common/index.js'
import { creationPreviewDigest } from './digest.js'
import { exportCreationDraft } from './export.js'

export class RecordCreationError extends Error {
  constructor(readonly code: RecordCreationErrorCode, message: string) {
    super(message)
    this.name = 'RecordCreationError'
  }
}

function requireReference<T extends LookupRef>(
  submitted: LookupRef | undefined,
  fallback: LookupRef | undefined,
  options: readonly T[],
  label: string
): LookupRef {
  const requested = submitted ?? fallback
  const found = options.find((item) => item.id === requested?.id)
  if (!found || found.label !== requested?.label) {
    throw new RecordCreationError('reference-unavailable', `${label} is unavailable or has changed. Choose a current value.`)
  }
  return { id: found.id, label: found.label }
}

function requireChoice(selected: ChoiceRef, choices: readonly ChoiceRef[], label: string): ChoiceRef {
  const found = choices.find((choice) => choice.value === selected.value)
  if (!found || found.label !== selected.label) {
    throw new RecordCreationError('reference-unavailable', `${label} is unavailable or has changed. Choose a current value.`)
  }
  return found
}

export class RecordCreationService {
  private readonly writer: AtomicRecordCreationWriter | undefined
  private readonly now: () => Date

  constructor(
    private readonly msx: Pick<MsxConnector, 'listAccounts' | 'listOpportunities'>,
    private readonly catalogProvider: RecordCreationCatalogProvider,
    options: { writer?: AtomicRecordCreationWriter; now?: () => Date } = {}
  ) {
    this.writer = options.writer
    this.now = options.now ?? (() => new Date())
  }

  async getCatalog(input: unknown): Promise<RecordCreationCatalog> {
    const request = recordCreationCatalogRequestSchema.parse(input)
    const account = (await this.msx.listAccounts()).find((item) => item.id === request.accountId)
    if (!account || account.visibility === 'hidden') {
      throw new RecordCreationError('parent-unavailable', 'The selected Account is unavailable or hidden.')
    }
    const catalog = await this.catalogProvider.getCatalog(request.accountId)
    if (account.name !== catalog.account.label) {
      throw new RecordCreationError('catalog-changed', 'The Account name changed. Refresh the creation catalog.')
    }
    return { ...catalog, target: this.writer ? 'sqlite' : 'draft' }
  }

  async preview(input: unknown): Promise<RecordCreationPreview> {
    const request = recordCreationPreviewRequestSchema.parse(input)
    if (request.target === 'live-msx') {
      throw new RecordCreationError('target-disabled', 'Live MSX record creation is disabled. Use a draft or the SQLite sample store.')
    }
    if (request.target === 'sqlite' && !this.writer) {
      throw new RecordCreationError('target-disabled', 'SQLite record creation is unavailable in this mode. Export a draft instead.')
    }
    const catalog = await this.getCatalog({ contractVersion, accountId: request.draft.account.id })
    const normalizedDraft = await this.normalizeDraft(request.draft, catalog)
    if (request.target === 'sqlite' && normalizedDraft.kind === 'existing-opportunity-milestone-batch'
      && !catalog.opportunities.find((item) => item.id === normalizedDraft.opportunity.id)?.currency) {
      throw new RecordCreationError('reference-unavailable', 'The parent Opportunity currency is unavailable. Choose an Opportunity with a resolved currency.')
    }
    const mutationCount = this.countMutations(normalizedDraft)
    if (mutationCount > catalog.maxMutations) {
      throw new RecordCreationError('batch-too-large', `The batch has ${mutationCount} mutations; this mode allows ${catalog.maxMutations}.`)
    }
    const batchId = randomUUID()
    const warnings = request.target === 'draft' ? ['Draft only. No records will be written to MSX or SQLite.'] : []
    const expiresAt = new Date(this.now().getTime() + 15 * 60_000).toISOString()
    return recordCreationPreviewSchema.parse({
      contractVersion,
      batchId,
      digest: creationPreviewDigest({
        batchId, target: request.target, catalogRevision: catalog.revision,
        userId: catalog.defaults.owner.id, normalizedDraft, mutationCount, warnings, expiresAt
      }),
      target: request.target,
      catalogRevision: catalog.revision,
      normalizedDraft,
      mutationCount,
      warnings,
      expiresAt
    })
  }

  async commit(input: unknown): Promise<RecordCreationResult> {
    const request = recordCreationCommitRequestSchema.parse(input)
    const { preview } = request
    if (preview.target !== 'sqlite' || !this.writer) {
      throw new RecordCreationError('target-disabled', 'This preview is a draft; export it instead of committing.')
    }
    const catalog = await this.validatePreview(request)
    const receipt = await this.writer.getReceipt(preview.batchId, preview.digest)
    if (receipt) return receipt
    await this.validateCurrentCatalog(preview, catalog)
    return this.writer.commit(preview.normalizedDraft, preview.batchId, preview.digest)
  }

  async exportDraft(input: unknown): Promise<RecordCreationDraftResult> {
    const request = recordCreationCommitRequestSchema.parse(input)
    if (request.preview.target !== 'draft') {
      throw new RecordCreationError('target-disabled', 'Only a reviewed draft can be exported.')
    }
    const catalog = await this.validatePreview(request)
    await this.validateCurrentCatalog(request.preview, catalog)
    return exportCreationDraft(request.preview)
  }

  private async validatePreview(request: ReturnType<typeof recordCreationCommitRequestSchema.parse>): Promise<RecordCreationCatalog> {
    const { preview } = request
    if (preview.digest !== request.expectedDigest) {
      throw new RecordCreationError('stale-preview', 'The reviewed preview digest changed. Preview the batch again.')
    }
    if (this.now().getTime() >= Date.parse(preview.expiresAt)) {
      throw new RecordCreationError('stale-preview', 'The reviewed preview expired. Preview the batch again.')
    }
    const catalog = await this.getCatalog({ contractVersion, accountId: preview.normalizedDraft.account.id })
    const digest = creationPreviewDigest({
      batchId: preview.batchId, target: preview.target, catalogRevision: preview.catalogRevision,
      userId: catalog.defaults.owner.id, normalizedDraft: preview.normalizedDraft,
      mutationCount: preview.mutationCount, warnings: preview.warnings, expiresAt: preview.expiresAt
    })
    if (digest !== preview.digest) {
      throw new RecordCreationError('stale-preview', 'The reviewed preview was changed. Preview the batch again.')
    }
    return catalog
  }

  private async validateCurrentCatalog(preview: RecordCreationPreview, catalog: RecordCreationCatalog): Promise<void> {
    if (catalog.revision !== preview.catalogRevision) {
      throw new RecordCreationError('catalog-changed', 'The creation catalog changed. Preview the batch again.')
    }
    if (this.countMutations(preview.normalizedDraft) !== preview.mutationCount
      || preview.mutationCount > catalog.maxMutations) {
      throw new RecordCreationError('stale-preview', 'The reviewed mutation count changed. Preview the batch again.')
    }
    const draft = preview.normalizedDraft
    if (preview.target === 'sqlite' && draft.kind === 'existing-opportunity-milestone-batch'
      && !catalog.opportunities.find((item) => item.id === draft.opportunity.id)?.currency) {
      throw new RecordCreationError('reference-unavailable', 'The parent Opportunity currency is unavailable. Preview the batch again.')
    }
    const normalized = await this.normalizeDraft(preview.normalizedDraft, catalog)
    if (JSON.stringify(normalized) !== JSON.stringify(preview.normalizedDraft)) {
      throw new RecordCreationError('catalog-changed', 'A reference or parent changed. Preview the batch again.')
    }
  }

  private countMutations(draft: RecordCreationDraft): number {
    return draft.kind === 'opportunity-batch'
      ? draft.opportunities.reduce((total, bundle) => total + 2 + bundle.milestones.length, 0)
      : draft.milestones.length
  }

  private async normalizeDraft(input: RecordCreationDraft, catalog: RecordCreationCatalog): Promise<RecordCreationDraft> {
    const draft = recordCreationDraftSchema.parse(input)
    if (draft.account.id !== catalog.account.id || draft.account.label !== catalog.account.label) {
      throw new RecordCreationError('parent-unavailable', 'The selected Account does not match the current catalog.')
    }
    const normalizeChild = (value: MilestoneCreateInput) => ({
      ...value,
      category: requireChoice(value.category, catalog.choices.category, 'Milestone Category'),
      workload: requireReference(value.workload, undefined, catalog.workloads, 'Workload'),
      owner: requireReference(value.owner, catalog.defaults.owner, catalog.owners, 'Owner'),
      status: value.status
        ? requireChoice(value.status, catalog.choices.status, 'Milestone Status')
        : requireChoice({ value: 861980000, label: 'On Track' }, catalog.choices.status, 'Milestone Status'),
      ...(value.commitment ? { commitment: requireChoice(value.commitment, catalog.choices.commitment, 'Customer Commitment') } : {}),
      ...(value.customerBudgetApproved
        ? { customerBudgetApproved: requireChoice(value.customerBudgetApproved, catalog.choices.customerBudgetApproved, 'Customer Budget Approved') }
        : {})
    })
    if (draft.kind === 'existing-opportunity-milestone-batch') {
      const parent = (await this.msx.listOpportunities(draft.account.id)).find((item) => item.id === draft.opportunity.id)
      const authorized = catalog.opportunities.find((item) => item.id === draft.opportunity.id)
      if (!parent || parent.name !== draft.opportunity.label || authorized?.label !== parent.name) {
        throw new RecordCreationError('parent-unavailable', 'The parent Opportunity is unavailable or does not belong to this Account.')
      }
      if (authorized.currency && authorized.currency.isoCode !== parent.currency) {
        throw new RecordCreationError('catalog-changed', 'The parent Opportunity currency has changed. Refresh the creation catalog.')
      }
      return recordCreationDraftSchema.parse({
        ...draft,
        account: catalog.account,
        opportunity: { id: parent.id, label: parent.name },
        milestones: draft.milestones.map(normalizeChild)
      })
    }
    return recordCreationDraftSchema.parse({
      ...draft,
      account: catalog.account,
      opportunities: draft.opportunities.map(({ opportunity, milestones }) => ({
        opportunity: {
          ...opportunity,
          intent: opportunity.intent.map((choice) => requireChoice(choice, catalog.choices.intent, 'Opportunity Intent')),
          priceList: requireReference(opportunity.priceList, catalog.defaults.priceList, catalog.priceLists, 'Price List'),
          currency: requireReference(opportunity.currency, catalog.defaults.currency, catalog.currencies, 'Currency'),
          owner: requireReference(opportunity.owner, catalog.defaults.owner, catalog.owners, 'Owner'),
          ...(opportunity.solutionArea
            ? { solutionArea: requireChoice(opportunity.solutionArea, catalog.choices.solutionArea, 'Solution Area') }
            : {}),
          ...(opportunity.technicalCapability
            ? { technicalCapability: requireChoice(opportunity.technicalCapability, catalog.choices.technicalCapability, 'Technical Capability') }
            : {})
        },
        milestones: milestones.map(normalizeChild)
      }))
    })
  }
}
