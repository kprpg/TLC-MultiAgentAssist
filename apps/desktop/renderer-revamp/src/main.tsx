import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RevampApp } from './App.js'
import './styles.css'
import '../../../shared/feedback.css'
import '../../../shared/record-creation/new-workspace.css'
import '../../../shared/dashboards/dashboard-workspace.css'
import '../../../shared/dashboards/sellerDashboard/seller-dashboard.css'
import '../../../shared/dashboards/StageAndPipelineReview/stage-pipeline-review.css'
import '../../../shared/dashboards/soltionEngineerDashboard/se-reporting-dashboard.css'

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root element is missing.')

createRoot(root).render(<StrictMode><RevampApp /></StrictMode>)