import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Temporarily disable Strict Mode to prevent double rendering
createRoot(document.getElementById('root')!).render(
  <App />
)