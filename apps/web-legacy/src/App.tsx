import { useState, useCallback, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Layout } from './components/layout/Layout'
import { Dashboard } from './pages/Dashboard'
import { EdgeNodes } from './pages/EdgeNodes'
import { TaskScheduler } from './pages/TaskScheduler'
import { Monitoring } from './pages/Monitoring'
import { Logs } from './pages/Logs'
import { Policies } from './pages/Policies'
import { Webhooks } from './pages/Webhooks'
import { MLIntelligence } from './pages/MLIntelligence'
import { Alerts } from './pages/Alerts'
import { Tenants } from './pages/Tenants'
import { CommandPalette } from './components/modals/CommandPalette'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { usePersistentState } from './hooks/usePersistentState'
import { AuthProvider, ProtectedRoute } from './context/AuthContext'
import { TenantProvider } from './contexts/TenantContext'
import { TooltipProvider } from './components/ui/tooltip'
import { queryClient } from './lib/query-client'
import { initWsStore } from './stores/websocket'

function AppContent() {
  const navigate = useNavigate()
  const { state: persistedState, isLoaded: persistedLoaded } = usePersistentState()
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  
  // Theme toggle
  const toggleTheme = useCallback(() => {
    const newValue = persistedState.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('light', newValue === 'light')
    document.documentElement.classList.toggle('dark', newValue === 'dark')
  }, [persistedState.theme])
  
  // Initialize theme from persisted state
  useEffect(() => {
    if (!persistedLoaded) return
    const isDark = persistedState.theme === 'dark'
    document.documentElement.classList.toggle('light', !isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [persistedLoaded, persistedState.theme])
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K for command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
      
      // T for new task
      if (e.key === 't' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        navigate('/scheduler')
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])
  
  return (
    <>
      <CommandPalette 
        isOpen={commandPaletteOpen} 
        onClose={() => setCommandPaletteOpen(false)} 
      />
      <Layout
        isDark={persistedState.theme === 'dark'}
        onToggleTheme={toggleTheme}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      >
        <Routes>
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/nodes" 
            element={
              <ProtectedRoute permission="nodes:read">
                <EdgeNodes />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/scheduler" 
            element={
              <ProtectedRoute permission="tasks:read">
                <TaskScheduler />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/monitoring" 
            element={
              <ProtectedRoute permission="monitoring:read">
                <Monitoring />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/logs" 
            element={
              <ProtectedRoute permission="logs:read">
                <Logs />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/policies" 
            element={
              <ProtectedRoute permission="policies:read">
                <Policies />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/webhooks" 
            element={
              <ProtectedRoute permission="admin">
                <Webhooks />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/ml-intelligence" 
            element={
              <ProtectedRoute permission="monitoring:read">
                <MLIntelligence />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/alerts" 
            element={
              <ProtectedRoute permission="monitoring:read">
                <Alerts />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenants" 
            element={
              <ProtectedRoute permission="admin">
                <Tenants />
              </ProtectedRoute>
            } 
          />
        </Routes>
      </Layout>
    </>
  )
}

function App() {
  // Bootstrap WebSocket store singleton once at app startup.
  useEffect(() => {
    initWsStore()
  }, [])

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TenantProvider>
            <TooltipProvider delayDuration={200}>
              <BrowserRouter>
                <AppContent />
              </BrowserRouter>
            </TooltipProvider>
          </TenantProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
