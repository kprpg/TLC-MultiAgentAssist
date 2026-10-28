import type { WorkflowQueueItem, WorkflowRecordReference } from '../../common/contracts/workflow-output.js'
import type { WorkflowResultCard } from '../../common/contracts/workflows.js'

export type AggregateRecord = Pick<WorkflowRecordReference, 'accountId' | 'ownerId' | 'ownerName'>

export function ownerWorkloadQueue(records: readonly AggregateRecord[], threshold: number, evidenceIds: string[]): WorkflowQueueItem[] {
  const owners = new Map<string, { count: number; name: string }>()
  for (const record of records) {
    const ownerId = record.ownerId ?? 'unassigned'
    const ownerName = record.ownerName ?? (ownerId === 'unassigned' ? 'Unassigned owner' : 'Owner name unavailable')
    const current = owners.get(ownerId)
    owners.set(ownerId, {
      count: (current?.count ?? 0) + 1,
      name: current?.name !== 'Owner name unavailable' ? current?.name ?? ownerName : ownerName
    })
  }
  return [...owners.entries()]
    .filter(([, owner]) => owner.count > threshold)
    .sort(([, left], [, right]) => left.name.localeCompare(right.name))
    .map(([ownerId, owner]) => ({
      id: `WF-009:${ownerId}`, workflowId: 'WF-009', priority: owner.count > threshold * 2 ? 'P0' : 'P1',
      title: `${owner.name} owns ${owner.count} active opportunities`, owner: owner.name,
      evidenceIds, status: 'new'
    }))
}

export function aggregateResultCard(
  workflowId: 'WF-008' | 'WF-009', title: string, records: readonly AggregateRecord[],
  queueCount: number, evidenceIds: string[]
): WorkflowResultCard {
  if (workflowId === 'WF-009') return {
    kind: 'metric-strip', title, evidenceIds,
    metrics: [{ label: 'Overloaded owners', value: queueCount }, { label: 'Active opportunities', value: records.length }]
  }
  const accounts = new Map<string, number>()
  for (const record of records) {
    const id = record.accountId ?? 'Unassigned'
    accounts.set(id, (accounts.get(id) ?? 0) + 1)
  }
  const largest = accounts.size ? Math.max(...accounts.values()) : 0
  return {
    kind: 'metric-strip', title, evidenceIds,
    metrics: [
      { label: 'Pipeline opportunities', value: records.length },
      { label: 'Accounts', value: accounts.size },
      { label: 'Top account share %', value: records.length ? Math.round(largest / records.length * 100) : 0 }
    ]
  }
}
