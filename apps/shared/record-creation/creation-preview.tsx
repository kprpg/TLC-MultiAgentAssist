import type { ReactElement } from 'react'
import type {
  MilestoneCreateInput,
  OpportunityCreateInput,
  RecordCreationCatalog,
  RecordCreationPreview
} from '../../../packages/common/contracts/record-creation.js'

function Detail({ label, value }: { label: string; value: string | number | undefined }): ReactElement | null {
  if (value === undefined) return null
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

function MilestoneReview({
  milestone, parentName, currency
}: {
  milestone: MilestoneCreateInput
  parentName: string
  currency?: string | undefined
}): ReactElement {
  return (
    <section className="new-record-review-item" aria-label={`Milestone ${milestone.name}`}>
      <h4>{milestone.name}</h4>
      <dl className="new-record-review-details">
        <Detail label="Parent Opportunity" value={parentName} />
        <Detail label="Milestone key" value={milestone.clientMilestoneKey} />
        <Detail label="Category" value={milestone.category.label} />
        <Detail label="Estimated date" value={milestone.milestoneDate} />
        <Detail label="Workload" value={milestone.workload.label} />
        <Detail label="Owner" value={milestone.owner?.label} />
        <Detail label="Status" value={milestone.status?.label} />
        <Detail label="Currency" value={currency} />
        <Detail label="Customer commitment" value={milestone.commitment?.label} />
        <Detail label="Estimated monthly usage" value={milestone.estimatedMonthlyUsage} />
        <Detail label="Comments" value={milestone.comments} />
        <Detail label="Risk/Blocker Details" value={milestone.riskDetails} />
        <Detail label="Customer budget approved" value={milestone.customerBudgetApproved?.label} />
      </dl>
    </section>
  )
}

function OpportunityReview({
  opportunity, milestones, currency
}: {
  opportunity: OpportunityCreateInput
  milestones: readonly MilestoneCreateInput[]
  currency?: string | undefined
}): ReactElement {
  return (
    <article className="new-record-review-item" aria-label={`Opportunity ${opportunity.name}`}>
      <h3>{opportunity.name}</h3>
      <dl className="new-record-review-details">
        <Detail label="Opportunity key" value={opportunity.clientOpportunityKey} />
        <Detail label="Opportunity Intent" value={opportunity.intent.map((item) => item.label).join(', ')} />
        <Detail label="Estimated value" value={opportunity.estimatedValue} />
        <Detail label="Estimated close date" value={opportunity.estimatedCloseDate} />
        <Detail label="Price List" value={opportunity.priceList?.label} />
        <Detail label="Currency" value={opportunity.currency ? `${opportunity.currency.label} (${currency ?? 'unknown'})` : undefined} />
        <Detail label="Owner" value={opportunity.owner?.label} />
        <Detail label="Need" value={opportunity.need} />
        <Detail label="Solution Area" value={opportunity.solutionArea?.label} />
        <Detail label="Technical Capability" value={opportunity.technicalCapability?.label} />
      </dl>
      {milestones.map((milestone) => (
        <MilestoneReview
          key={milestone.clientMilestoneKey}
          milestone={milestone}
          parentName={opportunity.name}
          currency={opportunity.currency && currency ? `${opportunity.currency.label} (${currency})` : 'Currency unavailable in the draft catalog'}
        />
      ))}
    </article>
  )
}

export function CreationPreview({
  preview, catalog, busy, onEdit, onConfirm
}: {
  preview: RecordCreationPreview
  catalog: RecordCreationCatalog
  busy: boolean
  onEdit(): void
  onConfirm(): void
}): ReactElement {
  const draft = preview.normalizedDraft
  const parentCurrency = draft.kind === 'existing-opportunity-milestone-batch'
    ? catalog.opportunities.find((item) => item.id === draft.opportunity.id)?.currency
    : undefined
  const currency = parentCurrency ? `${parentCurrency.label} (${parentCurrency.isoCode})` : 'Currency unavailable in the draft catalog'
  return (
    <div className="new-record-review" aria-live="polite">
      <h2>Review record creation</h2>
      <p>Account: <strong>{draft.account.label}</strong></p>
      <p>Target: <strong>{preview.target === 'sqlite' ? 'SQLite sample store' : 'Draft only - no writes'}</strong></p>
      <p>{preview.mutationCount} planned mutation{preview.mutationCount === 1 ? '' : 's'}, all-or-nothing.</p>
      {draft.kind === 'opportunity-batch'
        ? draft.opportunities.map(({ opportunity, milestones }) => (
          <OpportunityReview
            key={opportunity.clientOpportunityKey}
            opportunity={opportunity}
            milestones={milestones}
            currency={catalog.currencies.find((item) => item.id === opportunity.currency?.id)?.isoCode}
          />
        ))
        : <article className="new-record-review-item" aria-label={`Existing Opportunity ${draft.opportunity.label}`}>
          <h3>{draft.opportunity.label}</h3>
          {draft.milestones.map((milestone) => (
            <MilestoneReview key={milestone.clientMilestoneKey} milestone={milestone} parentName={draft.opportunity.label} currency={currency} />
          ))}
        </article>}
      {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      <div className="new-record-actions">
        <button type="button" onClick={onEdit} disabled={busy}>Edit</button>
        <button type="button" disabled={busy} onClick={onConfirm}>{preview.target === 'sqlite' ? 'Submit to SQLite' : 'Export draft'}</button>
      </div>
    </div>
  )
}
