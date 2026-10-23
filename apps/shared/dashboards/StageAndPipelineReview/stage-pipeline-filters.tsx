import { useEffect, useRef, useState, type ReactElement } from 'react'
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

export function MultiSelect<T extends string>({ label, allLabel, options, selected, onChange }: {
    label: string
    allLabel: string
    options: ReadonlyArray<{ value: T; label?: string; count?: number }>
    selected: readonly T[]
    onChange(next: T[]): void
}): ReactElement {
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!open) return undefined
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent) {
                if (event.key === 'Escape') {
                    if (root.current?.contains(document.activeElement)) {
                        event.preventDefault()
                        root.current.querySelector<HTMLButtonElement>('button')?.focus()
                    }
                    setOpen(false)
                }
                return
            }
            if (!root.current?.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', close)
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
    }, [open])
    const summary = selected.length === 0 ? allLabel
        : selected.length === 1 ? options.find((option) => option.value === selected[0])?.label ?? selected[0] ?? allLabel
            : `${selected.length} ${label.toLowerCase()}`
    return <div className="sprv-multiselect" ref={root}>
        <button type="button" className={selected.length > 0 ? 'sprv-pill sprv-pill--active' : 'sprv-pill'} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
            {summary} <span aria-hidden="true">▾</span>
        </button>
        {open && <div className="sprv-popover" role="group" aria-label={label}>
            {options.map((option) => <label key={option.value} className="sprv-popover-row">
                <input type="checkbox" checked={selected.includes(option.value)} onChange={(event) =>
                    onChange(event.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value))} />
                <span>{option.label ?? option.value}</span>
                {option.count !== undefined && <span className="sprv-count">{option.count}</span>}
            </label>)}
            <div className="sprv-popover-footer">
                <button type="button" onClick={() => onChange(options.map((option) => option.value))}>Select all</button>
                <button type="button" onClick={() => onChange([])}>Clear</button>
            </div>
        </div>}
    </div>
}

function Segmented<T extends string>({ name, label, value, options, onChange }: {
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
