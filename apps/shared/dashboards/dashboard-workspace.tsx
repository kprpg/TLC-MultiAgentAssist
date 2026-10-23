import { useState, type ReactElement } from 'react'
import { SellerDashboardPane, type InvokeSellerDashboard } from './sellerDashboard/seller-dashboard.js'
import { StagePipelineReviewPane, type InvokeStagePipelineReview } from './StageAndPipelineReview/stage-pipeline-review.js'

type DashboardId = 'seller-dashboard' | 'stage-and-pipeline-review'

const dashboards: ReadonlyArray<{ id: DashboardId; label: string }> = [
    { id: 'seller-dashboard', label: 'Seller Dashboard' },
    { id: 'stage-and-pipeline-review', label: 'Stage and Pipeline Review' }
]

export function DashboardWorkspace({ invokeSellerDashboard, invokeStagePipelineReview }: {
    invokeSellerDashboard: InvokeSellerDashboard
    invokeStagePipelineReview?: InvokeStagePipelineReview
}): ReactElement {
    const [activeDashboard, setActiveDashboard] = useState<DashboardId>('seller-dashboard')

    return (
        <section className="dashboard-workspace" aria-label="Dashboard workspace">
            <nav className="dashboard-tabs" role="tablist" aria-label="Dashboards">
                {dashboards.map((dashboard) => (
                    <button
                        key={dashboard.id}
                        type="button"
                        role="tab"
                        aria-selected={activeDashboard === dashboard.id}
                        className={activeDashboard === dashboard.id ? 'active' : ''}
                        onClick={() => setActiveDashboard(dashboard.id)}
                    >
                        {dashboard.label}
                    </button>
                ))}
            </nav>
            <div className="dashboard-content">
                {activeDashboard === 'seller-dashboard' && <SellerDashboardPane invoke={invokeSellerDashboard} />}
                {activeDashboard === 'stage-and-pipeline-review' && (
                    invokeStagePipelineReview ? <StagePipelineReviewPane invoke={invokeStagePipelineReview} /> : <StagePipelineReviewPane />
                )}
            </div>
        </section>
    )
}
