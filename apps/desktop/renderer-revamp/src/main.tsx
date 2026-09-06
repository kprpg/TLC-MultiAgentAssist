import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RevampApp } from './App.js'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root element is missing.')

createRoot(root).render(<StrictMode><RevampApp /></StrictMode>)