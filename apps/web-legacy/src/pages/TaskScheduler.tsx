import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { StatusBadge } from '../components/shared/StatusBadge'
import { 
  Send, 
  Filter,
  RotateCcw,
  Inbox,
  Bookmark,
  Eye,
  Loader2,
  XCircle,
  Brain as BrainIcon
} from 'lucide-react'
import type { Task, TaskType, TaskPriority, TaskTemplate, RuntimeType } from '../types'
import { formatCurrency, formatDuration } from '../lib/utils'
import { useTasks, useSubmitTask, useRetryTask, useCancelTask } from '../hooks/useTasks'
import { useNodes } from '../hooks/useNodes'
import { useLogs } from '../hooks/useLogs'
import { TaskDetailDrawer } from '../components/scheduler/TaskDetailDrawer'
import { useAuth } from '../context/AuthContext'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'



const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'critical']

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'image-prod',
    name: 'Production Image Analysis',
    type: 'Image Classification',
    priority: 'high',
    description: 'High-priority image classification for production workloads',
    estimatedDuration: 1500,
    estimatedCost: 0.0005,
    runtime: 'docker',
  },
  {
    id: 'data-batch',
    name: 'Nightly Data Aggregation',
    type: 'Data Aggregation',
    priority: 'medium',
    description: 'Scheduled data aggregation task for analytics',
    estimatedDuration: 5000,
    estimatedCost: 0.002,
    runtime: 'native',
  },
  {
    id: 'model-infer',
    name: 'Real-time Inference',
    type: 'Model Inference',
    priority: 'critical',
    description: 'Low-latency model inference for live traffic',
    estimatedDuration: 500,
    estimatedCost: 0.0002,
    runtime: 'wasm',
  },
  {
    id: 'video-proc',
    name: 'Video Processing',
    type: 'Video Processing',
    priority: 'low',
    description: 'Background video processing and encoding',
    estimatedDuration: 8000,
    estimatedCost: 0.003,
    runtime: 'docker',
  },
  {
    id: 'anomaly-check',
    name: 'Anomaly Detection',
    type: 'Anomaly Detection',
    priority: 'high',
    description: 'Security and performance anomaly detection',
    estimatedDuration: 2000,
    estimatedCost: 0.0008,
    runtime: 'native',
  },
  {
    id: 'etl-pipeline',
    name: 'ETL Data Pipeline',
    type: 'ETL Pipeline',
    priority: 'medium',
    description: 'Extract, transform, load data pipeline execution',
    estimatedDuration: 6000,
    estimatedCost: 0.0025,
    runtime: 'docker',
  },
]

const getTemplateIcon = (type: TaskType) => {
  switch (type) {
    case 'Machine Learning Training': return BrainIcon
    default: return Bookmark
  }
}

export function TaskScheduler() {
  const [filter, setFilter] = useState<Task['status'] | 'all'>('all')
  const { data: tasks = [], isLoading } = useTasks(filter !== 'all' ? { status: filter } : undefined)
  const submitMutation = useSubmitTask()
  const retryMutation = useRetryTask()
  const cancelMutation = useCancelTask()

  const { data: nodes = [] } = useNodes()
  const { data: logs = [] } = useLogs()
  const [searchParams, setSearchParams] = useSearchParams()

  const { hasPermission } = useAuth()
  const canCreate = hasPermission('tasks:create')
  const canRetry = hasPermission('tasks:update')
  const canCancel = hasPermission('tasks:delete')

  const [taskName, setTaskName] = useState('')
  const [taskType, setTaskType] = useState<TaskType>('Image Classification')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [cpuCores, setCpuCores] = useState(2)
  const [memoryGB, setMemoryGB] = useState(4)
  const [runtime, setRuntime] = useState<RuntimeType>('docker')
  const [affinity, setAffinity] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(searchParams.get('task'))
  const [isDrawerOpen, setIsDrawerOpen] = useState(!!searchParams.get('task'))

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null
  const selectedNode = nodes.find(n => n.id === selectedTask?.nodeId)

  const handleViewTask = (taskId: string) => {
    setSelectedTaskId(taskId)
    setIsDrawerOpen(true)
    setSearchParams({ task: taskId }, { replace: true })
  }

  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskName.trim()) return
    
    try {
      await submitMutation.mutateAsync({ 
        name: taskName, 
        type: taskType, 
        priority,
        runtime,
        affinity: affinity || undefined,
        specs: { cpuCores, memoryGB }
      })
      toast.success(`Task "${taskName}" submitted`)
      setTaskName('')
      setAffinity('')
    } catch (err) {
      toast.error('Failed to submit task')
    }
  }
  
  const handleTemplateSelect = (template: TaskTemplate) => {
    setTaskName(template.name)
    setTaskType(template.type)
    setPriority(template.priority)
    if (template.runtime) setRuntime(template.runtime)
    setShowTemplates(false)
  }
  
  const sortedTasks = [...tasks].sort((a, b) => 
    b.submittedAt.getTime() - a.submittedAt.getTime()
  )
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Task Scheduler</h2>
        <p className="text-muted-foreground">Submit and manage compute tasks</p>
      </div>
      
      {/* Submit Form */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Submit New Task
          </h3>
          <button
            type="button"
            onClick={() => setShowTemplates(!showTemplates)}
            className="text-sm text-primary hover:text-primary/80 flex items-center gap-1"
          >
            <Bookmark className="h-4 w-4" />
            {showTemplates ? 'Hide Templates' : 'Use Template'}
          </button>
        </div>
        
        {/* Templates */}
        {showTemplates && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            {TASK_TEMPLATES.map((template) => {
              const Icon = getTemplateIcon(template.type)
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleTemplateSelect(template)}
                  className="text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-md bg-secondary">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{template.name}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{template.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <StatusBadge status={template.priority} showDot={false} />
                        <span className="text-xs text-muted-foreground">~{formatDuration(template.estimatedDuration)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-6 items-end">
          <div className="md:col-span-2">
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Task Name
            </label>
            <Input
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Enter task name..."
              className="bg-secondary"
              disabled={!canCreate}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Runtime
            </label>
            <Select value={runtime} onValueChange={(v) => setRuntime(v as RuntimeType)} disabled={!canCreate}>
              <SelectTrigger className="bg-secondary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="native">Native</SelectItem>
                <SelectItem value="docker">Docker</SelectItem>
                <SelectItem value="wasm">Wasm</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Affinity
            </label>
            <Input
              value={affinity}
              onChange={(e) => setAffinity(e.target.value)}
              placeholder="e.g. gpu:true"
              className="bg-secondary"
              disabled={!canCreate}
            />
          </div>
          <div className="md:col-span-2 flex gap-2">
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block text-center">
                CPU / RAM
              </label>
              <div className="flex gap-1">
                <Input 
                  type="number"
                  min={1}
                  value={cpuCores}
                  onChange={(e) => setCpuCores(parseInt(e.target.value) || 1)}
                  className="bg-secondary px-2 text-center"
                  disabled={!canCreate}
                />
                <Input 
                  type="number"
                  min={1}
                  value={memoryGB}
                  onChange={(e) => setMemoryGB(parseInt(e.target.value) || 1)}
                  className="bg-secondary px-2 text-center"
                  disabled={!canCreate}
                />
              </div>
            </div>
            <div className="w-24">
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Priority
              </label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)} disabled={!canCreate}>
                <SelectTrigger className="bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="mb-0.5" disabled={!canCreate || submitMutation.isPending}>
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      </div>
      
      {/* Filter Bar */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Filter:</span>
        <div className="flex gap-1">
          {(['all', 'pending', 'running', 'completed', 'failed'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === status 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>
      
      {/* Task Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Task ID</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Type</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Runtime</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Priority</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Target</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Latency</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Cost</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && tasks.length === 0 ? (
                 <tr>
                    <td colSpan={10} className="py-12 text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Loading tasks...</p>
                    </td>
                 </tr>
              ) : sortedTasks.map((task) => (
                <tr key={task.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-4">
                    <code className="text-xs font-mono text-muted-foreground">{task.id.slice(0, 8)}</code>
                  </td>
                  <td className="py-3 px-4">
                    <p className="text-sm font-medium text-foreground">{task.name}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[150px]">{task.reason}</p>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-foreground">{task.type}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs uppercase font-bold text-primary bg-primary/5 px-2 py-0.5 rounded border border-primary/10">
                      {task.runtime}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={task.priority} showDot={false} />
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={task.target} showDot={false} />
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm font-mono text-foreground">{Math.round(task.latencyMs)}ms</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm font-mono text-foreground">{formatCurrency(task.cost)}</span>
                  </td>
                  <td className="py-3 px-4 flex gap-2">
                    <button
                      onClick={() => handleViewTask(task.id)}
                      className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="View details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {task.status === 'failed' && canRetry && (
                      <button
                        onClick={() => retryMutation.mutate(task.id)}
                        disabled={retryMutation.isPending}
                        className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                        title="Retry task"
                      >
                        <RotateCcw className={retryMutation.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                      </button>
                    )}
                    {(task.status === 'pending' || task.status === 'running') && canCancel && (
                       <button
                        onClick={() => cancelMutation.mutate(task.id)}
                        disabled={cancelMutation.isPending}
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        title="Cancel task"
                      >
                        <XCircle className={cancelMutation.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {!isLoading && tasks.length === 0 && (
          <div className="text-center py-16">
            <Inbox className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No tasks found</h3>
            <p className="text-muted-foreground">
              {filter === 'all' ? 'Submit your first task to get started' : `No ${filter} tasks`}
            </p>
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskDetailDrawer 
          task={selectedTask}
          isOpen={isDrawerOpen}
          onOpenChange={setIsDrawerOpen}
          logs={logs}
          node={selectedNode}
          onRetry={canRetry ? (t) => retryMutation.mutate(t.id) : undefined}
          onCancel={canCancel ? (t) => cancelMutation.mutate(t.id) : undefined}
        />
      )}
    </div>
  )
}
