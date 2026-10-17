import type { ReactElement } from 'react'
import type { RecordCreationCatalog } from '../../../packages/common/contracts/record-creation.js'
import type { MilestoneRow } from './draft-model.js'

export function MilestoneEditor({
  row, catalog, onChange, onRemove
}: {
  row: MilestoneRow
  catalog: RecordCreationCatalog | null
  onChange(row: MilestoneRow): void
  onRemove?(): void
}): ReactElement {
  const change = <K extends keyof MilestoneRow>(field: K, value: MilestoneRow[K]) => onChange({ ...row, [field]: value })
  return (
    <fieldset className="new-record-row">
      <legend>Milestone</legend>
      <div className="new-record-fields">
        <label>Milestone name<input required maxLength={100} value={row.name} onChange={(event) => change('name', event.target.value)} /></label>
        <label>Milestone category
          <select required value={row.categoryValue} onChange={(event) => change('categoryValue', event.target.value)}>
            <option value="">Select category</option>
            {catalog?.choices.category.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>Milestone estimated date<input required type="date" value={row.milestoneDate} onChange={(event) => change('milestoneDate', event.target.value)} /></label>
        <label>Workload
          <select required value={row.workloadId} onChange={(event) => change('workloadId', event.target.value)}>
            <option value="">Select Workload</option>
            {catalog?.workloads.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label>Owner
          <select value={row.ownerId} onChange={(event) => change('ownerId', event.target.value)}>
            <option value="">Use signed-in user</option>
            {catalog?.owners.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label>Milestone status
          <select value={row.statusValue} onChange={(event) => change('statusValue', event.target.value)}>
            <option value="">Use On Track</option>
            {catalog?.choices.status.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        {(row.statusValue === '861980001' || row.statusValue === '861980002') &&
          <label>Risk/Blocker details<textarea required maxLength={2000} value={row.riskDetails} onChange={(event) => change('riskDetails', event.target.value)} /></label>}
        <label>Customer commitment
          <select value={row.commitmentValue} onChange={(event) => change('commitmentValue', event.target.value)}>
            <option value="">Not specified</option>
            {catalog?.choices.commitment.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>Estimated monthly usage
          <input type="number" min={0} step={1} value={row.estimatedMonthlyUsage} onChange={(event) => change('estimatedMonthlyUsage', event.target.value)} />
        </label>
        <label>Customer budget approved
          <select value={row.budgetValue} onChange={(event) => change('budgetValue', event.target.value)}>
            <option value="">Not specified</option>
            {catalog?.choices.customerBudgetApproved.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="new-record-wide">Milestone comments<textarea maxLength={35_000} value={row.comments} onChange={(event) => change('comments', event.target.value)} /></label>
      </div>
      {onRemove && <button type="button" className="new-record-remove" onClick={onRemove}>Remove Milestone</button>}
    </fieldset>
  )
}
