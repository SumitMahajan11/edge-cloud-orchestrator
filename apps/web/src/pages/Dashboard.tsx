import { useMemo } from 'react'
import { MetricCard } from '../components/shared/MetricCard'
import { StatusBadge } from '../components/shared/StatusBadge'
import { AnimatedCounter } from '../components/shared/AnimatedCounter'
import { WorldMap } from '../components/charts/WorldMap'
import { HealthScoreGauge } from '../components/charts/HealthScoreGauge'
import { 
  Server, 
  CheckCircle2, 
  Clock, 
  DollarSign,
  Activity,
  Globe,
} from 'lucide-react'
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import type { EdgeNode, Task, LogEntry, SystemMetrics } from '../types'
import { formatCurrency } from '../lib/utils'

interface DashboardProps {
  nodes: EdgeNode[]
  tasks: Task[]
  logs: LogEntry[]
  metrics: SystemMetrics
  cpuHistory: { timestamp: Date; value: number }[]
}

const COLORS = ['hsl(175, 80%, 50%)', 'hsl(210, 80%, 55%)']

export function Dashboard({ nodes, logs, metrics, cpuHistory }: DashboardProps) {
  const chartData = useMemo(() => {
    return cpuHistory.map((point, index) => ({
      name: `${index * 2}s`,
      cpu: Math.round(point.value),
    }))
  }, [cpuHistory])
  
  const taskDistributionData = [
    { name: 'Edge', value: metrics.taskDistribution.edge },
    { name: 'Cloud', value: metrics.taskDistribution.cloud },
  ]
  
  const recentLogs = logs.slice(0, 8)
  const onlineNodes = nodes.filter(n => n.status === 'online')
  
  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Nodes Online"
          value={<AnimatedCounter value={metrics.onlineNodes} />}
          subtitle={`${metrics.totalNodes} total nodes`}
          icon={Server}
          trend={metrics.onlineNodes > metrics.totalNodes * 0.8 ? 'up' : 'neutral'}
          trendValue={`${Math.round((metrics.onlineNodes / Math.max(1, metrics.totalNodes)) * 100)}% uptime`}
        />
        <MetricCard
          title="Tasks Total"
          value={<AnimatedCounter value={metrics.totalTasks} />}
          subtitle={`${metrics.completedTasks} completed`}
          icon={CheckCircle2}
          trend={metrics.completedTasks > metrics.failedTasks ? 'up' : 'down'}
          trendValue={`${metrics.failedTasks} failed`}
        />
        <MetricCard
          title="Avg Latency"
          value={`${Math.round(metrics.avgLatency)}ms`}
          subtitle="Network response time"
          icon={Clock}
          trend={metrics.avgLatency < 50 ? 'up' : 'down'}
          trendValue={metrics.avgLatency < 50 ? 'Optimal' : 'High'}
        />
        <MetricCard
          title="Total Cost"
          value={formatCurrency(metrics.totalCost)}
          subtitle="Accumulated costs"
          icon={DollarSign}
          trend="neutral"
          trendValue="Real-time"
        />
        {/* Health Score Card */}
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
          <HealthScoreGauge score={metrics.healthScore} size={80} />
          <div>
            <p className="text-sm font-medium text-muted-foreground">Health Score</p>
            <p className="text-lg font-semibold text-foreground">
              {metrics.healthScore >= 80 ? 'Healthy' : metrics.healthScore >= 60 ? 'Warning' : 'Critical'}
            </p>
            <p className="text-xs text-muted-foreground">
              {metrics.completionRate.toFixed(1)}% completion rate
            </p>
          </div>
        </div>
      </div>
      
      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* CPU History Chart */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">CPU History</h3>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4" />
              <span>Last 20 data points</span>
            </div>
          </div>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(175, 80%, 50%)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(175, 80%, 50%)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  domain={[0, 100]}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
                <Area 
                  type="monotone" 
                  dataKey="cpu" 
                  stroke="hsl(175, 80%, 50%)" 
                  fillOpacity={1} 
                  fill="url(#cpuGradient)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        {/* World Map */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Global Node Map
          </h3>
          <WorldMap nodes={nodes} className="h-[250px]" />
        </div>
      </div>
      
      {/* Task Distribution & Stats Row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Task Distribution */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Task Distribution</h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={taskDistributionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {taskDistributionData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 mt-2">
            {taskDistributionData.map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: COLORS[index] }}
                />
                <span className="text-sm text-muted-foreground">
                  {entry.name}: {entry.value}
                </span>
              </div>
            ))}
          </div>
        </div>
        
        {/* Node Status List */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Node Status</h3>
          <div className="space-y-3">
            {onlineNodes.slice(0, 6).map((node) => (
              <div 
                key={node.id} 
                className="flex items-center justify-between p-3 rounded-lg bg-secondary/50"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={node.status} />
                  <div>
                    <p className="text-sm font-medium text-foreground">{node.name}</p>
                    <p className="text-xs text-muted-foreground">{node.location}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-mono text-foreground">{node.cpu.toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground">CPU</p>
                  </div>
                  <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${node.cpu}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Recent Activity */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Recent Activity</h3>
        <div className="space-y-3 max-h-[300px] overflow-y-auto scrollbar-thin">
          {recentLogs.map((log) => (
            <div 
              key={log.id} 
              className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50"
            >
              <StatusBadge status={log.level} showDot={false} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  <span className="text-xs text-muted-foreground">[{log.source}]</span>
                </div>
                <p className="text-sm text-foreground mt-1">{log.message}</p>
              </div>
            </div>
          ))}
          {recentLogs.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No recent activity
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
