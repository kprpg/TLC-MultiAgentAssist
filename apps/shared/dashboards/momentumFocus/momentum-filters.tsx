import type { MomentumFocusQuery, MomentumSnapshot } from '../../../../packages/common/contracts/momentum-focus.js'
import { MultiSelect } from '../dashboard-controls.js'

type Props = {
    query: MomentumFocusQuery
    facets?: MomentumSnapshot['facets'] | undefined
    teamAvailable: boolean
    onChange(changes: Partial<MomentumFocusQuery>): void
}
type MultiKey = 'accountIds' | 'opportunityIds' | 'milestoneIds' | 'stages' | 'ownerIds' | 'opportunityStatuses' | 'milestoneStatuses'
export function MomentumFilters({ query, facets, teamAvailable, onChange }: Props) {
    const options = (values: string[] | undefined) => values?.map((value) => ({ id: value, name: value })) ?? []
    const allLabels: Record<MultiKey, string> = {
        accountIds: 'All customers', opportunityIds: 'All opportunities', milestoneIds: 'All milestones',
        stages: 'All stages', ownerIds: 'All owners', opportunityStatuses: 'Opportunity status', milestoneStatuses: 'Milestone status'
    }
    const multi = (title: string, key: MultiKey, values: Array<{ id: string; name: string }> = []) =>
        <MultiSelect key={key} label={title} allLabel={allLabels[key]} selected={query[key]}
            options={values.map((value) => ({ value: value.id, label: value.name }))} onChange={(selected) => onChange({ [key]: selected })} />
    const clear = () => onChange({
        accountIds: [], opportunityIds: [], milestoneIds: [], stages: [], opportunityStatuses: [], milestoneStatuses: [], ownerIds: [],
        sourceQuality: [], entity: 'all', basis: 'all', currency: undefined, minValue: undefined, maxValue: undefined,
        dateFrom: undefined, dateTo: undefined, includeUndated: true, lens: 'all', deadline: undefined, heatmap: 'count', page: 1
    })
    const chips: Array<{ label: string; remove(): void }> = []
    const groups: Array<[MultiKey, Array<{ id: string; name: string }> | undefined]> = [
        ['accountIds', facets?.accounts], ['opportunityIds', facets?.opportunities], ['milestoneIds', facets?.milestones],
        ['stages', options(facets?.stages)], ['ownerIds', facets?.owners],
        ['opportunityStatuses', options(facets?.opportunityStatuses)], ['milestoneStatuses', options(facets?.milestoneStatuses)]
    ]
    for (const [key, values] of groups) for (const id of query[key]) chips.push({
        label: values?.find((value) => value.id === id)?.name ?? id,
        remove: () => onChange({ [key]: query[key].filter((value) => value !== id) })
    })
    if (query.lens !== 'all') chips.push({ label: `${query.lens} lens`, remove: () => onChange({ lens: 'all' }) })
    if (query.deadline) chips.push({ label: `${query.deadline} deadlines`, remove: () => onChange({ deadline: undefined }) })
    if (query.entity !== 'all') chips.push({ label: query.entity, remove: () => onChange({ entity: 'all' }) })
    if (query.basis !== 'all') chips.push({ label: query.basis, remove: () => onChange({ basis: 'all', heatmap: 'count', minValue: undefined, maxValue: undefined }) })
    if (query.currency) chips.push({ label: query.currency, remove: () => onChange({ currency: undefined, heatmap: 'count', minValue: undefined, maxValue: undefined }) })
    if (query.minValue !== undefined || query.maxValue !== undefined) chips.push({ label: `Value ${query.minValue ?? 'any'} to ${query.maxValue ?? 'any'}`, remove: () => onChange({ minValue: undefined, maxValue: undefined }) })
    if (query.dateFrom || query.dateTo) chips.push({ label: `Dates ${query.dateFrom ?? 'any'} to ${query.dateTo ?? 'any'}`, remove: () => onChange({ dateFrom: undefined, dateTo: undefined }) })
    if (query.sourceQuality.length > 0) chips.push({ label: `${query.sourceQuality.join(', ')} sources`, remove: () => onChange({ sourceQuality: [] }) })
    if (!query.includeUndated) chips.push({ label: 'Dated only', remove: () => onChange({ includeUndated: true }) })
    return <>
        <div className="momentum-context">
            <label>Customer industry<select aria-label="Customer industry" value={query.customerIndustry} onChange={(event) => onChange({
                customerIndustry: event.currentTarget.value === 'all' ? 'all' : 'hls', accountIds: [], opportunityIds: [], milestoneIds: []
            })}><option value="hls">HLS Customers only</option><option value="all">All authorized customers</option></select></label>
            <label>Role preset<select aria-label="Role preset" value={query.role} onChange={(event) => onChange({ role: event.currentTarget.value === 'SE' ? 'SE' : 'SSP' })}>
                <option value="SSP">SSP - commercial decisions</option><option value="SE">SE - technical proof</option>
            </select></label>
            <label>Portfolio scope<select aria-label="Portfolio scope" value={query.scope} onChange={(event) => onChange({ scope: event.currentTarget.value === 'mine' ? 'mine' : event.currentTarget.value === 'team' ? 'team' : 'portfolio' })}>
                <option value="portfolio">Authorized portfolio</option><option value="mine">My work (verified IDs)</option>
                <option value="team" disabled={!teamAvailable}>Permitted Team</option>
            </select></label>
            <label>Focus horizon<select aria-label="Focus horizon" value={query.focus} onChange={(event) => {
                const focus = event.currentTarget.value === 'custom' ? 'custom' : event.currentTarget.value === 'month' ? 'month' : 'week'
                const today = new Date().toISOString().slice(0, 10)
                onChange({ focus, ...(focus === 'custom' ? { from: query.from ?? today, to: query.to ?? today } : {}) })
            }}><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom dates</option></select></label>
            <label>Evidence lookback<select aria-label="Evidence lookback" value={query.lookbackDays} onChange={(event) => onChange({ lookbackDays: event.currentTarget.value === '7' ? 7 : event.currentTarget.value === '14' ? 14 : event.currentTarget.value === '90' ? 90 : 30 })}>
                {[7, 14, 30, 90].map((days) => <option value={days} key={days}>{days} days</option>)}
            </select></label>
            {query.focus === 'custom' && <>
                <label>Focus start<input aria-label="Focus start" type="date" value={query.from ?? ''} onChange={(event) => onChange({ from: event.currentTarget.value })} /></label>
                <label>Focus end<input aria-label="Focus end" type="date" value={query.to ?? ''} onChange={(event) => onChange({ to: event.currentTarget.value })} /></label>
            </>}
        </div>
        <div className="sprv-filterbar momentum-filterbar">
            {multi('Account / customer', 'accountIds', facets?.accounts)}
            {multi('Parent opportunity stage', 'stages', options(facets?.stages))}
            {multi('Milestone status', 'milestoneStatuses', options(facets?.milestoneStatuses))}
            <select className="sprv-select" aria-label="Value basis" title="Value basis" value={query.basis} onChange={(event) => onChange({
                basis: event.currentTarget.value === 'pipeline' ? 'pipeline' : event.currentTarget.value === 'monthly-usage' ? 'monthly-usage' : 'all', heatmap: 'count', minValue: undefined, maxValue: undefined
            })}><option value="all">Separate value groups</option><option value="pipeline">Pipeline value</option><option value="monthly-usage">Monthly usage potential (monthly rate)</option></select>
            <select className="sprv-select" aria-label="Currency" title="Currency" value={query.currency ?? ''} onChange={(event) => onChange({ currency: event.currentTarget.value || undefined, heatmap: 'count', minValue: undefined, maxValue: undefined })}>
                <option value="">All currencies</option>{facets?.currencies.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
        <details className="momentum-filter-drawer">
            <summary className="sprv-pill">More filters</summary>
            <p>Role changes emphasis, never access. Stage on a milestone is its parent opportunity stage. Use the checkbox selectors to combine multiple values.</p>
            <div className="momentum-filter-grid">
                {multi('Opportunity', 'opportunityIds', facets?.opportunities)}
                {multi('Milestone', 'milestoneIds', facets?.milestones)}
                {multi('Opportunity status', 'opportunityStatuses', options(facets?.opportunityStatuses))}
                {multi('Owner (verified ID)', 'ownerIds', facets?.owners)}
                <label>Entity grain<select aria-label="Entity grain" value={query.entity} onChange={(event) => onChange({ entity: event.currentTarget.value === 'opportunity' ? 'opportunity' : event.currentTarget.value === 'milestone' ? 'milestone' : 'all' })}>
                    <option value="all">Opportunities and milestones (separate units)</option><option value="opportunity">Opportunities</option><option value="milestone">Milestones</option>
                </select></label>
                <label>Minimum value<input aria-label="Minimum value" key={query.minValue ?? 'unset'} type="number" min={0} disabled={query.basis === 'all' || !query.currency} defaultValue={query.minValue ?? ''} onBlur={(event) => onChange({ minValue: event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value) })} /></label>
                <label>Maximum value<input aria-label="Maximum value" key={query.maxValue ?? 'unset'} type="number" min={0} disabled={query.basis === 'all' || !query.currency} defaultValue={query.maxValue ?? ''} onBlur={(event) => onChange({ maxValue: event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value) })} /></label>
                <label>Recorded date from<input aria-label="Recorded date from" type="date" value={query.dateFrom ?? ''} onChange={(event) => onChange({ dateFrom: event.currentTarget.value || undefined })} /></label>
                <label>Recorded date to<input aria-label="Recorded date to" type="date" value={query.dateTo ?? ''} onChange={(event) => onChange({ dateTo: event.currentTarget.value || undefined })} /></label>
                <label>Source quality<select aria-label="Source quality" value={query.sourceQuality[0] ?? ''} onChange={(event) => onChange({
                    sourceQuality: event.currentTarget.value === 'complete' ? ['complete'] : event.currentTarget.value === 'partial' ? ['partial'] : event.currentTarget.value === 'unknown' ? ['unknown'] : []
                })}><option value="">All coverage states</option><option value="complete">Complete connected sources</option><option value="partial">Partial</option><option value="unknown">Unknown</option></select></label>
                <label>Timezone<input aria-label="Timezone" key={query.timezone} defaultValue={query.timezone} onBlur={(event) => { if (event.currentTarget.value !== query.timezone) onChange({ timezone: event.currentTarget.value }) }} /></label>
                <label className="momentum-checkbox"><input type="checkbox" checked={query.includeUndated} onChange={(event) => onChange({ includeUndated: event.currentTarget.checked })} />Include undated records</label>
            </div>
        </details>
            <button type="button" className="sprv-reset" onClick={clear}>Clear selection</button>
        </div>
        {chips.length > 0 && <div className="sprv-chips momentum-selection" aria-label="Active Momentum filters">
            {chips.map((chip, index) => <span className="sprv-chip" key={`${chip.label}:${index}`}>{chip.label}<button type="button" onClick={chip.remove} aria-label={`Remove ${chip.label} filter`}>&times;</button></span>)}
        </div>}
    </>
}
