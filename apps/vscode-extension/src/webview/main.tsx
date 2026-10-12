import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.js'
import './styles.css'
import '../../../shared/feedback.css'
import '../../../shared/dashboard-workspace.css'
import '../../../shared/seller-dashboard.css'

const container = document.getElementById('root')
if (container) {
    createRoot(container).render(<StrictMode><App /></StrictMode>)
}
