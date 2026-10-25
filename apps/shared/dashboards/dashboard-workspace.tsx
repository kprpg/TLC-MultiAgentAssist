import { lazy, Suspense, useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import { SellerDashboardPane, type InvokeSellerDashboard } from './sellerDashboard/seller-dashboard.js'
import { StagePipelineReviewPane, type InvokeStagePipelineReview } from './StageAndPipelineReview/stage-pipeline-review.js'
import type { StagePipelineWrites } from './StageAndPipelineReview/stage-pipeline-writes.js'
import type { InvokeSeReporting } from './soltionEngineerDashboard/report-setup.js'
import type { SessionPortfolio } from '../session-portfolio.js'

type DashboardId = 'seller-dashboard' | 'stage-and-pipeline-review' | 'se-reporting'
const SeReportingDashboardPane = lazy(() => import('./soltionEngineerDashboard/se-reporting-dashboard.js').then((module) => ({ default: module.SeReportingDashboardPane })))

const dashboards: ReadonlyArray<{ id: DashboardId; label: string }> = [
    { id: 'seller-dashboard', label: 'Seller Dashboard' },
    { id: 'stage-and-pipeline-review', label: 'Stage and Pipeline Review' },
    { id: 'se-reporting', label: 'SE Reporting Dashboard' }
]

export function DashboardWorkspace({ invokeSellerDashboard, invokeSeReporting, invokeStagePipelineReview, stagePipelineWrites, sourceSession }: {
    invokeSellerDashboard: InvokeSellerDashboard
    invokeSeReporting: InvokeSeReporting
    invokeStagePipelineReview?: InvokeStagePipelineReview
    stagePipelineWrites?: StagePipelineWrites
    sourceSession?: SessionPortfolio | undefined
}): ReactElement {
    const [activeDashboard, setActiveDashboard] = useState<DashboardId>('seller-dashboard')
    const [visited, setVisited] = useState<ReadonlySet<DashboardId>>(new Set())
    const [sourceGeneration, setSourceGeneration] = useState(sourceSession?.cache.generation ?? 0)
    useEffect(() => {
        setSourceGeneration(sourceSession?.cache.generation ?? 0)
        return sourceSession?.subscribe(() => setSourceGeneration(sourceSession.cache.generation))
    }, [sourceSession])
    const select = (id: DashboardId) => {
        setVisited((previous) => previous.has(id) ? previous : new Set(previous).add(id))
        setActiveDashboard(id)
    }
    const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % dashboards.length
            : event.key === 'ArrowLeft' ? (index + dashboards.length - 1) % dashboards.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? dashboards.length - 1 : null
        if (next === null) return
        event.preventDefault()
        select(dashboards[next]!.id)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    }

    return (
        <section className="dashboard-workspace" aria-label="Dashboard workspace">
            <nav className="dashboard-tabs" role="tablist" aria-label="Dashboards">
                {dashboards.map((dashboard, index) => (
                    <button
                        key={dashboard.id}
                        type="button"
                        role="tab"
                        id={`dashboard-tab-${dashboard.id}`}
                        aria-controls={`dashboard-panel-${dashboard.id}`}
                        aria-selected={activeDashboard === dashboard.id}
                        tabIndex={activeDashboard === dashboard.id ? 0 : -1}
                        className={activeDashboard === dashboard.id ? 'active' : ''}
                        onClick={() => select(dashboard.id)}
                        onKeyDown={(event) => navigate(event, index)}
                    >
                        {dashboard.label}
                    </button>
                ))}
            </nav>
            <div className="dashboard-content" key={sourceGeneration}>
                <div className="dashboard-panel" role="tabpanel" id="dashboard-panel-seller-dashboard" aria-labelledby="dashboard-tab-seller-dashboard" hidden={activeDashboard !== 'seller-dashboard'}>
                    <SellerDashboardPane invoke={invokeSellerDashboard} />
                </div>
                <div className="dashboard-panel" role="tabpanel" id="dashboard-panel-stage-and-pipeline-review" aria-labelledby="dashboard-tab-stage-and-pipeline-review" hidden={activeDashboard !== 'stage-and-pipeline-review'}>
                    {visited.has('stage-and-pipeline-review') && (invokeStagePipelineReview ? <StagePipelineReviewPane invoke={invokeStagePipelineReview} {...(stagePipelineWrites ? { writes: stagePipelineWrites } : {})} /> : <StagePipelineReviewPane />)}
                </div>
                <div className="dashboard-panel" role="tabpanel" id="dashboard-panel-se-reporting" aria-labelledby="dashboard-tab-se-reporting" hidden={activeDashboard !== 'se-reporting'}>
                    {visited.has('se-reporting') && <Suspense fallback={<p role="status">Loading SE Reporting Dashboard...</p>}><SeReportingDashboardPane invoke={invokeSeReporting} /></Suspense>}
                </div>
            </div>
        </section>
    )
}
