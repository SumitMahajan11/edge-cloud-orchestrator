import { useState, useCallback, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { Dashboard } from './pages/Dashboard'
import { EdgeNodes } from './pages/EdgeNodes'
import { TaskScheduler } from './pages/TaskScheduler'
import { Monitoring } from './pages/Monitoring'
import { Logs } from './pages/Logs'
import { Policies } from './pages/Policies'
import { Webhooks } from './pages/Webhooks'
import { CommandPalette } from './components/modals/CommandPalette'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { useRealOrchestrator } from './hooks/useRealOrchestrator'
import { useOrchestrator } from './hooks/useOrchestrator'
import { usePersistentState } from './hooks/usePersistentState'
import { useAlerts } from './hooks/useAlerts'
import { AuthProvider, ProtectedRoute } from './context/AuthContext'
import { toast } from 'sonner'
import type { TaskType, TaskPriority, EdgeNode } from './types'

// Feature flag to switch between real API and simulation
const USE_REAL_API = true

function AppContent() {
  const navigate = useNavigate()
  // Use real API or simulation based on feature flag
  const realOrchestrator = useRealOrchestrator()
  const simOrchestrator = useOrchestrator()
  
  // Get common properties with defaults
  const nodes = USE_REAL_API ? realOrchestrator.nodes : simOrchestrator.nodes
  const tasks = USE_REAL_API ? realOrchestrator.tasks : simOrchestrator.tasks
  const logs = USE_REAL_API ? realOrchestrator.logs : simOrchestrator.logs
  const metrics = USE_REAL_API ? realOrchestrator.metrics : simOrchestrator.metrics
  const policy = USE_REAL_API ? realOrchestrator.policy : simOrchestrator.policy
  const cpuHistory = USE_REAL_API ? realOrchestrator.cpuHistory : simOrchestrator.cpuHistory
  const setPolicy = USE_REAL_API ? realOrchestrator.setPolicy : simOrchestrator.setPolicy
  const clearLogs = USE_REAL_API ? realOrchestrator.clearLogs : simOrchestrator.clearLogs
  
  // Real API specific
  const isLoading = USE_REAL_API ? realOrchestrator.isLoading : false
  const error = USE_REAL_API ? realOrchestrator.error : null
  const isConnected = USE_REAL_API ? realOrchestrator.isConnected : true
  const refresh = USE_REAL_API ? realOrchestrator.refresh : undefined
  
  // Simulation specific
  const isSimulating = !USE_REAL_API && 'isSimulating' in simOrchestrator ? simOrchestrator.isSimulating : true
  const setIsSimulating = !USE_REAL_API && 'setIsSimulating' in simOrchestrator ? simOrchestrator.setIsSimulating : () => {}
  
  // Actions (handle both sync and async versions)
  const submitTask = USE_REAL_API ? realOrchestrator.submitTask : async (name: string, type: TaskType, priority: TaskPriority) => {
    simOrchestrator.submitTask(name, type, priority)
    return true
  }
  const addNode = USE_REAL_API ? realOrchestrator.addNode : async (_nodeData?: Partial<EdgeNode>) => {
    simOrchestrator.addNode()
    return true
  }
  const removeNode = USE_REAL_API ? realOrchestrator.removeNode : async (nodeId: string) => {
    simOrchestrator.removeNode(nodeId)
    return true
  }
  const retryTask = USE_REAL_API ? realOrchestrator.retryTask : async (taskId: string) => {
    simOrchestrator.retryTask(taskId)
    return true
  }
  
  const { state: persistedState, isLoaded: persistedLoaded } = usePersistentState()
  
  // Initialize alerts system
  useAlerts(nodes, tasks) // Alerts are self-managing via toast notifications
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  
  // Show connection status
  useEffect(() => {
    if (USE_REAL_API && !isConnected && !isLoading) {
      toast.warning('Disconnected from server. Reconnecting...')
    }
  }, [isConnected, isLoading])
  
  // Show errors
  useEffect(() => {
    if (error) {
      toast.error(error)
    }
  }, [error])
  
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
      
      // R for refresh
      if (e.key === 'r' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        refresh?.()
        toast.success('Data refreshed')
      }
      
      // N for new node (simulation mode only)
      if (!USE_REAL_API && e.key === 'n' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        if ('addNode' in simOrchestrator && typeof simOrchestrator.addNode === 'function' && simOrchestrator.addNode.length === 0) {
          (simOrchestrator.addNode as () => void)()
          toast.success('New node added')
        }
      }
      
      // T for new task
      if (e.key === 't' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        navigate('/scheduler')
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSimulating, setIsSimulating, refresh, navigate])
  
  // Handle task submission
  const handleSubmitTask = useCallback(async (name: string, type: TaskType, priority: TaskPriority) => {
    try {
      const success = await submitTask(name, type, priority)
      if (success) {
        toast.success(`Task "${name}" submitted successfully`)
      } else {
        toast.error(`Failed to submit task`)
      }
    } catch (error) {
      toast.error(`Failed to submit task: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [submitTask])
  
  // Handle node addition (for real API)
  const handleAddNode = useCallback(async (nodeData?: Partial<EdgeNode>) => {
    if (USE_REAL_API) {
      const data = nodeData || {
        name: `edge-node-${Date.now()}`,
        location: 'Unknown',
        region: 'us-east-1',
        ip: '0.0.0.0',
      }
      const success = await addNode(data)
      if (success) {
        toast.success('Node registered successfully')
      } else {
        toast.error('Failed to register node')
      }
    } else {
      // Simulation mode
      if ('addNode' in simOrchestrator && typeof simOrchestrator.addNode === 'function' && simOrchestrator.addNode.length === 0) {
        (simOrchestrator.addNode as () => void)()
        toast.success('New node added')
      }
    }
  }, [addNode, simOrchestrator])
  
  // Handle node removal
  const handleRemoveNode = useCallback(async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (node && node.tasksRunning > 0) {
      toast.error(`Cannot remove ${node.name} - has ${node.tasksRunning} running tasks`)
      return
    }
    const success = await removeNode(nodeId)
    if (success) {
      toast.success('Node removed successfully')
    } else {
      toast.error('Failed to remove node')
    }
  }, [nodes, removeNode])
  
  // Handle task retry - currently handled directly via retryTask prop
  // const handleRetryTask = useCallback(async (taskId: string) => {
  //   const success = await retryTask(taskId)
  //   if (success) {
  //     toast.success('Task retry initiated')
  //   } else {
  //     toast.error('Failed to retry task')
  //   }
  // }, [retryTask])
  
  return (
    <>
      <CommandPalette 
        isOpen={commandPaletteOpen} 
        onClose={() => setCommandPaletteOpen(false)} 
      />
      <Layout
        isSimulating={isSimulating}
        onToggleSimulation={() => setIsSimulating(!isSimulating)}
        isDark={persistedState.theme === 'dark'}
        onToggleTheme={toggleTheme}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      >
        <Routes>
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <Dashboard 
                nodes={nodes} 
                tasks={tasks} 
                logs={logs} 
                metrics={metrics}
                cpuHistory={cpuHistory}
              />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/nodes" 
          element={
            <ProtectedRoute permission="nodes:read">
              <EdgeNodes 
                nodes={nodes} 
                onAddNode={() => handleAddNode()}
                onRemoveNode={handleRemoveNode}
              />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/scheduler" 
          element={
            <ProtectedRoute permission="tasks:read">
              <TaskScheduler 
                tasks={tasks}
                onSubmitTask={handleSubmitTask}
                onRetryTask={retryTask}
              />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/monitoring" 
          element={
            <ProtectedRoute permission="monitoring:read">
              <Monitoring 
                nodes={nodes}
                metrics={metrics}
              />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/logs" 
          element={
            <ProtectedRoute permission="logs:read">
              <Logs 
                logs={logs}
                onClearLogs={clearLogs}
              />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/policies" 
          element={
            <ProtectedRoute permission="policies:read">
              <Policies 
                currentPolicy={policy}
                onPolicyChange={setPolicy}
              />
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
      </Routes>
      </Layout>
    </>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
