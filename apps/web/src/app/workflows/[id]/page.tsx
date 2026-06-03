'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { 
  Play, 
  ArrowLeft, 
  Settings, 
  History, 
  Activity, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  ChevronRight,
  GitBranch,
  RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

interface Execution {
  id: string
  status: string
  startedAt: string
  completedAt: string | null
  taskRuns: any[]
}

interface Workflow {
  id: string
  name: string
  description: string | null
  definition: {
    nodes: any[]
    edges: any[]
  }
  status: string
  executions: Execution[]
}

export default function WorkflowDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)

  useEffect(() => {
    void fetchWorkflow()
  }, [id])

  const fetchWorkflow = async () => {
    try {
      const response = await fetch(`/api/v2/workflows/${id}`)
      const data = await response.json()
      setWorkflow(data)
    } catch (error) {
      console.error('Failed to fetch workflow', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExecute = async () => {
    setExecuting(true)
    try {
      const response = await fetch(`/api/v2/workflows/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      })
      const data = await response.json()
      // router.push(`/workflows/${id}/executions/${data.executionId}`)
      void fetchWorkflow() // Refresh to show new execution
    } catch (error) {
      console.error('Failed to execute workflow', error)
    } finally {
      setExecuting(false)
    }
  }

  if (loading) {
    return <div className="p-8 animate-pulse">Loading workflow...</div>
  }

  if (!workflow) {
    return <div className="p-8 text-center">Workflow not found</div>
  }

  const latestExecution = workflow.executions[0]

  return (
    <div className="flex flex-col gap-6 p-8 max-w-7xl mx-auto w-full">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/workflows">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{workflow.name}</h1>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">v1.0.0</Badge>
          </div>
          <p className="text-muted-foreground text-sm">{workflow.description || 'Workflow orchestration sequence'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button size="sm" onClick={handleExecute} disabled={executing}>
            <Play className="mr-2 h-4 w-4" />
            {executing ? 'Starting...' : 'Run Workflow'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* DAG Visualization Placeholder */}
          <Card className="min-h-[400px] bg-secondary/5 border-border overflow-hidden relative">
            <CardHeader className="border-b border-border bg-card/50">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-primary" />
                  Workflow Structure (DAG)
                </CardTitle>
                <Badge variant="secondary">
                  {workflow.definition.nodes.length} Nodes • {workflow.definition.edges.length} Edges
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0 h-[400px] flex items-center justify-center">
               <div className="absolute inset-0 opacity-20 pointer-events-none" 
                    style={{ backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
               
               <div className="relative flex flex-col items-center gap-12 z-10 p-8 w-full overflow-auto">
                  {/* Simple vertical visualizer for demo */}
                  {workflow.definition.nodes.map((node, i) => (
                    <div key={node.id} className="relative flex flex-col items-center group">
                      <div className={cn(
                        "w-64 p-4 rounded-xl border-2 bg-card shadow-lg transition-all duration-300 group-hover:scale-105",
                        "border-border group-hover:border-primary/50"
                      )}>
                        <div className="flex items-center justify-between mb-2">
                          <Badge variant="outline" className="text-[10px]">{node.type}</Badge>
                          <Activity className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <h4 className="font-semibold text-sm">{node.name}</h4>
                        <div className="mt-2 text-[10px] text-muted-foreground font-mono truncate">
                          ID: {node.id}
                        </div>
                      </div>
                      {i < workflow.definition.nodes.length - 1 && (
                        <div className="h-12 w-0.5 bg-gradient-to-b from-primary/50 to-primary/10 relative">
                          <ChevronRight className="h-4 w-4 absolute -bottom-2 -left-[7px] rotate-90 text-primary/50" />
                        </div>
                      )}
                    </div>
                  ))}
               </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="history">
            <TabsList className="bg-card border border-border">
              <TabsTrigger value="history">
                <History className="mr-2 h-4 w-4" />
                Execution History
              </TabsTrigger>
              <TabsTrigger value="config">Config</TabsTrigger>
            </TabsList>
            <TabsContent value="history" className="mt-4">
              <div className="flex flex-col gap-3">
                {workflow.executions.map((exec) => (
                  <Card key={exec.id} className="hover:bg-secondary/5 transition-colors cursor-pointer">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "h-10 w-10 rounded-full flex items-center justify-center",
                          exec.status === 'COMPLETED' ? "bg-emerald-500/10 text-emerald-500" : 
                          exec.status === 'RUNNING' ? "bg-primary/10 text-primary" : 
                          "bg-destructive/10 text-destructive"
                        )}>
                          {exec.status === 'COMPLETED' ? <CheckCircle2 className="h-5 w-5" /> : 
                           exec.status === 'RUNNING' ? <RefreshCw className="h-5 w-5 animate-spin" /> : 
                           <AlertCircle className="h-5 w-5" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">Execution #{exec.id.slice(-6)}</span>
                            <Badge variant="outline" className="text-[10px] uppercase">{exec.status}</Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <Clock className="h-3 w-3" />
                            <span>Started {formatDistanceToNow(new Date(exec.startedAt))} ago</span>
                            {exec.completedAt && (
                              <>
                                <span>•</span>
                                <span>Took {formatDistanceToNow(new Date(exec.startedAt), { addSuffix: false })}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Success Rate</span>
                  <span className="font-semibold">92%</span>
                </div>
                <Progress value={92} className="h-1.5" />
              </div>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Total Runs</span>
                  <span className="text-xl font-bold">{workflow.executions.length}</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-xs text-muted-foreground">Avg. Duration</span>
                  <span className="text-xl font-bold">1.2m</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Triggers</CardTitle>
              <CardDescription>How this workflow is started</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
               <div className="p-3 rounded-lg bg-secondary/10 border border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Activity className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Manual</span>
                  </div>
                  <Badge className="bg-emerald-500/20 text-emerald-500 border-none">Enabled</Badge>
               </div>
               <div className="p-3 rounded-lg bg-secondary/10 border border-border flex items-center justify-between grayscale opacity-50">
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Schedule</span>
                  </div>
                  <Badge variant="outline" className="border-none">Disabled</Badge>
               </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ')
}
