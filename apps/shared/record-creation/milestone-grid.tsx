import type { ReactElement } from 'react'
import type { RecordCreationCatalog } from '../../../packages/common/contracts/record-creation.js'
import type { MilestoneRow } from './draft-model.js'

export function MilestoneGrid({
  rows, catalog, onChange, onAdd, onEdit, onRemove
}: {
  rows: readonly MilestoneRow[]
  catalog: RecordCreationCatalog | null
  onChange(row: MilestoneRow): void
  onAdd(): void
  onEdit(): void
  onRemove(key: string): void
}): ReactElement {
  return (
    <>
      <div className="new-record-grid-wrap">
        <table className="new-record-grid" aria-label="Milestone entry grid">
          <thead><tr><th>Milestone name</th><th>Milestone category</th><th>Milestone estimated date</th><th>Workload</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.key}>
            <td><input required aria-label="Milestone name" maxLength={100} value={row.name} onChange={(event) => onChange({ ...row, name: event.target.value })} /></td>
            <td>
              <select required aria-label="Milestone category" value={row.categoryValue} onChange={(event) => onChange({ ...row, categoryValue: event.target.value })}>
                <option value="">Select category</option>
                {catalog?.choices.category.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </td>
            <td><input required aria-label="Milestone estimated date" type="date" value={row.milestoneDate} onChange={(event) => onChange({ ...row, milestoneDate: event.target.value })} /></td>
            <td>
              <select required aria-label="Workload" value={row.workloadId} onChange={(event) => onChange({ ...row, workloadId: event.target.value })}>
                <option value="">Select Workload</option>
                {catalog?.workloads.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </td>
            <td>
              <button type="button" onClick={onEdit}>Edit details</button>
              <button type="button" disabled={rows.length === 1} onClick={() => onRemove(row.key)}>Remove Milestone</button>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      <button type="button" onClick={onAdd}>Add Milestone</button>
    </>
  )
}
