import {
    momentumFocusContractVersion, momentumFocusQuerySchema, momentumFocusRequestSchema, momentumFocusResponseSchema,
    type MomentumDataset, type MomentumFocusQuery, type MomentumFocusRequest, type MomentumFocusResponse, type MomentumPriority, type MomentumSnapshot
} from '../../../../packages/common/contracts/momentum-focus.js'
import { pageMomentumView, prepareMomentumView, type PreparedMomentumView } from '../../../../packages/common/projections/momentum-focus.js'

export type InvokeMomentumFocus = (request: MomentumFocusRequest) => Promise<MomentumFocusResponse>
export const momentumCohortKey = (query: MomentumFocusQuery) => `${query.scope === 'team' ? 'team' : 'portfolio'}:${query.customerIndustry}`
const viewKey = (query: MomentumFocusQuery) => JSON.stringify({ ...query, page: 1, pageSize: 100 })
type CachedDataset = {
    pending: Promise<MomentumDataset>
    loaded: MomentumDataset | null
    views: Map<string, PreparedMomentumView>
}

export class MomentumDataSession {
    private readonly datasets = new Map<string, CachedDataset>()
    private generation = 0
    private identity: { key: string; mode: MomentumDataset['data']['mode'] } | null = null

    constructor(private readonly invoke: (request: MomentumFocusRequest) => Promise<unknown>) { }

    invalidate(): void {
        this.generation++
        this.datasets.clear()
        this.identity = null
    }

    hasDataset(query: MomentumFocusQuery): boolean {
        return this.datasets.get(momentumCohortKey(query))?.loaded != null
    }

    private async load(query: MomentumFocusQuery, refresh: boolean, generation: number): Promise<MomentumDataset> {
        try {
            if (generation !== this.generation) throw new Error('The previous Momentum load was superseded by a refresh or source-session change.')
            const response = momentumFocusResponseSchema.parse(await this.invoke(momentumFocusRequestSchema.parse({
                contractVersion: momentumFocusContractVersion, operation: 'load', query, ...(refresh ? { refresh: true } : {})
            })))
            if (generation !== this.generation) throw new Error('The previous Momentum load was superseded by a refresh or source-session change.')
            if (response.kind === 'unavailable') throw new Error(response.message)
            if (response.kind !== 'dataset') throw new Error('The Momentum host did not return a complete scoped dataset. Reload the client and host together.')
            if (response.data.customerIndustry !== query.customerIndustry ||
                response.data.scope !== (query.scope === 'team' ? 'team' : 'portfolio')) {
                throw new Error('The Momentum dataset does not match the current authorized portfolio and industry scope. Refresh and retry.')
            }
            if (this.identity && (this.identity.key !== response.data.scopeKey || this.identity.mode !== response.data.mode)) {
                throw new Error('The Momentum source identity changed. The previous session data was cleared. Refresh before continuing.')
            }
            this.identity = { key: response.data.scopeKey, mode: response.data.mode }
            this.datasets.get(momentumCohortKey(query))!.loaded = response
            return response
        } catch (error) {
            if (generation === this.generation) this.invalidate()
            throw error
        }
    }

    private prepare(entry: CachedDataset, query: MomentumFocusQuery): PreparedMomentumView {
        const key = viewKey(query)
        const cached = entry.views.get(key)
        if (cached) {
            entry.views.delete(key)
            entry.views.set(key, cached)
            return cached
        }
        if (!entry.loaded) throw new Error('There is no current loaded Momentum dataset. Refresh before continuing.')
        const prepared = prepareMomentumView(entry.loaded.data, query, new Date(entry.loaded.asOf))
        if (entry.views.size === 2) entry.views.delete(entry.views.keys().next().value!)
        entry.views.set(key, prepared)
        return prepared
    }

    async snapshot(raw: MomentumFocusQuery, captureHistory = false): Promise<MomentumSnapshot> {
        const query = momentumFocusQuerySchema.parse(raw)
        const generation = this.generation
        const key = momentumCohortKey(query)
        let entry = this.datasets.get(key)
        if (!entry) {
            entry = { loaded: null, views: new Map(), pending: Promise.resolve().then(() => this.load(query, captureHistory, generation)) }
            this.datasets.set(key, entry)
        }
        const loaded = await entry.pending
        if (generation !== this.generation) throw new Error('The previous Momentum load was superseded by a refresh or source-session change.')
        const prepared = this.prepare(entry, query)
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(query)))
        if (generation !== this.generation) throw new Error('The Momentum source session changed while applying filters. Refresh and retry.')
        return pageMomentumView(prepared, query, {
            snapshotId: loaded.snapshotId, queryKey: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
        })
    }

    detail(recordKey: string, snapshot: MomentumSnapshot): MomentumPriority {
        const entry = this.datasets.get(momentumCohortKey(snapshot.query))
        if (!entry?.loaded || entry.loaded.snapshotId !== snapshot.snapshotId || entry.loaded.data.scopeKey !== snapshot.scopeKey) {
            throw new Error('This item is not in the current loaded Momentum dataset. Refresh before opening it.')
        }
        const item = this.prepare(entry, snapshot.query).rows.find((row) => row.key === recordKey)
        if (!item) throw new Error('This item is not in the current loaded and filtered Momentum cohort.')
        return item
    }
}
