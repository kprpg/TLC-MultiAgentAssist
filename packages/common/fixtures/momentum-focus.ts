import {
    momentumCollectionSchema, type MomentumCollection, type MomentumEvent, type MomentumRecord
} from '../contracts/momentum-focus.js'

export const momentumSampleNow = '2026-10-28T12:00:00Z'
export function createMomentumFixture(customerIndustry: MomentumCollection['customerIndustry'] = 'hls'): MomentumCollection {
    const history: MomentumRecord['history'] = {
        state: 'observed', scope: 'synthetic', availableSince: '2026-09-01T12:00:00Z',
        lastObserved: momentumSampleNow, observations: 28, maxGapDays: 3
    }
    const event = (id: string, kind: MomentumEvent['kind'], at = '2026-10-26T12:00:00Z'): MomentumEvent => ({
        id, kind, source: kind === 'commitment-recorded' || kind === 'loopback' ? 'observed' : 'msx',
        sourceAt: kind === 'commitment-recorded' || kind === 'loopback' ? null : at,
        observedAt: momentumSampleNow,
        intervalStart: kind === 'commitment-recorded' || kind === 'loopback' ? '2026-10-25T12:00:00Z' : null,
        intervalEnd: kind === 'commitment-recorded' || kind === 'loopback' ? at : null,
        field: null, from: null, to: null
    })
    const opportunity = (id: string, accountId: string, overrides: Partial<MomentumRecord> = {}): MomentumRecord => ({
        key: `opportunity:${id}`, id, entity: 'opportunity', name: `Synthetic ${id} opportunity`,
        accountId, accountName: `Synthetic ${accountId}`, opportunityId: id,
        stage: 'Listen & Consult', status: 'In Progress', ownerId: 'me', ownerName: 'Sample User',
        dueDate: '2026-11-20', value: { basis: 'pipeline', amount: 100_000, currency: 'USD' },
        active: true, onMyTeam: true, role: 'SSP', commitment: false, blocked: false, blockingMilestoneIds: [], plannedHold: false,
        sourceQuality: 'complete', sourceUpdatedAt: '2026-10-27T12:00:00Z',
        sourceUrl: null, history: structuredClone(history), events: [], ...overrides
    })
    const moving = opportunity('moving', 'harbor', {
        name: 'Synthetic proof decision', commitment: true, dueDate: '2026-10-30',
        events: [event('commitment-one', 'commitment-recorded'), event('moving-note', 'note')]
    })
    const busy = opportunity('busy', 'harbor', {
        name: 'Synthetic busy without movement', events: [
            event('busy-activity', 'activity'), event('busy-note', 'note'), event('busy-task', 'task'), event('busy-comment', 'forecast-comment')
        ]
    })
    const blocker = opportunity('blocker', 'cedar', {
        name: 'Synthetic quiet material blocker', dueDate: '2026-10-20', blocked: true,
        value: { basis: 'pipeline', amount: 900_000, currency: 'USD' }, role: 'both'
    })
    const hold = opportunity('hold', 'ridge', { plannedHold: true, status: 'On Hold', dueDate: '2026-11-15' })
    const loop = opportunity('loop', 'cedar', { events: [event('loop-context', 'loopback')], dueDate: '2026-11-10' })
    const unknown = opportunity('unknown', 'harbor', {
        name: 'Synthetic incomplete coverage', dueDate: null, stage: null, ownerId: null, ownerName: null,
        value: { basis: 'pipeline', amount: null, currency: null }, sourceQuality: 'unknown', onMyTeam: null,
        history: { state: 'insufficient', scope: 'synthetic', availableSince: momentumSampleNow, lastObserved: momentumSampleNow, observations: 1, maxGapDays: null }
    })
    const euro = opportunity('euro', 'ridge', { value: { basis: 'pipeline', amount: 80_000, currency: 'EUR' }, onMyTeam: false, ownerId: 'other' })
    const milestone = (id: string, parent: MomentumRecord, overrides: Partial<MomentumRecord> = {}): MomentumRecord => ({
        ...structuredClone(parent), key: `milestone:${id}`, id, entity: 'milestone', name: `Synthetic ${id} milestone`,
        opportunityId: parent.id, stage: parent.stage, status: 'On Track', role: 'SE', events: [],
        value: { basis: 'monthly-usage', amount: 5_000, currency: 'USD' }, ...overrides
    })
    return momentumCollectionSchema.parse({
        mode: 'sample', generatedAt: momentumSampleNow, scopeKey: 'synthetic-momentum-portfolio',
        scope: 'portfolio', customerIndustry, teamAvailable: true, complete: true,
        records: [moving, busy, blocker, hold, loop, unknown, euro,
            milestone('proof', moving), milestone('blocked-proof', loop, { blocked: true, status: 'Blocked' }),
            milestone('undated', unknown, { ownerId: 'other', ownerName: 'Other Sample User' }),
            milestone('euro-proof', euro, { value: { basis: 'monthly-usage', amount: 2_000, currency: 'EUR' } })],
        sources: [
            { source: 'portfolio', state: 'complete', detail: 'Fixed-clock synthetic MSX portfolio. No live records or inference.', count: 7, checkedAt: momentumSampleNow },
            { source: 'industry', state: 'complete', detail: customerIndustry === 'hls' ? 'Synthetic HLS portfolio: Health Payor, Health Pharma, Health Provider and MedTech classification; no company-name inference.' : 'All authorized synthetic customers explicitly selected.', count: 3, checkedAt: momentumSampleNow },
            { source: 'milestones', state: 'complete', detail: 'Synthetic milestone fixture.', count: 4, checkedAt: momentumSampleNow },
            { source: 'activities', state: 'complete', detail: 'Synthetic dated business metadata; activity is not progress.', count: 5, checkedAt: momentumSampleNow },
            { source: 'history', state: 'complete', detail: 'Synthetic observations since September 1; not live history.', count: 11, checkedAt: momentumSampleNow },
            { source: 'm365', state: 'unavailable', detail: 'M365 enrichment is not connected.', count: null, checkedAt: momentumSampleNow }
        ]
    })
}
