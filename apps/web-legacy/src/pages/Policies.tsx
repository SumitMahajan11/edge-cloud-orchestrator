import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { 
  Brain, 
  DollarSign, 
  RefreshCw, 
  Scale, 
  Check,
  Code2,
  Loader2
} from 'lucide-react'
import type { SchedulingPolicy } from '../types'
import { cn } from '../lib/utils'
import { usePolicies, useUpdatePolicy, useThresholds, useUpdateThreshold } from '../hooks/usePolicies'
import { useAuth } from '../context/AuthContext'
import { toast } from 'sonner'
import { DecisionLogPanel } from '../components/policies/DecisionLogPanel'

interface PolicyConfig {
  id: SchedulingPolicy
  name: string
  description: string
  icon: React.ElementType
  pseudocode: string
}

const POLICIES: PolicyConfig[] = [
  {
    id: 'latency-aware',
    name: 'Latency-Aware',
    description: 'Routes tasks to edge nodes with lowest latency when CPU usage is below threshold',
    icon: Brain,
    pseudocode: `IF best_node.latency < 50ms AND best_node.cpu < 80%:
  route_to_edge(best_node)
  reason = "Low latency and acceptable CPU"
ELSE:
  route_to_cloud()
  reason = "Edge latency too high or CPU saturated"`,
  },
  {
    id: 'cost-aware',
    name: 'Cost-Aware',
    description: 'Prioritizes the most cost-effective edge nodes while maintaining performance',
    icon: DollarSign,
    pseudocode: `IF cheapest_node.cpu < 70%:
  route_to_edge(cheapest_node)
  reason = "Cost-optimized with acceptable load"
ELSE:
  route_to_cloud()
  reason = "Cheapest node overloaded"`,
  },
  {
    id: 'round-robin',
    name: 'Round Robin',
    description: 'Distributes tasks evenly across all available edge nodes in rotation',
    icon: RefreshCw,
    pseudocode: `least_loaded = find_node_with_fewest_tasks()
IF least_loaded.tasks < least_loaded.max_tasks:
  route_to_edge(least_loaded)
  reason = "Round-robin selection"
ELSE:
  route_to_cloud()
  reason = "All edge nodes at capacity"`,
  },
  {
    id: 'load-balanced',
    name: 'Load Balanced',
    description: 'Sophisticated resource-aware balancing based on real-time CPU and memory metrics',
    icon: Scale,
    pseudocode: `FOR node IN nodes:
  score = (1 - node.cpu) * 0.7 + (1 - node.memory) * 0.3
best_node = find_max_score(nodes)
IF best_node.score > 0.4:
  route_to_edge(best_node)
ELSE:
  route_to_cloud()`,
  },
  {
    id: 'ml-optimized',
    name: 'ML-Optimized',
    description: 'Dynamic neural network routing based on real-time telemetry and historical outcomes',
    icon: Brain,
    pseudocode: `features = extract_telemetry(task, nodes)
prediction = ml_model.predict(features)
score = post_process(prediction)
best_node = argmax(score)
IF best_node.score > threshold:
  route_to_edge(best_node)
  explanation = shap_explain(prediction)
ELSE:
  suppress_ml()
  route_load_balanced()`,
  },
]

export function Policies() {
  const { data: policiesData, isLoading: policiesLoading } = usePolicies()
  const { data: thresholdsData, isLoading: thresholdsLoading } = useThresholds()
  const thresholds = thresholdsData as { latency?: number; stale?: number } | undefined
  const updatePolicyMutation = useUpdatePolicy()
  const updateThresholdMutation = useUpdateThreshold()

  const { hasPermission } = useAuth()
  const canUpdate = hasPermission('policies:update')

  const [selectedPolicy, setSelectedPolicy] = useState<SchedulingPolicy>('latency-aware')
  
  useEffect(() => {
    if (policiesData && 'active' in policiesData) {
      setSelectedPolicy((policiesData as any).active)
    }
  }, [policiesData])

  const handlePolicySelect = async (policy: SchedulingPolicy) => {
    try {
      await updatePolicyMutation.mutateAsync(policy)
      setSelectedPolicy(policy)
      toast.success(`Policy updated to ${policy}`)
    } catch (err) {
      toast.error('Failed to update policy')
    }
  }

  const handleThresholdChange = (type: 'latency' | 'stale', value: number) => {
    updateThresholdMutation.mutate({ [type]: value })
  }
  
  const activePolicy = POLICIES.find(p => p.id === selectedPolicy)
  
  if (policiesLoading || thresholdsLoading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Scheduling Policies</h2>
        <p className="text-muted-foreground">Configure how tasks are distributed between edge and cloud</p>
      </div>
      
      {/* Threshold Calibration */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Threshold Calibration</h3>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex justify-between">
              <label className="text-sm font-medium text-muted-foreground">High Latency Threshold (ms)</label>
              <span className="text-sm font-mono text-primary font-bold">{thresholds?.latency ?? 200}ms</span>
            </div>
            <input 
              type="range" 
              min="10" 
              max="1000" 
              step="10"
              value={thresholds?.latency ?? 200}
              onChange={(e) => handleThresholdChange('latency', parseInt(e.target.value))}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <p className="text-xs text-muted-foreground">
              Nodes with latency above this value will be deprioritized or marked as Degraded.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between">
              <label className="text-sm font-medium text-muted-foreground">Node Stale Threshold (sec)</label>
              <span className="text-sm font-mono text-warning font-bold">{thresholds?.stale ?? 30}s</span>
            </div>
            <input 
              type="range" 
              min="5" 
              max="60" 
              step="5"
              value={thresholds?.stale ?? 30}
              onChange={(e) => handleThresholdChange('stale', parseInt(e.target.value))}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-warning"
            />
            <p className="text-xs text-muted-foreground">
              Duration without heartbeats before a node is marked as Stale (yellow indicator).
            </p>
          </div>
        </div>
      </div>

      {/* Policy Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {POLICIES.map((policy) => {
          const Icon = policy.icon
          const isActive = selectedPolicy === policy.id
          const isPending = updatePolicyMutation.isPending && updatePolicyMutation.variables === policy.id
          
          return (
            <motion.button
              key={policy.id}
              onClick={() => canUpdate && handlePolicySelect(policy.id)}
              disabled={!canUpdate || updatePolicyMutation.isPending}
              whileHover={canUpdate ? { scale: 1.01 } : {}}
              whileTap={canUpdate ? { scale: 0.99 } : {}}
              className={cn(
                'relative text-left rounded-xl border p-6 transition-all duration-300',
                isActive 
                  ? 'border-primary bg-primary/5 glow-primary' 
                  : 'border-border bg-card hover:border-primary/30',
                updatePolicyMutation.isPending && !isPending && 'opacity-50',
                !canUpdate && 'cursor-not-allowed opacity-70'
              )}
            >
              {(isActive || isPending) && (
                <div className="absolute top-4 right-4">
                  <div className="flex items-center gap-1 text-primary text-xs font-medium">
                    {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {isPending ? 'Updating...' : 'Active'}
                  </div>
                </div>
              )}
              
              <div className="flex items-start gap-4">
                <div className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-lg transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                )}>
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h3 className={cn(
                    'text-lg font-semibold',
                    isActive ? 'text-primary' : 'text-foreground'
                  )}>
                    {policy.name}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {policy.description}
                  </p>
                </div>
              </div>
            </motion.button>
          )
        })}
      </div>
      
      {/* Pseudocode Display */}
      {activePolicy && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-border bg-card overflow-hidden"
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/50">
            <Code2 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Decision Logic: {activePolicy.name}
            </h3>
          </div>
          <div className="p-4 bg-secondary/30">
            <pre className="text-sm font-mono text-foreground overflow-x-auto">
              <code>{activePolicy.pseudocode}</code>
            </pre>
          </div>
        </motion.div>
      )}
      
      {/* Policy Comparison */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Policy Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Policy</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Best For</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Edge Usage</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Complexity</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-3 px-4 text-sm font-medium text-foreground">Latency-Aware</td>
                <td className="py-3 px-4 text-sm text-muted-foreground">Real-time applications</td>
                <td className="py-3 px-4 text-sm text-foreground">High</td>
                <td className="py-3 px-4"><span className="text-sm text-success">Low</span></td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-3 px-4 text-sm font-medium text-foreground">Cost-Aware</td>
                <td className="py-3 px-4 text-sm text-muted-foreground">Budget optimization</td>
                <td className="py-3 px-4 text-sm text-foreground">Medium</td>
                <td className="py-3 px-4"><span className="text-sm text-success">Low</span></td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-3 px-4 text-sm font-medium text-foreground">Round Robin</td>
                <td className="py-3 px-4 text-sm text-muted-foreground">Even distribution</td>
                <td className="py-3 px-4 text-sm text-foreground">High</td>
                <td className="py-3 px-4"><span className="text-sm text-success">Low</span></td>
              </tr>
              <tr>
                <td className="py-3 px-4 text-sm font-medium text-foreground">Load Balanced</td>
                <td className="py-3 px-4 text-sm text-muted-foreground">Resource optimization</td>
                <td className="py-3 px-4 text-sm text-foreground">Adaptive</td>
                <td className="py-3 px-4"><span className="text-sm text-warning">Medium</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Decision Log Panel */}
      <DecisionLogPanel />
    </div>
  )
}
