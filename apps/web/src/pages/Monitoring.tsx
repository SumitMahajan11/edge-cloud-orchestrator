import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend
} from 'recharts'
import { Activity, Server, TrendingUp } from 'lucide-react'
import { StatusBadge } from '../components/shared/StatusBadge'
import type { EdgeNode, SystemMetrics } from '../types'
import { formatDuration } from '../lib/utils'

interface MonitoringProps {
  nodes: EdgeNode[]
  metrics: SystemMetrics
}

export function Monitoring({ nodes, metrics }: MonitoringProps) {
  const nodeBarData = nodes.map(node => ({
    name: node.name.split('-').pop() || node.name,
    cpu: Math.round(node.cpu),
    memory: Math.round(node.memory),
  }))
  
  const radarData = [
    { metric: 'CPU', value: Math.min(metrics.edgeUtilization, 100), fullMark: 100 },
    { metric: 'Memory', value: Math.min(nodes.reduce((sum, n) => sum + n.memory, 0) / Math.max(1, nodes.length), 100), fullMark: 100 },
    { metric: 'Latency', value: Math.min(100 - metrics.avgLatency / 2, 100), fullMark: 100 },
    { metric: 'Uptime', value: metrics.onlineNodes / Math.max(1, metrics.totalNodes) * 100, fullMark: 100 },
    { metric: 'Throughput', value: Math.min(metrics.throughput * 10, 100), fullMark: 100 },
    { metric: 'Efficiency', value: metrics.completionRate, fullMark: 100 },
  ]
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Monitoring</h2>
        <p className="text-muted-foreground">System performance and health metrics</p>
      </div>
      
      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* CPU/Memory Bar Chart */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Resource Utilization by Node
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={nodeBarData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  domain={[0, 100]}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Bar dataKey="cpu" name="CPU %" fill="hsl(175, 80%, 50%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="memory" name="Memory %" fill="hsl(210, 80%, 55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        {/* System Health Radar */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            System Health Overview
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  name="System Health"
                  dataKey="value"
                  stroke="hsl(175, 80%, 50%)"
                  fill="hsl(175, 80%, 50%)"
                  fillOpacity={0.3}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
      {/* Node Details Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            Node Details
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Node</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Location</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">CPU</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Memory</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Latency</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Uptime</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Tasks</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Last Heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">{node.name}</p>
                      <p className="text-xs font-mono text-muted-foreground">{node.ip}</p>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-foreground">{node.location}</span>
                    <p className="text-xs text-muted-foreground">{node.region}</p>
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={node.status} />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-foreground">{node.cpu.toFixed(1)}%</span>
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${node.cpu > 80 ? 'bg-destructive' : node.cpu > 60 ? 'bg-warning' : 'bg-primary'}`}
                          style={{ width: `${Math.min(node.cpu, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-foreground">{node.memory.toFixed(1)}%</span>
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${node.memory > 80 ? 'bg-destructive' : node.memory > 60 ? 'bg-warning' : 'bg-info'}`}
                          style={{ width: `${Math.min(node.memory, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm font-mono text-foreground">{Math.round(node.latency)}ms</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm font-mono text-foreground">{node.uptime.toFixed(1)}%</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm font-mono text-foreground">{node.tasksRunning}/{node.maxTasks}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(Date.now() - node.lastHeartbeat.getTime())} ago
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
