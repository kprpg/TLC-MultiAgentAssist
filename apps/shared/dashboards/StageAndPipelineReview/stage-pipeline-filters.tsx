import type { ReactElement } from 'react'
import { MultiSelect } from '../dashboard-controls.js'
export { MultiSelect } from '../dashboard-controls.js'
import { stagePipelineStages, type StagePipelineStage } from '../../../../packages/common/contracts/stage-pipeline-review.js'
import {
    activeFilterChips, clearFilterChip, defaultReviewFilters, withScope,
    type ReviewFilters, type ReviewScope, type ReviewSource
} from './stage-pipeline-analysis.js'

export interface FilterOptions {
    customers: readonly string[]
    statuses: readonly string[]
    forecasts: readonly string[]
    solutions: readonly string[]
    quarters: readonly string[]
    partners: readonly string[]
}

export function Segmented<T extends string>({ name, label, value, options, onChange }: {
    name: string
    label: string
    value: T
    options: ReadonlyArray<{ value: T; label: string; glyph: string }>
    onChange(next: T): void
}): ReactElement {
    return <div className="sprv-segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => <label key={option.value} className={value === option.value ? 'active' : undefined}>
            <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span aria-hidden="true" className="sprv-glyph">{option.glyph}</span>{option.label}
        </label>)}
    </div>
}

export function ScopeToggles({ filters, inbound, onChange }: {
    filters: ReviewFilters
    inbound: number
    onChange(next: ReviewFilters): void
}): ReactElement {
    return <div className="sprv-toggles">
        <Segmented<ReviewScope> name="sprv-scope" label="Consumption scope" value={filters.scope} onChange={(scope) => onChange(withScope(filters, scope))} options={[
            { value: 'azure', label: 'Azure only', glyph: '☁' },
            { value: 'microsoft-services', label: 'Microsoft Services', glyph: '✦' },
            { value: 'all', label: 'All consumption', glyph: '◍' }
        ]} />
        <Segmented<ReviewSource> name="sprv-source" label="Opportunity source" value={filters.source} onChange={(source) => onChange({ ...filters, source })} options={[
            { value: 'all', label: 'All opps', glyph: '▤' },
            { value: 'inbound', label: `Inbound only (${inbound})`, glyph: '⇥' },
            { value: 'exclude-inbound', label: 'Exclude Inbound', glyph: '⦸' }
        ]} />
        <Segmented<'consumed'> name="sprv-metric" label="Metric" value="consumed" onChange={() => undefined} options={[
            { value: 'consumed', label: 'Consumed $', glyph: '▥' }
        ]} />
    </div>
}

function Select({ label, allLabel, value, values, onChange }: {
    label: string
    allLabel: string
    value: string
    values: readonly string[]
    onChange(next: string): void
}): ReactElement {
    return <select className="sprv-select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {values.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
}

export function FilterBar({ filters, options, stageCounts, onChange }: {
    filters: ReviewFilters
    options: FilterOptions
    stageCounts: Record<StagePipelineStage, number>
    onChange(next: ReviewFilters): void
}): ReactElement {
    const chips = activeFilterChips(filters)
    return <>
        <div className="sprv-filterbar">
            <input className="sprv-search" type="search" aria-label="Search opportunities" placeholder="Search topic, customer, contact, partner, notes"
                value={filters.search} onChange={(event) => onChange({ ...filters, search: event.target.value })} />
            <Select label="Customer" allLabel="All customers" value={filters.customer} values={options.customers} onChange={(customer) => onChange({ ...filters, customer })} />
            <Select label="Status" allLabel="All statuses" value={filters.status} values={options.statuses} onChange={(status) => onChange({ ...filters, status })} />
            <Select label="Forecast category" allLabel="All forecast categories" value={filters.forecast} values={options.forecasts} onChange={(forecast) => onChange({ ...filters, forecast })} />
            <MultiSelect<StagePipelineStage> label="Stages" allLabel="All stages" selected={filters.stages} onChange={(stages) => onChange({ ...filters, stages })}
                options={stagePipelineStages.map((stage) => ({ value: stage, count: stageCounts[stage] }))} />
            <Select label="Solution" allLabel="All solutions" value={filters.solution} values={options.solutions} onChange={(solution) => onChange({ ...filters, solution })} />
            <Select label="Fiscal quarter" allLabel="All fiscal quarters" value={filters.quarter} values={options.quarters} onChange={(quarter) => onChange({ ...filters, quarter })} />
            <Select label="Partner" allLabel="All partners" value={filters.partner} values={options.partners} onChange={(partner) => onChange({ ...filters, partner })} />
            <button type="button" className={filters.focusOnly ? 'sprv-pill sprv-pill--active' : 'sprv-pill'} aria-pressed={filters.focusOnly}
                onClick={() => onChange({ ...filters, focusOnly: !filters.focusOnly })}>★ Focus only</button>
            <button type="button" className={filters.hideReviewed ? 'sprv-pill sprv-pill--active' : 'sprv-pill'} aria-pressed={filters.hideReviewed}
                onClick={() => onChange({ ...filters, hideReviewed: !filters.hideReviewed })}>Hide reviewed</button>
            <button type="button" className="sprv-reset" onClick={() => onChange(defaultReviewFilters())}>Reset</button>
        </div>
        {chips.length > 0 && <div className="sprv-chips" aria-label="Active filters">
            <span className="sprv-muted">Filters:</span>
            {chips.map((chip) => <span key={chip.key} className="sprv-chip">
                <strong>{chip.label}:</strong> {chip.value}
                <button type="button" aria-label={`Remove ${chip.label} filter ${chip.value}`} onClick={() => onChange(clearFilterChip(filters, chip.key))}>×</button>
            </span>)}
        </div>}
    </>
}
