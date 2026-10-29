import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react'

export function MultiSelect<T extends string>({ label, allLabel, options, selected, onChange }: {
    label: string
    allLabel: string
    options: ReadonlyArray<{ value: T; label?: string; count?: number }>
    selected: readonly T[]
    onChange(next: T[]): void
}): ReactElement {
    const [open, setOpen] = useState(false)
    const [alignEnd, setAlignEnd] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    const id = useId()
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
            if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', close)
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
    }, [open])
    const summary = selected.length === 0 ? allLabel
        : selected.length === 1 ? options.find((option) => option.value === selected[0])?.label ?? selected[0] ?? allLabel
            : `${selected.length} ${label.toLowerCase()}`
    const toggle = () => {
        const bounds = root.current?.getBoundingClientRect()
        const width = Math.min(280, window.innerWidth - 32)
        setAlignEnd(Boolean(bounds && bounds.left + width > window.innerWidth - 16 && bounds.right - width >= 16))
        setOpen(!open)
    }
    return <div className="sprv-multiselect" ref={root}>
        <button type="button" className={selected.length > 0 ? 'sprv-pill sprv-pill--active' : 'sprv-pill'}
            aria-haspopup="true" aria-controls={id} aria-expanded={open} onClick={toggle}>
            <span className="sprv-multiselect-summary">{summary}</span><span aria-hidden="true">&#9662;</span>
        </button>
        {open && <div id={id} className={`sprv-popover${alignEnd ? ' sprv-popover--end' : ''}`} role="group" aria-label={label}>
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

export function DashboardSectionTabs<T extends string>({ label, idPrefix, panelId, items, active, onChange }: {
    label: string
    idPrefix: string
    panelId: string
    items: ReadonlyArray<{ id: T; label: string; count?: ReactNode; glyph?: ReactNode }>
    active: T
    onChange(id: T): void
}): ReactElement {
    const navigate = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
        if (next === null || !items[next]) return
        event.preventDefault()
        onChange(items[next].id)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    }
    return <div className="sprv-tabs" role="tablist" aria-label={label}>
        {items.map((item, index) => <button key={item.id} type="button" role="tab" id={`${idPrefix}-tab-${item.id}`}
            aria-selected={active === item.id} aria-controls={panelId} tabIndex={active === item.id ? 0 : -1}
            className={active === item.id ? 'active' : undefined} onClick={() => onChange(item.id)} onKeyDown={(event) => navigate(event, index)}>
            {item.glyph && <span aria-hidden="true">{item.glyph}</span>} {item.label}
            {item.count !== undefined && <> <span className="sprv-tab-count">{item.count}</span></>}
        </button>)}
    </div>
}
