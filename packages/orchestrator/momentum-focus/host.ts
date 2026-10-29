import type { TokenCredential } from '@azure/core-auth'
import {
    momentumCollectionSchema, momentumFocusContractVersion, momentumFocusRequestSchema, momentumFocusResponseSchema, momentumRuleVersion,
    type MomentumCollection, type MomentumFocusResponse, type MomentumSourceHealth
} from '../../common/contracts/momentum-focus.js'
import { createMomentumFixture, momentumSampleNow } from '../../common/fixtures/momentum-focus.js'
import { LiveMomentumCollector, momentumSourceStatus, type MomentumSource } from '../../connectors/msx/momentum-focus.js'
import type { MomentumHistoryOwner, MomentumHistoryRepository } from '../../connectors/msx/momentum-history.js'
import { createMomentumHistoryRepository, momentumHistoryOwner } from '../../connectors/msx/momentum-storage.js'
import { buildMomentumSnapshot, momentumIdentity, momentumSnapshotIdentity, selectMomentumRows } from './analytics.js'
import { CustomerIndustryScopeError } from '../../connectors/msx/customer-industry.js'

export interface MomentumFocusHost { invoke(request: unknown): Promise<MomentumFocusResponse> }
export class SharedMomentumFocusHost implements MomentumFocusHost {
    constructor(private readonly options: {
        collect(scope: MomentumCollection['scope'], customerIndustry: MomentumCollection['customerIndustry']): Promise<MomentumCollection>
        now?: () => Date
        history?: MomentumHistoryRepository
        owner?(): Promise<MomentumHistoryOwner>
        onError?(code: string): void
    }) { }
    async invoke(raw: unknown): Promise<MomentumFocusResponse> {
        const request = momentumFocusRequestSchema.parse(raw)
        const unavailable = (code: Extract<MomentumFocusResponse, { kind: 'unavailable' }>['code'], message: string): MomentumFocusResponse =>
            momentumFocusResponseSchema.parse({ contractVersion: momentumFocusContractVersion, kind: 'unavailable', code, message })
        let data: MomentumCollection
        let owner: MomentumHistoryOwner | undefined
        const scope = request.operation === 'load' && request.query.scope === 'mine' ? 'portfolio' : request.query.scope
        try {
            owner = await this.options.owner?.()
            data = momentumCollectionSchema.parse(await this.options.collect(scope, request.query.customerIndustry))
        } catch (error) {
            if (error instanceof CustomerIndustryScopeError) {
                this.options.onError?.('industry-unavailable')
                return unavailable('industry-unavailable', error.message)
            }
            const status = momentumSourceStatus(error)
            const code = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 429 ? 'throttled' : 'source-unavailable'
            this.options.onError?.(code)
            return unavailable(code, status === 401 || status === 403
                ? 'The signed-in user no longer has the required MSX access. Reconnect and verify the current portfolio.'
                : 'The authorized Momentum sources could not be loaded. No cached or sample business data was substituted.')
        }
        if (data.customerIndustry !== request.query.customerIndustry) return unavailable('industry-unavailable', 'The source did not verify the requested customer industry scope. Refresh before viewing customer data.')
        if (request.query.scope === 'team' && !data.teamAvailable) return unavailable('scope-unavailable', 'No permitted Team scope could be verified from the current Dynamics hierarchy.')
        data.scope = scope
        const now = this.options.now?.() ?? new Date()
        if (owner) data.scopeKey = momentumIdentity(owner)
        if (data.mode === 'live') {
            data.sources = data.sources.filter((source) => source.source !== 'history')
            let historyHealth: MomentumSourceHealth = {
                source: 'history', state: 'unavailable', count: null, checkedAt: now.toISOString(),
                detail: 'Secure shared history is not configured. Current priorities remain available; past movement is unknown. No host-local/plaintext fallback.'
            }
            for (const row of data.records) {
                row.events = row.events.filter((event) => event.source === 'msx')
                row.history = { state: 'unavailable', scope: 'unavailable', availableSince: null, lastObserved: null, observations: 0, maxGapDays: null }
            }
            if (owner && this.options.history) {
                try {
                    let captured = 0
                    for (let offset = 0; offset < data.records.length; offset += 8) {
                        await Promise.all(data.records.slice(offset, offset + 8).map(async (row) => {
                            const history = request.operation === 'refresh' || request.operation === 'load' && request.refresh === true
                                ? await this.options.history!.observe(owner!, row, now.toISOString())
                                : await this.options.history!.read(owner!, row.key, now.toISOString())
                            if (history) {
                                const { events, ...coverage } = history
                                row.history = coverage
                                row.events.push(...events)
                                captured++
                            } else row.history = { ...row.history, state: 'insufficient', scope: 'shared' }
                        }))
                    }
                    historyHealth = {
                        source: 'history', state: 'complete', count: captured, checkedAt: now.toISOString(),
                        detail: 'Private shared refresh observations only, not continuous monitoring or an authoritative CRM audit. Source times and observed intervals are separate. Read retention: 180 days; at most 96 recent changes per record. Coverage advances if older changes are clipped.'
                    }
                } catch {
                    this.options.onError?.('history-unavailable')
                    for (const row of data.records) {
                        row.events = row.events.filter((event) => event.source === 'msx')
                        row.history = { state: 'unavailable', scope: 'unavailable', availableSince: null, lastObserved: null, observations: 0, maxGapDays: null }
                    }
                    historyHealth.detail = 'The configured secure shared history could not be read/captured. History is unavailable; current priorities are shown without inferred progress. Retry or contact the host administrator.'
                    data.complete = false
                }
            }
            data.sources.push(historyHealth)
        }
        if (owner && this.options.owner && momentumIdentity(await this.options.owner()) !== momentumIdentity(owner)) {
            return unavailable('unauthorized', 'The source identity changed during this read. Reconnect before opening private dashboard data.')
        }
        if (request.operation === 'load') return momentumFocusResponseSchema.parse({
            contractVersion: momentumFocusContractVersion, kind: 'dataset', ruleVersion: momentumRuleVersion,
            snapshotId: momentumSnapshotIdentity(data), asOf: now.toISOString(), data
        })
        const snapshot = buildMomentumSnapshot(data, request.query, now)
        if (request.operation !== 'detail') return momentumFocusResponseSchema.parse(snapshot)
        if (request.snapshotId !== snapshot.snapshotId) return unavailable('stale', 'The source snapshot or authorized scope changed. Refresh the dashboard before opening this item.')
        const item = selectMomentumRows(data, request.query, now).find((row) => row.key === request.recordKey)
        if (!item) return unavailable('forbidden', 'This item is not in the current authorized and filtered scope.')
        return momentumFocusResponseSchema.parse({
            contractVersion: momentumFocusContractVersion, kind: 'detail', snapshotId: snapshot.snapshotId,
            scopeKey: snapshot.scopeKey, queryKey: snapshot.queryKey, item
        })
    }
}

type LiveOptions = {
    mode: 'live'
    source: MomentumSource
    getToken(): Promise<string>
    sourceId?: string
    environment?: NodeJS.ProcessEnv
    credential?: TokenCredential
    excludedAccountIds?(): Promise<string[]>
    now?: () => Date
}
export function createMomentumFocusHost(options: { mode: 'sample' } | LiveOptions): MomentumFocusHost {
    if (options.mode === 'sample') return new SharedMomentumFocusHost({
        now: () => new Date(momentumSampleNow), collect: async (scope, industry) => ({ ...createMomentumFixture(industry), scope })
    })
    const sourceId = options.sourceId ?? 'https://microsoftsales.crm.dynamics.com'
    const collector = new LiveMomentumCollector(options.source, {
        sourceId, ...(options.now ? { now: options.now } : {}),
        ...(options.excludedAccountIds ? { excludedAccountIds: options.excludedAccountIds } : {})
    })
    const history = createMomentumHistoryRepository(options.environment ?? process.env, options.credential)
    return new SharedMomentumFocusHost({
        collect: (scope, industry) => collector.load(scope, industry), owner: () => momentumHistoryOwner(options.getToken, sourceId),
        ...(history ? { history } : {}), ...(options.now ? { now: options.now } : {}),
        onError: (code) => console.warn(`[momentum-focus] ${code}`)
    })
}
