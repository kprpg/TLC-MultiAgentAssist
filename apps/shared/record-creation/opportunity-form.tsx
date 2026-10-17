import type { ReactElement } from 'react'
import type { RecordCreationCatalog } from '../../../packages/common/contracts/record-creation.js'
import type { MilestoneRow, OpportunityRow } from './draft-model.js'
import { MilestoneEditor } from './milestone-editor.js'

export function OpportunityForm({
  row, catalog, onChange, onRemove, onAddMilestone
}: {
  row: OpportunityRow
  catalog: RecordCreationCatalog | null
  onChange(row: OpportunityRow): void
  onRemove?: () => void
  onAddMilestone(): void
}): ReactElement {
  const change = <K extends keyof OpportunityRow>(field: K, value: OpportunityRow[K]) => onChange({ ...row, [field]: value })
  const updateMilestone = (updated: MilestoneRow) => change('milestones', row.milestones.map((item) => item.key === updated.key ? updated : item))
  return (
    <fieldset className="new-record-row">
      <legend>Opportunity</legend>
      <div className="new-record-fields">
        <label>Opportunity name<input required maxLength={200} value={row.name} onChange={(event) => change('name', event.target.value)} /></label>
        <label>Opportunity Intent
          <select multiple required size={2} value={row.intentValues} onChange={(event) =>
            change('intentValues', [...event.target.selectedOptions].map((option) => option.value))}>
            {catalog?.choices.intent.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>Estimated value<input required type="number" min={0} step="0.0001" value={row.estimatedValue} onChange={(event) => change('estimatedValue', event.target.value)} /></label>
        <label>Estimated close date<input required type="date" value={row.estimatedCloseDate} onChange={(event) => change('estimatedCloseDate', event.target.value)} /></label>
        <label>Price List
          <select required value={row.priceListId} onChange={(event) => change('priceListId', event.target.value)}>
            <option value="">Select Price List</option>
            {catalog?.priceLists.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label>Currency
          <select required value={row.currencyId} onChange={(event) => change('currencyId', event.target.value)}>
            <option value="">Select Currency</option>
            {catalog?.currencies.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.isoCode})</option>)}
          </select>
        </label>
        <label>Owner
          <select value={row.ownerId} onChange={(event) => change('ownerId', event.target.value)}>
            <option value="">Use signed-in user</option>
            {catalog?.owners.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label>Solution Area
          <select value={row.solutionAreaValue} onChange={(event) => change('solutionAreaValue', event.target.value)}>
            <option value="">Not specified</option>
            {catalog?.choices.solutionArea.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>Technical Capability
          <select value={row.technicalCapabilityValue} onChange={(event) => change('technicalCapabilityValue', event.target.value)}>
            <option value="">Not specified</option>
            {catalog?.choices.technicalCapability.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="new-record-wide">Need<textarea maxLength={2000} value={row.need} onChange={(event) => change('need', event.target.value)} /></label>
      </div>
      {row.milestones.map((milestone) => (
        <MilestoneEditor
          key={milestone.key}
          row={milestone}
          catalog={catalog}
          onChange={updateMilestone}
          onRemove={() => change('milestones', row.milestones.filter((item) => item.key !== milestone.key))}
        />
      ))}
      <div className="new-record-actions">
        <button type="button" onClick={onAddMilestone}>Add Milestone</button>
        {onRemove && <button type="button" className="new-record-remove" onClick={onRemove}>Remove Opportunity</button>}
      </div>
    </fieldset>
  )
}
