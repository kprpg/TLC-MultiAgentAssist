import {
    momentumFocusContractVersion, momentumRuleVersion, momentumProgressKinds, momentumSnapshotSchema,
    type MomentumCollection, type MomentumEvent, type MomentumFocusQuery, type MomentumPriority, type MomentumRecord, type MomentumSnapshot
} from '../contracts/momentum-focus.js'

const dayMs = 86_400_000
const dateOnly = (value: Date) => value.toISOString().slice(0, 10)
const addDays = (value: string, days: number) => dateOnly(new Date(Date.parse(`${value}T12:00:00Z`) + days * dayMs))
export function focusDates(now: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value
    const today = `${get('year')}-${get('month')}-${get('day')}`
    const day = new Date(`${today}T12:00:00Z`)
    const weekStart = addDays(today, -((day.getUTCDay() + 6) % 7))
    return {
        today, weekStart, weekEnd: addDays(weekStart, 6), monthStart: `${today.slice(0, 7)}-01`,
        monthEnd: dateOnly(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0, 12)))
    }
}
type Calendar = ReturnType<typeof focusDates>
function deadlineFor(row: MomentumRecord, dates: Calendar): MomentumPriority['deadline'] {
    if (!row.dueDate) return 'undated'
    if (row.dueDate < dates.today) return 'overdue'
    if (row.dueDate <= dates.weekEnd) return 'this-week'
    if (row.dueDate <= dates.monthEnd) return 'rest-of-month'
    return 'later'
}
const progressKinds: ReadonlySet<string> = new Set(momentumProgressKinds)
const signalKinds = new Set(['activity', 'note', 'task', 'forecast-comment'])
function windowEvents(row: MomentumRecord, since: string, now: string): MomentumEvent[] {
    const unique = new Map<string, MomentumEvent>()
    for (const event of row.events) {
        // An observation interval is not a precise event time; boundary-straddling changes are not counted.
        const from = event.sourceAt ?? event.intervalStart
        const to = event.sourceAt ?? event.intervalEnd
        if (from && to && Date.parse(from) >= Date.parse(since) && Date.parse(to) <= Date.parse(now)) {
            unique.set(`${event.source}:${event.id}`, event)
        }
    }
    return [...unique.values()]
}
const latest = (events: MomentumEvent[]) => events.map((event) => event.sourceAt ?? event.intervalEnd)
    .filter((at): at is string => at !== null).map((at) => new Date(at).toISOString()).sort().at(-1) ?? null
function priority(row: MomentumRecord, query: MomentumFocusQuery, dates: Calendar, now: Date): MomentumPriority {
    const nowIso = now.toISOString()
    const since = new Date(now.getTime() - query.lookbackDays * dayMs).toISOString()
    const events = windowEvents(row, since, nowIso)
    const progress = events.filter((event) => progressKinds.has(event.kind))
    const signals = events.filter((event) => signalKinds.has(event.kind))
    const historyKnown = row.history.state === 'observed' || row.history.state === 'authoritative'
    const covers = (days: number) => historyKnown && row.history.availableSince !== null &&
        Date.parse(row.history.availableSince) <= now.getTime() - days * dayMs &&
        row.history.lastObserved !== null && Date.parse(row.history.lastObserved) >= now.getTime() - dayMs &&
        (row.history.state === 'authoritative' || row.history.observations > 1 && row.history.maxGapDays !== null && row.history.maxGapDays <= 14)
    const historyCoverage: MomentumPriority['historyCoverage'] = covers(query.lookbackDays) ? 'sufficient'
        : historyKnown || progress.length > 0 ? 'partial' : 'unknown'
    const progressCount = historyCoverage === 'sufficient' ? progress.length : progress.length > 0 ? progress.length : null
    const signalCount = row.sourceQuality === 'complete' || signals.length > 0 ? signals.length : null
    const candidate = row.active !== false
    const reasons: MomentumPriority['reasons'] = []
    const reason = (code: string, text: string) => reasons.push({ code, text })
    const timeline = [...new Map(row.events.map((event) => [`${event.source}:${event.id}`, event])).values()]
        .sort((a, b) => Date.parse(b.sourceAt ?? b.intervalEnd ?? b.observedAt) - Date.parse(a.sourceAt ?? a.intervalEnd ?? a.observedAt) || a.id.localeCompare(b.id))
    if (timeline.length > 1_000) reason('timeline-capped', 'The first 1,000 evidence references are shown. Qualified counts use the full collected event set.')
    const deadline = deadlineFor(row, dates)
    const loopback = events.some((event) => event.kind === 'loopback')
    const slipped = events.some((event) => event.kind === 'date-slipped')
    const inFocus = row.dueDate !== null && row.dueDate >= (query.focus === 'custom' ? query.from! : query.focus === 'month' ? dates.monthStart : dates.weekStart) &&
        row.dueDate <= (query.focus === 'custom' ? query.to! : query.focus === 'month' ? dates.monthEnd : dates.weekEnd)
    if (candidate && deadline === 'overdue') reason('overdue', `Recorded ${row.entity === 'milestone' ? 'target' : 'close'} date ${row.dueDate} is overdue.`)
    if (candidate && row.blocked) reason('blocked', row.blockingMilestoneIds.length > 0
        ? `An authorized child milestone records a blocker (${row.blockingMilestoneIds.length} linked records). A dependency decision is needed.`
        : 'The source records a blocker. A decision or dependency check is needed.')
    if (candidate && inFocus) reason('focus-date', 'The recorded deadline falls inside the selected focus horizon.')
    if (row.active === null) reason('state-unknown', 'The source activity state is unknown. Verify it; this record is not counted as a confirmed active opportunity.')
    if (slipped) reason('date-slipped', 'A later recorded date was observed; date pushes are not positive progress.')
    if (loopback) reason('loopback', 'A stage loopback was observed. MCEM iteration is context, not a loss.')
    if (row.plannedHold) reason('planned-hold', 'The source records a planned hold; confirm the next checkpoint rather than infer failure.')
    if (progress.length > 0) reason('progress', `${progress.length} distinct qualified movement event${progress.length === 1 ? '' : 's'} in the evidence window.`)
    if (historyCoverage === 'unknown') reason('history-unknown', 'Insufficient history. Current fields do not establish past movement.')
    if (historyCoverage === 'partial') reason('history-partial', 'Partial history for this evidence window. Verified events are lower bounds, not a fully observed comparison cohort.')
    const reviewEvents = windowEvents(row, new Date(now.getTime() - 30 * dayMs).toISOString(), nowIso)
    if (candidate && covers(30) && !reviewEvents.some((event) => progressKinds.has(event.kind) || event.kind === 'loopback') && !row.plannedHold) {
        reason('no-observed-progress', 'No progress in captured observations over the review window. Refresh capture is not continuous monitoring.')
    }
    if (candidate && signalCount !== null && signalCount >= 3 && progressCount === 0) {
        reason('busy-without-movement', 'Multiple dated business signals, but no verified movement in captured evidence.')
    }
    const latestSignal = latest(windowEvents(row, '1970-01-01T00:00:00Z', nowIso).filter((event) => signalKinds.has(event.kind)))
    if (candidate && row.sourceQuality === 'complete' && (latestSignal ? (now.getTime() - Date.parse(latestSignal)) / dayMs >= 14 : covers(14)) && !row.plannedHold) {
        reason('inactive', 'No recent dated business signal within the 14-day review threshold in the connected sources.')
    }
    if (row.dueDate === null) reason('undated', 'The recorded deadline is unknown. The suggested review date is not a CRM deadline.')
    if (row.sourceQuality !== 'complete') reason('coverage', 'Source coverage is incomplete; absence of evidence is not evidence of no work.')
    if (row.active === false) reason('closed', 'This source record is not active; retained for context, not an urgent work item.')
    const needsReview = candidate && reasons.some((item) => ['blocked', 'overdue', 'date-slipped', 'no-observed-progress', 'inactive', 'coverage', 'history-unknown', 'history-partial', 'undated', 'state-unknown'].includes(item.code))
    const tier: MomentumPriority['tier'] = !candidate ? 'verify'
        : deadline === 'overdue' || row.blocked === true ? 'act-now'
            : deadline === 'this-week' ? 'this-week'
                : deadline === 'rest-of-month' || inFocus ? 'plan-month' : 'verify'
    const accountableRole = row.entity === 'milestone' || query.role === 'SE' ? 'Solution Engineer / CSA / CSAM' : 'Specialist / SSP'
    const nextAction = row.blocked ? `Confirm the dependency and accountable ${accountableRole} handoff.`
        : row.plannedHold ? 'Confirm the planned hold and next agreed checkpoint.'
            : query.role === 'SE' ? 'Verify technical proof/readiness evidence and agree the next checkpoint.'
                : 'Confirm the next commercial decision or commitment with the accountable Specialist.'
    return {
        ...row, events: timeline.slice(0, 1_000),
        tier, deadline, reviewDate: row.dueDate === null && candidate ? dates.today : null,
        progressCount, historyCoverage, signalCount, signalTypes: [...new Set(signals.map((event) => event.kind))],
        latestSignal, latestProgress: latest(progress), reasons, nextAction, accountableRole, needsReview
    }
}
function matches(row: MomentumPriority, query: MomentumFocusQuery, dates: Calendar): boolean {
    const selected = (values: string[], value: string | null) => values.length === 0 || values.includes(value ?? 'Unknown')
    if (query.scope === 'mine' && row.onMyTeam !== true) return false
    if (!selected(query.accountIds, row.accountId) || !selected(query.opportunityIds, row.opportunityId) ||
        query.milestoneIds.length > 0 && (row.entity !== 'milestone' || !query.milestoneIds.includes(row.id))) return false
    if (query.entity !== 'all' && row.entity !== query.entity || !selected(query.stages, row.stage) || !selected(query.ownerIds, row.ownerId)) return false
    if (!selected(row.entity === 'milestone' ? query.milestoneStatuses : query.opportunityStatuses, row.status)) return false
    if (query.sourceQuality.length > 0 && !query.sourceQuality.includes(row.sourceQuality)) return false
    if (query.basis !== 'all' && row.value.basis !== query.basis || query.currency && row.value.currency !== query.currency) return false
    if (query.minValue !== undefined && (row.value.amount === null || row.value.amount < query.minValue) ||
        query.maxValue !== undefined && (row.value.amount === null || row.value.amount > query.maxValue)) return false
    if (!query.includeUndated && !row.dueDate || row.dueDate && (query.dateFrom && row.dueDate < query.dateFrom || query.dateTo && row.dueDate > query.dateTo)) return false
    if (query.deadline && row.deadline !== query.deadline) return false
    if (query.lens === 'advancing' && !(row.progressCount !== null && row.progressCount > 0) ||
        query.lens === 'review' && !row.needsReview ||
        query.lens === 'busy' && !(row.signalCount !== null && row.signalCount >= 3 && row.progressCount === 0) ||
        query.lens === 'weekly' && !(row.active !== false && (row.deadline === 'overdue' || row.deadline === 'this-week')) ||
        query.lens === 'monthly' && !(row.active !== false && row.entity === 'milestone' && row.dueDate && row.dueDate <= dates.monthEnd) ||
        query.lens === 'history' && row.progressCount === null ||
        query.lens === 'unknown-history' && row.progressCount !== null) return false
    return true
}
const tierOrder: Record<MomentumPriority['tier'], number> = { 'act-now': 0, 'this-week': 1, 'plan-month': 2, verify: 3 }
function withMilestoneProgress(records: MomentumRecord[]): MomentumRecord[] {
    const children = new Map<string, MomentumRecord[]>()
    for (const row of records) if (row.entity === 'milestone') {
        const group = children.get(row.opportunityId) ?? []
        group.push(row)
        children.set(row.opportunityId, group)
    }
    return records.map((row) => {
        const milestones = row.entity === 'opportunity' ? children.get(row.id) : undefined
        if (!milestones?.length) return row
        const histories = [row.history, ...milestones.map((milestone) => milestone.history)]
        const times = (field: 'availableSince' | 'lastObserved') => histories.map((history) => history[field])
            .filter((value): value is string => value !== null).map((value) => Date.parse(value))
        const starts = times('availableSince'), ends = times('lastObserved')
        return {
            ...row,
            history: {
                state: histories.every((history) => history.state === 'authoritative') ? 'authoritative'
                    : histories.every((history) => history.state === 'observed' || history.state === 'authoritative') ? 'observed' : 'insufficient',
                scope: histories.every((history) => history.scope === row.history.scope) ? row.history.scope : 'unavailable',
                availableSince: starts.length === histories.length ? new Date(Math.max(...starts)).toISOString() : null,
                lastObserved: ends.length === histories.length ? new Date(Math.min(...ends)).toISOString() : null,
                observations: Math.min(...histories.map((history) => history.observations)),
                maxGapDays: histories.every((history) => history.maxGapDays !== null) ? Math.max(...histories.map((history) => history.maxGapDays!)) : null
            },
            events: [...row.events, ...milestones.flatMap((milestone) => milestone.events.filter((event) => progressKinds.has(event.kind))
                .map((event) => ({ ...event, relatedRecordKey: milestone.key })))]
        }
    })
}
export function selectMomentumRows(data: MomentumCollection, query: MomentumFocusQuery, now: Date): MomentumPriority[] {
    const dates = focusDates(now, query.timezone)
    const roleRank = (row: MomentumRecord) => row.role === query.role || row.role === 'both' ? 0 : 1
    return withMilestoneProgress(data.records).map((row) => priority(row, query, dates, now)).filter((row) => matches(row, query, dates)).sort((left, right) => {
        const tier = tierOrder[left.tier] - tierOrder[right.tier]
        const urgency = (left.dueDate ?? '9999-12-31').localeCompare(right.dueDate ?? '9999-12-31')
        const relevance = roleRank(left) - roleRank(right)
        // Only comparable monetary units may influence ordering.
        const unit = `${left.value.basis}:${left.value.currency ?? 'Unknown'}`.localeCompare(`${right.value.basis}:${right.value.currency ?? 'Unknown'}`)
        const impact = unit === 0 && left.value.currency !== null
            ? Math.floor(Math.log10(Math.max(1, right.value.amount ?? 0))) - Math.floor(Math.log10(Math.max(1, left.value.amount ?? 0))) : 0
        return tier || urgency || relevance || unit || impact || Number(right.commitment === true) - Number(left.commitment === true) ||
            (right.latestSignal ?? '').localeCompare(left.latestSignal ?? '') || left.key.localeCompare(right.key)
    })
}
function charts(rows: MomentumPriority[], query: MomentumFocusQuery): MomentumSnapshot['charts'] {
    const accounts = new Map<string, MomentumSnapshot['charts']['accounts'][number]>()
    const heatmap = new Map<string, MomentumSnapshot['charts']['heatmap'][number]>()
    const values = new Map<string, MomentumSnapshot['charts']['values'][number]>()
    const deadlines: MomentumSnapshot['charts']['deadlines'] = (['overdue', 'this-week', 'rest-of-month', 'later', 'undated'] as const)
        .map((bucket) => ({ bucket, opportunities: 0, milestones: 0 }))
    let unknownValues = 0
    for (const row of rows) {
        const accountKey = row.accountId ?? 'Unknown'
        let account = accounts.get(accountKey)
        if (!account) {
            account = { accountId: row.accountId, name: row.accountName ?? 'Unknown account', advancing: 0, eligible: 0, active: 0, advancingShare: null,
                progressCount: 0, signalCount: 0, reviewCount: 0, latestMovement: null }
            accounts.set(accountKey, account)
        }
        account.signalCount += row.signalCount ?? 0
        account.reviewCount += Number(row.needsReview)
        if (row.entity === 'opportunity' && row.active) {
            account.active++
            const eligible = row.historyCoverage === 'sufficient' && row.status !== null
            account.eligible += Number(eligible)
            account.advancing += Number(eligible && row.progressCount !== null && row.progressCount > 0)
            account.progressCount += row.progressCount ?? 0
            if (row.latestProgress && (!account.latestMovement || row.latestProgress > account.latestMovement)) account.latestMovement = row.latestProgress
        }
        const deadline = deadlines.find((item) => item.bucket === row.deadline)!
        if (row.entity === 'milestone') deadline.milestones++
        else deadline.opportunities++
        if (row.entity === 'milestone') {
            const stage = row.stage ?? 'Unknown stage', status = row.status ?? 'Unknown status'
            const key = JSON.stringify([stage, status])
            const cell = heatmap.get(key) ?? { stage, status, count: 0, value: null, unit: query.heatmap === 'value' ? `${query.currency}/month` : 'milestones', missingValues: 0 }
            cell.count++
            if (query.heatmap === 'value' && row.value.amount !== null && row.value.currency === query.currency) cell.value = (cell.value ?? 0) + row.value.amount
            else if (query.heatmap === 'value') cell.missingValues++
            heatmap.set(key, cell)
        }
        if (row.value.amount === null || row.value.currency === null) unknownValues++
        else {
            const key = `${row.value.basis}:${row.value.currency}`
            const group = values.get(key) ?? { basis: row.value.basis, currency: row.value.currency, amount: 0, records: 0 }
            group.amount += row.value.amount
            group.records++
            values.set(key, group)
        }
    }
    for (const account of accounts.values()) account.advancingShare = account.eligible ? account.advancing / account.eligible : null
    const accountRows = [...accounts.values()].sort((a, b) => query.accountSort === 'activity' ? b.signalCount - a.signalCount || a.name.localeCompare(b.name)
        : query.accountSort === 'review' ? b.reviewCount - a.reviewCount || a.name.localeCompare(b.name)
            : (b.advancingShare ?? -1) - (a.advancingShare ?? -1) || b.progressCount - a.progressCount || a.name.localeCompare(b.name))
    return {
        matrix: rows.filter((row) => row.progressCount !== null).map((row) => ({
            key: row.key, id: row.id, entity: row.entity, name: row.name, progressCount: row.progressCount!,
            coverage: row.historyCoverage,
            signalCount: row.signalCount, amount: query.currency && query.basis !== 'all' ? row.value.amount : null,
            basis: row.value.basis, currency: row.value.currency
        })),
        unknownHistoryKeys: rows.filter((row) => row.progressCount === null).map((row) => row.key),
        accounts: accountRows, heatmap: [...heatmap.values()].sort((a, b) => a.stage.localeCompare(b.stage) || a.status.localeCompare(b.status)),
        deadlines, values: [...values.values()].sort((a, b) => a.basis.localeCompare(b.basis) || a.currency.localeCompare(b.currency)), unknownValues
    }
}
export type PreparedMomentumView = Omit<MomentumSnapshot, 'snapshotId' | 'queryKey' | 'query' | 'rows'> & { rows: MomentumPriority[] }
const viewMetadataSchema = momentumSnapshotSchema.omit({ snapshotId: true, queryKey: true, query: true, rows: true })

export function prepareMomentumView(data: MomentumCollection, query: MomentumFocusQuery, now: Date): PreparedMomentumView {
    const dates = focusDates(now, query.timezone)
    const rows = selectMomentumRows(data, query, now)
    const chartData = charts(rows, query)
    const named = (rows: Array<{ id: string | null; name: string | null }>) => [...new Map(rows.map((row) =>
        [row.id ?? 'Unknown', { id: row.id ?? 'Unknown', name: row.name ?? 'Unknown' }])).values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    const distinct = (rows: Array<string | null>) => [...new Set(rows.map((value) => value ?? 'Unknown'))].sort()
    const metadata = viewMetadataSchema.parse({
        contractVersion: momentumFocusContractVersion, kind: 'snapshot', ruleVersion: momentumRuleVersion,
        mode: data.mode, generatedAt: data.generatedAt, scopeKey: data.scopeKey,
        scope: query.scope, customerIndustry: data.customerIndustry, teamAvailable: data.teamAvailable, complete: data.complete, sources: data.sources,
        focusWindow: { from: query.focus === 'custom' ? query.from : query.focus === 'month' ? dates.monthStart : dates.weekStart,
            to: query.focus === 'custom' ? query.to : query.focus === 'month' ? dates.monthEnd : dates.weekEnd },
        evidenceWindow: { from: new Date(now.getTime() - query.lookbackDays * dayMs).toISOString(), to: now.toISOString() },
        total: rows.length,
        summary: {
            advancingAccounts: chartData.accounts.filter((account) => account.accountId !== null && account.advancing > 0).length,
            weeklyPriorities: rows.filter((row) => row.active !== false && (row.deadline === 'overdue' || row.deadline === 'this-week')).length,
            monthlyMilestones: rows.filter((row) => row.active !== false && row.entity === 'milestone' && row.dueDate && row.dueDate <= dates.monthEnd).length,
            reviewCandidates: rows.filter((row) => row.needsReview).length,
            busyWithoutMovement: rows.filter((row) => row.signalCount !== null && row.signalCount >= 3 && row.progressCount === 0).length,
            usableHistory: rows.filter((row) => row.progressCount !== null).length, totalRecords: rows.length
        },
        facets: {
            accounts: named(data.records.map((row) => ({ id: row.accountId, name: row.accountName }))),
            opportunities: named(data.records.filter((row) => row.entity === 'opportunity').map((row) => ({ id: row.id, name: row.name }))),
            milestones: named(data.records.filter((row) => row.entity === 'milestone').map((row) => ({ id: row.id, name: row.name }))),
            owners: named(data.records.map((row) => ({ id: row.ownerId, name: row.ownerName ?? row.ownerId }))),
            stages: distinct(data.records.map((row) => row.stage)),
            opportunityStatuses: distinct(data.records.filter((row) => row.entity === 'opportunity').map((row) => row.status)),
            milestoneStatuses: distinct(data.records.filter((row) => row.entity === 'milestone').map((row) => row.status)),
            currencies: [...new Set(data.records.map((row) => row.value.currency).filter((value): value is string => value !== null))].sort()
        }, charts: chartData
    })
    return { ...metadata, rows }
}

export function pageMomentumView(view: PreparedMomentumView, query: MomentumFocusQuery, identity: Pick<MomentumSnapshot, 'snapshotId' | 'queryKey'>): MomentumSnapshot {
    return { ...view, ...identity, query, rows: view.rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) }
}
