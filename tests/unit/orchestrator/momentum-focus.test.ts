import { describe, expect, it } from 'vitest'
import { momentumFocusQuerySchema } from '../../../packages/common/contracts/momentum-focus.js'
import { createMomentumFixture, momentumSampleNow } from '../../../packages/common/fixtures/momentum-focus.js'
import { buildMomentumSnapshot, focusDates } from '../../../packages/orchestrator/momentum-focus/analytics.js'

const now = new Date(momentumSampleNow)
const build = (filters: Record<string, unknown> = {}) => buildMomentumSnapshot(createMomentumFixture(), momentumFocusQuerySchema.parse(filters), now)

describe('Momentum deterministic analytics (MF-001 through MF-008)', () => {
    it('ranks a quiet overdue blocker ahead of a busy healthy opportunity and explains why', () => {
        const report = build()
        expect(report.rows[0]!.id).toBe('blocker')
        expect(report.rows[0]!.tier).toBe('act-now')
        expect(report.rows[0]!.reasons.some((reason) => reason.code === 'blocked')).toBe(true)
        expect(report.rows.find((row) => row.id === 'busy')!.progressCount).toBe(0)
        expect(report.rows.find((row) => row.id === 'moving')!.progressCount).toBe(1)
        expect(report.ruleVersion).toBe('momentum-rules-1')
    })
    it('deduplicates dated activity and progress by source identity, not refresh count', () => {
        const data = createMomentumFixture()
        const moving = data.records.find((row) => row.id === 'moving')!
        moving.events.push(structuredClone(moving.events[0]!))
        const report = buildMomentumSnapshot(data, momentumFocusQuerySchema.parse({}), now)
        expect(report.rows.find((row) => row.id === 'moving')!.progressCount).toBe(1)
        expect(report.rows.find((row) => row.id === 'moving')!.signalCount).toBe(1)
    })
    it('keeps unknown history out of the scatter plot and labels the unknown cohort', () => {
        const report = build()
        expect(report.charts.matrix.some((point) => point.id === 'unknown')).toBe(false)
        expect(report.charts.unknownHistoryKeys).toContain('opportunity:unknown')
        expect(report.rows.find((row) => row.id === 'unknown')!.progressCount).toBeNull()
        expect(report.rows.find((row) => row.id === 'unknown')!.tier).toBe('verify')
        expect(build({ lens: 'unknown-history' }).rows.every((row) => row.progressCount === null)).toBe(true)
    })
    it('shows advancing share and eligible denominators instead of rewarding account size', () => {
        const account = build().charts.accounts.find((row) => row.accountId === 'harbor')!
        expect(account).toMatchObject({ advancing: 1, eligible: 2, active: 3, advancingShare: 0.5 })
    })
    it('does not label a planned hold or a stage loopback as a loss', () => {
        for (const id of ['hold', 'loop']) {
            const row = build().rows.find((item) => item.id === id)!
            expect(row.reasons.some((reason) => reason.code === 'no-observed-progress')).toBe(false)
            expect(JSON.stringify(row.reasons)).not.toMatch(/failed|lost/i)
        }
    })
    it('classifies signals independently of progress and labels busy-without-movement', () => {
        const report = build({ lens: 'busy' })
        expect(report.rows.some((row) => row.id === 'busy')).toBe(true)
        expect(report.rows.every((row) => row.signalCount !== null && row.signalCount >= 3 && row.progressCount === 0)).toBe(true)
    })
    it('keeps totals and charts stable across table pages', () => {
        const first = build({ pageSize: 2 })
        const second = build({ pageSize: 2, page: 2 })
        expect(first.rows).toHaveLength(2)
        expect(first.total).toBeGreaterThan(2)
        expect(second.rows).not.toEqual(first.rows)
        expect(second.charts).toEqual(first.charts)
        expect(second.summary).toEqual(first.summary)
    })
    it('cross-filters canonical hierarchy, entity status, owner and source quality', () => {
        const report = build({ accountIds: ['harbor'], opportunityIds: ['moving'], entity: 'milestone', milestoneStatuses: ['On Track'], ownerIds: ['me'] })
        expect(report.rows.map((row) => row.id)).toEqual(['proof'])
        expect(build({ sourceQuality: ['unknown'] }).rows.map((row) => row.id)).toContain('unknown')
        expect(build({ scope: 'mine' }).rows.every((row) => row.onMyTeam === true)).toBe(true)
    })
    it('never sums pipeline and monthly rates or unlike currencies', () => {
        const report = build()
        expect(report.charts.values.every((group) => group.currency !== null)).toBe(true)
        expect(report.charts.values.some((group) => group.basis === 'pipeline' && group.currency === 'EUR')).toBe(true)
        const monthly = build({ basis: 'monthly-usage', currency: 'USD', heatmap: 'value' })
        expect(monthly.charts.values.every((group) => group.basis === 'monthly-usage' && group.currency === 'USD')).toBe(true)
        expect(monthly.charts.heatmap.every((cell) => cell.unit === 'USD/month')).toBe(true)
    })
    it('retains undated/unknown records unless explicitly excluded and never invents CRM deadlines', () => {
        expect(build().rows.some((row) => row.id === 'unknown' && row.dueDate === null && row.reviewDate !== null)).toBe(true)
        expect(build({ includeUndated: false }).rows.every((row) => row.dueDate !== null)).toBe(true)
        expect(build({ deadline: 'undated' }).rows.every((row) => row.dueDate === null)).toBe(true)
    })
    it('does not count an observed transition whose interval straddles the lookback boundary', () => {
        const data = createMomentumFixture()
        const row = data.records.find((item) => item.id === 'moving')!
        row.events[0]!.intervalStart = '2026-08-01T12:00:00Z'
        expect(buildMomentumSnapshot(data, momentumFocusQuerySchema.parse({}), now).rows.find((item) => item.id === 'moving')!.progressCount).toBe(0)
    })
    it('keeps focus and evidence windows independent and tie-breaks deterministic', () => {
        expect(build({ focus: 'month' }).evidenceWindow).toEqual(build({ focus: 'week' }).evidenceWindow)
        expect(build()).toEqual(build())
        expect(build({ role: 'SE' }).rows.some((row) => row.id === 'blocker')).toBe(true)
    })
    it('does not turn two recent observations into a complete historical denominator or a zero-progress dot', () => {
        const data = createMomentumFixture()
        const row = data.records.find((item) => item.id === 'busy')!
        row.history = { ...row.history, observations: 2, availableSince: '2026-10-27T12:00:00Z' }
        const report = buildMomentumSnapshot(data, momentumFocusQuerySchema.parse({}), now)
        expect(report.rows.find((item) => item.id === 'busy')!.progressCount).toBeNull()
        expect(report.charts.accounts.find((item) => item.accountId === 'harbor')!.eligible).toBe(1)
        expect(report.charts.matrix.some((item) => item.id === 'busy')).toBe(false)
    })
    it('does not infer 30-day stagnation from a shorter selected evidence window', () => {
        const data = createMomentumFixture()
        const row = data.records.find((item) => item.id === 'moving')!
        row.events[0]!.intervalStart = '2026-10-07T12:00:00Z'
        row.events[0]!.intervalEnd = '2026-10-08T12:00:00Z'
        const report = buildMomentumSnapshot(data, momentumFocusQuerySchema.parse({ lookbackDays: 7 }), now)
        expect(report.rows.find((item) => item.id === 'moving')!.reasons.some((reason) => reason.code === 'no-observed-progress')).toBe(false)
    })
    it('does not call stale or widely gapped history a fully observed comparison cohort', () => {
        const data = createMomentumFixture()
        data.records.find((item) => item.id === 'busy')!.history.maxGapDays = 45
        data.records.find((item) => item.id === 'euro')!.history.lastObserved = '2026-10-01T12:00:00Z'
        const report = buildMomentumSnapshot(data, momentumFocusQuerySchema.parse({}), now)
        expect(report.rows.find((item) => item.id === 'busy')!.progressCount).toBeNull()
        expect(report.rows.find((item) => item.id === 'euro')!.progressCount).toBeNull()
    })
    it('retains independently verified movement as a labelled partial cohort, not a fully observed share', () => {
        const report = build({ lookbackDays: 90 })
        const row = report.rows.find((item) => item.id === 'moving')!
        expect(row.progressCount).toBe(1)
        expect(report.charts.accounts.find((item) => item.accountId === 'harbor')!.eligible).toBe(0)
        expect(report.charts.matrix.find((item) => item.id === 'moving')).toMatchObject({ coverage: 'partial' })
    })
    it('makes snapshot identity independent of source row/event ordering and does not duplicate timeline references', () => {
        const data = createMomentumFixture()
        const original = buildMomentumSnapshot(data, momentumFocusQuerySchema.parse({}), now)
        data.records.reverse()
        for (const row of data.records) row.events.reverse()
        expect(buildMomentumSnapshot(data, momentumFocusQuerySchema.parse({}), now).snapshotId).toBe(original.snapshotId)
        const moving = data.records.find((row) => row.id === 'moving')!
        moving.events.push(structuredClone(moving.events[0]!))
        const row = buildMomentumSnapshot(data, momentumFocusQuerySchema.parse({}), now).rows.find((item) => item.id === 'moving')!
        expect(new Set(row.events.map((event) => `${event.source}:${event.id}`)).size).toBe(row.events.length)
    })
    it('compares dated signal recency as instants rather than offset timestamp text', () => {
        const data = createMomentumFixture()
        const row = data.records.find((item) => item.id === 'busy')!
        row.events[0]!.sourceAt = '2026-10-27T10:00:00-05:00'
        row.events[1]!.sourceAt = '2026-10-27T13:00:00Z'
        const report = buildMomentumSnapshot(data, momentumFocusQuerySchema.parse({}), now)
        expect(report.rows.find((item) => item.id === 'busy')!.latestSignal).toBe('2026-10-27T15:00:00.000Z')
    })
    it('recognizes qualified child milestone progress without requiring a parent stage change or double-counting account traction', () => {
        const data = createMomentumFixture()
        const parent = data.records.find((row) => row.id === 'moving')!
        const child = data.records.find((row) => row.id === 'proof')!
        const completed = structuredClone(parent.events[0]!)
        completed.id = 'qualified-child-completion'
        completed.kind = 'milestone-completed'
        child.events = [completed]
        child.status = 'Completed'
        child.active = false
        parent.events = []
        const report = buildMomentumSnapshot(data, momentumFocusQuerySchema.parse({}), now)
        const row = report.rows.find((item) => item.id === 'moving')!
        expect(row.progressCount).toBe(1)
        expect(row.reasons.some((reason) => reason.code === 'no-observed-progress')).toBe(false)
        expect(row.events).toContainEqual(expect.objectContaining({ id: 'qualified-child-completion', relatedRecordKey: 'milestone:proof' }))
        expect(report.charts.accounts.find((account) => account.accountId === 'harbor')).toMatchObject({ advancing: 1, progressCount: 1 })
    })
    it.each([
        ['2026-11-01T07:30:00Z', 'America/Los_Angeles', '2026-10-26', '2026-11-01', '2026-11-30'],
        ['2026-03-08T09:30:00Z', 'America/Los_Angeles', '2026-03-02', '2026-03-08', '2026-03-31'],
        ['2027-01-01T01:00:00Z', 'America/Los_Angeles', '2026-12-28', '2027-01-03', '2026-12-31'],
        ['2026-10-31T23:30:00Z', 'Asia/Kolkata', '2026-10-26', '2026-11-01', '2026-11-30']
    ])('uses timezone-local dates, Monday weeks, month ends and DST at %s', (instant, timezone, weekStart, weekEnd, monthEnd) => {
        expect(focusDates(new Date(instant), timezone)).toMatchObject({ weekStart, weekEnd, monthEnd })
    })
})
