import { useEffect, useId, useRef, useState } from 'react'
import {
  discoveryCustomers,
  toggleDiscoverySort,
  type DiscoveryCustomer,
  type DiscoveryFilterOperator,
  type DiscoveryFilters,
  type DiscoverySort,
  type DiscoverySortColumn
} from './discovery.js'
import './discovery-controls.css'

type FilterDraft = { operator: DiscoveryFilterOperator; customers: readonly DiscoveryCustomer[] }

const operators = [
  { value: 'include', label: 'equals', description: 'equals (include)' },
  { value: 'exclude', label: 'does not equal', description: 'does not equal (exclude)' }
] as const
const columnLabels: Record<DiscoverySortColumn, string> = { account: 'Account', stage: 'Stage', action: 'Action' }

export function DiscoveryControls({ customers, filters, onChange, visibleCount, totalCount, loading }: {
  customers: readonly DiscoveryCustomer[]
  filters: DiscoveryFilters
  onChange(filters: DiscoveryFilters): void
  visibleCount: number
  totalCount: number
  loading: boolean
}) {
  const [editor, setEditor] = useState<FilterDraft | null>(null)
  const [query, setQuery] = useState('')
  const anchor = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const addFilter = useRef<HTMLButtonElement>(null)
  const operatorName = useId()
  const editorOpen = editor !== null
  const hasFilters = filters.include.length > 0 || filters.exclude.length > 0
  const choices = discoveryCustomers([...customers, ...filters.include, ...filters.exclude].map((customer) => ({
    accountId: customer.id, accountName: customer.name
  })))
  const matches = choices.filter((customer) => customer.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selectedIds = new Set(editor?.customers.map((customer) => customer.id))

  function closeEditor(restoreFocus = true) {
    setEditor(null)
    if (restoreFocus) (opener.current?.isConnected ? opener.current : addFilter.current)?.focus()
  }

  function openEditor(operator: DiscoveryFilterOperator, button: HTMLButtonElement) {
    opener.current = button
    setQuery('')
    setEditor({ operator, customers: filters[operator] })
  }

  useEffect(() => {
    if (!editorOpen) return
    search.current?.focus()
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) closeEditor(false)
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeEditor()
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [editorOpen])

  function selectCustomer(customer: DiscoveryCustomer, checked: boolean) {
    setEditor((current) => current && ({
      ...current,
      customers: checked ? [...current.customers, customer] : current.customers.filter((item) => item.id !== customer.id)
    }))
  }

  function selectMatches(checked: boolean) {
    const matchingIds = new Set(matches.map((customer) => customer.id))
    setEditor((current) => current && ({
      ...current,
      customers: checked
        ? [...current.customers, ...matches.filter((customer) => !selectedIds.has(customer.id))]
        : current.customers.filter((customer) => !matchingIds.has(customer.id))
    }))
  }

  return <div className="discovery-controls" ref={anchor} role="group" aria-label="Discovery customer filters">
    {!hasFilters && <button
      type="button"
      className="discovery-filter-chip discovery-filter-default"
      aria-haspopup="dialog"
      aria-expanded={editorOpen}
      disabled={loading}
      onClick={(event) => openEditor('include', event.currentTarget)}
    >Customers equals <strong>all</strong></button>}
    {operators.map(({ value, label }) => filters[value].length > 0 && <div className="discovery-filter-chip" key={value}>
      <button
        type="button"
        className="discovery-filter-label"
        title={`Customers ${label} ${filters[value].map((customer) => customer.name).join(', ')}`}
        aria-haspopup="dialog"
        aria-expanded={editor?.operator === value}
        disabled={loading}
        onClick={(event) => openEditor(value, event.currentTarget)}
      ><span>Customers {label}</span><strong>{filters[value].map((customer) => customer.name).join(', ')}</strong></button>
      <button
        type="button"
        className="discovery-filter-remove"
        aria-label={`Remove ${value} customer filter`}
        title={`Remove ${value} customer filter`}
        onClick={() => { onChange({ ...filters, [value]: [] }); closeEditor(false); addFilter.current?.focus() }}
      >&times;</button>
    </div>)}
    <button
      type="button"
      className="discovery-add-filter"
      ref={addFilter}
      aria-haspopup="dialog"
      aria-expanded={editorOpen}
      disabled={loading}
      onClick={(event) => openEditor(filters.include.length > 0 ? 'exclude' : 'include', event.currentTarget)}
    ><span aria-hidden="true">+</span> Add filter</button>
    {hasFilters && <button type="button" className="discovery-clear-filters" onClick={() => {
      onChange({ include: [], exclude: [] })
      closeEditor()
      addFilter.current?.focus()
    }}>Clear filters</button>}
    <span className="discovery-result-count" role="status">
      {loading ? 'Loading opportunities...' : `Showing ${visibleCount} of ${totalCount} opportunities`}
    </span>
    {editor && <div className="discovery-filter-editor" role="dialog" aria-label="Customer filter">
      <h3>Filter customers</h3>
      <fieldset className="discovery-filter-operator">
        <legend>Operator</legend>
        {operators.map(({ value, description }) => <label key={value}>
          <input
            type="radio"
            name={operatorName}
            checked={editor.operator === value}
            onChange={() => setEditor({ operator: value, customers: filters[value] })}
          />{description}
        </label>)}
      </fieldset>
      <label className="discovery-customer-search">
        Search customers
        <input ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customers" />
      </label>
      <label className="discovery-customer-option discovery-select-all">
        <input
          type="checkbox"
          checked={matches.length > 0 && matches.every((customer) => selectedIds.has(customer.id))}
          disabled={matches.length === 0}
          onChange={(event) => selectMatches(event.target.checked)}
        />{query.trim() ? 'Select all matching customers' : 'Select all customers'}
      </label>
      <div className="discovery-customer-options">
        {matches.map((customer) => <label className="discovery-customer-option" key={customer.id} title={`${customer.name} (${customer.id})`}>
          <input
            type="checkbox"
            checked={selectedIds.has(customer.id)}
            onChange={(event) => selectCustomer(customer, event.target.checked)}
          /><span>{customer.name}</span>
        </label>)}
        {matches.length === 0 && <p>No customers match your search.</p>}
      </div>
      <p className="discovery-filter-help">{editor.customers.length === 0 ? 'Select at least one customer to apply this filter.' : `${editor.customers.length} customers selected`}</p>
      <div className="discovery-filter-actions">
        <button type="button" className="discovery-filter-apply" disabled={editor.customers.length === 0} onClick={() => {
          onChange({ ...filters, [editor.operator]: editor.customers })
          closeEditor()
        }}>Apply</button>
        <button type="button" onClick={() => closeEditor()}>Cancel</button>
      </div>
    </div>}
  </div>
}

export function DiscoverySortHeader({ column, sort, onSort }: {
  column: DiscoverySortColumn
  sort: DiscoverySort | null
  onSort(column: DiscoverySortColumn): void
}) {
  const direction = sort?.column === column ? sort.direction : 'none'
  const next = toggleDiscoverySort(sort, column)
  return <th scope="col" aria-sort={direction}>
    <button
      type="button"
      className="discovery-sort-button"
      aria-label={`Sort by ${columnLabels[column]}`}
      title={`Sort by ${columnLabels[column]} ${next.direction}`}
      onClick={() => onSort(column)}
    >
      {columnLabels[column]}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
        <path d={direction === 'ascending' ? 'M4 6l4-4 4 4M8 2v12' : direction === 'descending' ? 'M4 10l4 4 4-4M8 2v12' : 'M1 5l3-3 3 3M4 2v12M9 11l3 3 3-3M12 2v12'} />
      </svg>
    </button>
  </th>
}
