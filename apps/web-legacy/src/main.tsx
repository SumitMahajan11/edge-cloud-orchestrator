import { initTracing } from './telemetry/tracing'
initTracing()

import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Strict Mode disabled to prevent double rendering
createRoot(document.getElementById('root')!).render(
  <App />
)