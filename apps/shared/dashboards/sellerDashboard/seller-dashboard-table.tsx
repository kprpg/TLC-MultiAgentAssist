import { useEffect, useMemo, useState, type ReactNode } from 'react'

export interface SellerDashboardColumn<T> {
    key: string
    label: string
    value(row: T): string | number | null
    render?(row: T): ReactNode
    numeric?: boolean
}

export function SellerDashboardTable<T>({ caption, columns, rows, rowKey, pageSize = 15 }: {
    caption: string
    columns: readonly SellerDashboardColumn<T>[]
    rows: readonly T[]
    rowKey(row: T): string
    pageSize?: number
}) {
    const [sort, setSort] = useState<{ key: string; direction: 'ascending' | 'descending' } | null>(null)
    const [page, setPage] = useState(0)
    useEffect(() => { setPage(0) }, [rows])
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
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
    const selectedPage = Math.min(page, pages - 1)
    const visible = sorted.slice(selectedPage * pageSize, (selectedPage + 1) * pageSize)
    return <div className="sd-table-section">
        <div className="sd-table-wrap" tabIndex={0} role="region" aria-label={`${caption}; horizontally scrollable`}>
            <table className="sd-table">
                <caption>{caption}</caption>
                <thead><tr>{columns.map((column) => <th key={column.key} scope="col"
                    className={column.numeric ? 'sd-numeric' : undefined}
                    aria-sort={sort?.key === column.key ? sort.direction : 'none'}>
                    <button type="button" aria-label={`Sort ${caption} by ${column.label}`} onClick={() => {
                        setSort({ key: column.key, direction: sort?.key === column.key && sort.direction === 'ascending' ? 'descending' : 'ascending' })
                        setPage(0)
                    }}>{column.label}<span aria-hidden="true">{sort?.key === column.key ? sort.direction === 'ascending' ? ' ↑' : ' ↓' : ' ↕'}</span></button>
                </th>)}</tr></thead>
                <tbody>{visible.map((row) => <tr key={rowKey(row)}>{columns.map((column) =>
                    <td key={column.key} className={column.numeric ? 'sd-numeric' : undefined}>
                        {column.render ? column.render(row) : column.value(row) ?? 'Unknown'}
                    </td>
                )}</tr>)}
                {visible.length === 0 && <tr><td colSpan={columns.length} className="sd-empty">No records match this working view. Check source completeness before concluding activity is absent.</td></tr>}
                </tbody>
            </table>
        </div>
        <div className="sd-table-footer">
            <span aria-live="polite">{sorted.length === 0 ? '0' : selectedPage * pageSize + 1}–{Math.min((selectedPage + 1) * pageSize, sorted.length)} of {sorted.length} records · totals include all matching records</span>
            {pages > 1 && <div>
                <button type="button" aria-label={`Previous page of ${caption}`} disabled={selectedPage === 0} onClick={() => setPage(selectedPage - 1)}>Previous</button>
                <span>Page {selectedPage + 1} of {pages}</span>
                <button type="button" aria-label={`Next page of ${caption}`} disabled={selectedPage === pages - 1} onClick={() => setPage(selectedPage + 1)}>Next</button>
            </div>}
        </div>
    </div>
}
