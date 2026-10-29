import { createHash } from 'node:crypto'
import { momentumSnapshotSchema, type MomentumCollection, type MomentumFocusQuery, type MomentumSnapshot } from '../../common/contracts/momentum-focus.js'
import { pageMomentumView, prepareMomentumView } from '../../common/projections/momentum-focus.js'

export { focusDates, selectMomentumRows } from '../../common/projections/momentum-focus.js'

export function momentumIdentity(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function momentumSnapshotIdentity(data: MomentumCollection): string {
    return momentumIdentity([data.scopeKey, data.scope, data.customerIndustry, data.complete, [...data.records].sort((a, b) => a.key.localeCompare(b.key)).map((row) => ({
        ...row, events: [...row.events].sort((a, b) => a.id.localeCompare(b.id)).map((event) => event.source === 'msx' ? { ...event, observedAt: event.sourceAt } : event)
    }))])
}

export function buildMomentumSnapshot(data: MomentumCollection, query: MomentumFocusQuery, now: Date): MomentumSnapshot {
    return momentumSnapshotSchema.parse(pageMomentumView(prepareMomentumView(data, query, now), query, {
        snapshotId: momentumSnapshotIdentity(data), queryKey: momentumIdentity(query)
    }))
}
