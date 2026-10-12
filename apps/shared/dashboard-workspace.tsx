import { useState, type ReactElement } from 'react'
import { SellerDashboardPane, type InvokeSellerDashboard } from './seller-dashboard.js'

type DashboardId = 'seller-dashboard'

const dashboards: ReadonlyArray<{ id: DashboardId; label: string }> = [
    { id: 'seller-dashboard', label: 'Seller Dashboard' }
]

export function DashboardWorkspace({ invokeSellerDashboard }: { invokeSellerDashboard: InvokeSellerDashboard }): ReactElement {
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
            </div>
        </section>
    )
}
