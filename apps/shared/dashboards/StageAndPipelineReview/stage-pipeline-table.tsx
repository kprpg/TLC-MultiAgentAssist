import { useEffect, useMemo, useState, type ReactNode } from 'react'

export interface ReviewColumn<T> {
    key: string
    label: string
    value(row: T): string | number | null
    render?(row: T): ReactNode
    numeric?: boolean
}

const pageStep = 100

export function ReviewTable<T>({ caption, columns, rows, rowKey, rowClass }: {
    caption: string
    columns: readonly ReviewColumn<T>[]
    rows: readonly T[]
    rowKey(row: T): string
    rowClass?(row: T): string | undefined
}) {
    const [sort, setSort] = useState<{ key: string; direction: 'ascending' | 'descending' } | null>(null)
    const [limit, setLimit] = useState(pageStep)
    useEffect(() => { setLimit(pageStep) }, [rows])
    const sorted = useMemo(() => {
        const column = columns.find((item) => item.key === sort?.key)
        if (!column || !sort) return rows
        return [...rows].sort((left, right) => {
            const a = column.value(left)
            const b = column.value(right)
            if (a === null) return b === null ? 0 : 1
            if (b === null) return -1
            const result = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
            return sort.direction === 'ascending' ? result : -result
        })
    }, [columns, rows, sort])
    const visible = sorted.slice(0, limit)
    return <div className="sprv-table-section">
        <div className="sprv-table-wrap" tabIndex={0} role="region" aria-label={`${caption}; scrollable`}>
            <table className="sprv-table">
                <caption>{caption}</caption>
                <thead><tr>{columns.map((column) => <th key={column.key} scope="col"
                    className={column.numeric ? 'sprv-numeric' : undefined}
                    aria-sort={sort?.key === column.key ? sort.direction : 'none'}>
                    <button type="button" aria-label={`Sort ${caption} by ${column.label}`} onClick={() =>
                        setSort({ key: column.key, direction: sort?.key === column.key && sort.direction === 'ascending' ? 'descending' : 'ascending' })}>
                        {column.label}<span aria-hidden="true">{sort?.key === column.key ? sort.direction === 'ascending' ? ' ↑' : ' ↓' : ''}</span>
                    </button>
                </th>)}</tr></thead>
                <tbody>
                    {visible.map((row) => <tr key={rowKey(row)} className={rowClass?.(row)}>{columns.map((column) =>
                        <td key={column.key} className={column.numeric ? 'sprv-numeric' : undefined}>
                            {column.render ? column.render(row) : column.value(row) ?? '—'}
                        </td>
                    )}</tr>)}
                    {visible.length === 0 && <tr><td colSpan={columns.length} className="sprv-empty">No records match the current filters.</td></tr>}
                </tbody>
            </table>
        </div>
        {sorted.length > visible.length && <div className="sprv-table-footer">
            <span aria-live="polite">Showing {visible.length} of {sorted.length}</span>
            <button type="button" onClick={() => setLimit(limit + pageStep)}>Show more</button>
        </div>}
    </div>
}
