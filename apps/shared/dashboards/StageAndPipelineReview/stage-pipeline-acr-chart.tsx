import type { ReactElement } from 'react'
import { acrCoverage, formatMoney, type AcrPoint } from './stage-pipeline-analysis.js'

const layers = [
    { key: 'actual', label: '$ Actuals YTD', color: 'var(--sprv-green)' },
    { key: 'baseline', label: '$ ACR Baseline YTD', color: 'var(--sprv-gray)' },
    { key: 'committed', label: '$ Committed Pipe', color: 'var(--sprv-blue)' },
    { key: 'uncommitted', label: '$ Uncommitted Pipe', color: 'var(--sprv-yellow)' },
    { key: 'stage1', label: '$ Stage 1 Pipe', color: 'var(--sprv-sand)' }
] as const

const width = 1200
const height = 360
const margin = { top: 24, right: 16, bottom: 56, left: 64 }

function tickStep(max: number): number {
    return max > 10_000_000 ? 5_000_000 : max > 1_000_000 ? 1_000_000 : 100_000
}

function niceMax(value: number): number {
    const step = tickStep(value)
    return Math.max(step, Math.ceil(value / step) * step)
}

export function AcrChart({ points, accountCount, syncedAt }: { points: readonly AcrPoint[]; accountCount: number; syncedAt: string }): ReactElement {
    const coverage = acrCoverage(points)
    const max = niceMax(Math.max(0, ...points.map((point) => Math.max(point.total, point.target))))
    const plotWidth = width - margin.left - margin.right
    const plotHeight = height - margin.top - margin.bottom
    const slot = points.length > 0 ? plotWidth / points.length : plotWidth
    const barWidth = Math.min(72, slot * 0.7)
    const y = (value: number) => margin.top + plotHeight - (value / max) * plotHeight
    const x = (index: number) => margin.left + slot * index + slot / 2
    const ticks = Array.from({ length: Math.round(max / tickStep(max)) + 1 }, (_, index) => index * tickStep(max))
    const lastPoint = points.at(-1)
    const summary = lastPoint && coverage
        ? `Cumulative FY ACR by month. At the final month: target ${formatMoney(coverage.target)}, actuals plus baseline ${formatMoney(coverage.base)}, with all layers ${formatMoney(coverage.all)}.`
        : 'No ACR data is available for this selection.'
    return <section className="sprv-card sprv-acr" aria-label="ACR Actuals and Outlook">
        <header className="sprv-acr-header">
            <h2><span aria-hidden="true">📈</span> ACR Actuals and Outlook</h2>
            <span className="sprv-muted">{accountCount} {accountCount === 1 ? 'account' : 'accounts'} · cumulative FY YTD · MSXi snapshot synced {syncedAt}</span>
        </header>
        <ul className="sprv-legend">
            {layers.map((layer) => <li key={layer.key}><span className="sprv-swatch" style={{ background: layer.color }} />{layer.label}</li>)}
            <li><span className="sprv-swatch" style={{ background: 'var(--sprv-ink)' }} />$ ACR Target (YTD)</li>
        </ul>
        {coverage && <ul className="sprv-coverage" aria-label="Coverage of the ACR target">
            <li><strong>{formatMoney(coverage.target)}</strong><span>FY ACR target · {accountCount} {accountCount === 1 ? 'account' : 'accounts'}</span></li>
            <li className={coverage.basePct >= 100 ? 'good' : 'bad'}><strong>{coverage.basePct}%</strong><span>Actuals + baseline · {formatMoney(coverage.base)}</span></li>
            <li className={coverage.committedPct >= 100 ? 'good' : 'bad'}><strong>{coverage.committedPct}%</strong><span>+ Committed · {formatMoney(coverage.withCommitted)}</span></li>
            <li className={coverage.uncommittedPct >= 100 ? 'good' : 'warn'}><strong>{coverage.uncommittedPct}%</strong><span>+ Uncommitted · {formatMoney(coverage.withUncommitted)}</span></li>
            <li className={coverage.allPct >= 100 ? 'good' : 'warn'}><strong>{coverage.allPct}%</strong><span>+ Stage 1 · {formatMoney(coverage.all)}</span></li>
            <li className={coverage.ahead >= 0 ? 'good' : 'bad'}><strong>{formatMoney(Math.abs(coverage.ahead))}</strong><span>{coverage.ahead >= 0 ? 'ahead of' : 'behind'} target with all layers</span></li>
        </ul>}
        <svg className="sprv-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} preserveAspectRatio="xMidYMid meet">
            {ticks.map((tick) => <g key={tick}>
                <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="sprv-grid" />
                <text x={margin.left - 8} y={y(tick) + 4} textAnchor="end" className="sprv-axis">{formatMoney(tick)}</text>
            </g>)}
            {points.map((point, index) => {
                let cursor = 0
                return <g key={point.month}>
                    {layers.map((layer) => {
                        const value = point[layer.key]
                        if (value <= 0) return null
                        const top = y(cursor + value)
                        const heightPx = y(cursor) - top
                        cursor += value
                        const labeled = (layer.key === 'actual' || layer.key === 'baseline') && heightPx > 18
                        return <g key={layer.key}>
                            <rect x={x(index) - barWidth / 2} y={top} width={barWidth} height={heightPx} fill={layer.color} />
                            {labeled && <text x={x(index)} y={top + heightPx / 2 + 4} textAnchor="middle" className="sprv-bar-label">{formatMoney(value)}</text>}
                        </g>
                    })}
                    <text x={x(index)} y={y(point.total) - 8} textAnchor="middle" className="sprv-total">{formatMoney(point.total)}</text>
                    <text transform={`translate(${x(index)} ${height - margin.bottom + 18}) rotate(-35)`} textAnchor="end" className="sprv-axis">{point.label}{point.lastActual ? '*' : ''}</text>
                </g>
            })}
            {points.length > 1 && <polyline className="sprv-target-line" fill="none" points={points.map((point, index) => `${x(index)},${y(point.target)}`).join(' ')} />}
            {points.map((point, index) => <circle key={point.month} cx={x(index)} cy={y(point.target)} r={5} className="sprv-target-dot"><title>{`${point.label} target ${formatMoney(point.target)}`}</title></circle>)}
        </svg>
        <p className="sprv-footnote">
            Green = actual ACR YTD to date (closed months plus the open month so far), carried flat through the remaining months. Gray = projected ACR baseline, built month by month on top of the green starting the month after the last actual month. Blue / yellow / light yellow = committed, uncommitted and Stage 1 pipeline added on top, accumulated. Black line = ACR target YTD. * = last actual month, still open when MSXi last synced. This chart is account-level Azure ACR from MSXi: it follows the Customer filter only, not the scope or other filters.
        </p>
    </section>
}
