import { createRoot } from 'react-dom/client'
import { TeamsApp } from './app.js'
import './styles.css'
import '../../../shared/record-creation/new-workspace.css'
import '../../../shared/dashboards/dashboard-workspace.css'
import '../../../shared/dashboards/sellerDashboard/seller-dashboard.css'
import '../../../shared/dashboards/StageAndPipelineReview/stage-pipeline-review.css'
import '../../../shared/dashboards/soltionEngineerDashboard/se-reporting-dashboard.css'

const root = document.getElementById('root')
if (!root) throw new Error('The Teams application root is missing.')
createRoot(root).render(<TeamsApp />)
