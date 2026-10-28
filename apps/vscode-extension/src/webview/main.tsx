import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.js'
import '../../../shared/typography.css'
import './styles.css'
import '../../../shared/feedback.css'
import '../../../shared/record-creation/new-workspace.css'
import '../../../shared/dashboards/dashboard-workspace.css'
import '../../../shared/dashboards/sellerDashboard/seller-dashboard.css'
import '../../../shared/dashboards/StageAndPipelineReview/stage-pipeline-review.css'
import '../../../shared/working-session/working-session.css'
import '../../../shared/dashboards/soltionEngineerDashboard/se-reporting-dashboard.css'

const container = document.getElementById('root')
if (container) {
    createRoot(container).render(<StrictMode><App /></StrictMode>)
}
