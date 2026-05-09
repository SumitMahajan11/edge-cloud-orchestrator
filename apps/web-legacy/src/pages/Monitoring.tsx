import * as React from 'react'
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
  Radar,
  AreaChart,
  Area,
  LineChart,
  Line
} from 'recharts'
import { 
  Activity, 
  Server, 
  Loader2, 
  Brain, 
  Network, 
  ShieldAlert, 
  Zap,
  Globe,
  RefreshCw,
  Cpu,
  Database,
  Shield,
  Leaf,
  BarChart3,
  AlertCircle,
  TrendingUp
} from 'lucide-react'
import { StatusBadge } from '../components/shared/StatusBadge'
import { LiveIndicator } from '../components/shared/LiveIndicator'
import { useNodes } from '../hooks/useNodes'
import { useSystemMetrics, useMLMetrics, useNetworkMetrics, useCircuitBreakers } from '../hooks/useMetrics'
import { cn } from '../lib/utils'
import { Badge } from '../components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Button } from '../components/ui/button'

export function Monitoring() {
  const [activeTab, setActiveTab] = React.useState('infrastructure')
  const { data: nodes = [], isLoading: nodesLoading } = useNodes()
  const { isLoading: metricsLoading } = useSystemMetrics()
  
  // These hooks are called to ensure data is fetched and cached, 
  // though we mostly use dummy data for the complex charts in this demo.
  useMLMetrics()
  useNetworkMetrics()
  useCircuitBreakers()

  if ((nodesLoading || metricsLoading) && nodes.length === 0) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-card/50 p-6 rounded-xl border border-border gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-2xl font-bold text-foreground">Mission Observability</h2>
            <LiveIndicator />
          </div>
          <p className="text-muted-foreground text-sm font-mono uppercase tracking-widest opacity-70">Unified Multi-Cloud Telemetry Stream</p>
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
          <TabsList className="bg-secondary/50 border border-border/50 h-10 p-1">
            <TabsTrigger value="infrastructure" className="text-xs gap-2">
              <Server className="h-3 w-3" />
              <span>Infra</span>
            </TabsTrigger>
            <TabsTrigger value="ml-pipeline" className="text-xs gap-2">
              <Brain className="h-3 w-3" />
              <span>ML Intelligence</span>
            </TabsTrigger>
            <TabsTrigger value="carbon-cost" className="text-xs gap-2">
              <Leaf className="h-3 w-3" />
              <span>Eco & Cost</span>
            </TabsTrigger>
            <TabsTrigger value="circuit-breakers" className="text-xs gap-2">
              <ShieldAlert className="h-3 w-3" />
              <span>Resilience</span>
            </TabsTrigger>
            <TabsTrigger value="traces" className="text-xs gap-2">
              <Activity className="h-3 w-3" />
              <span>Traces</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-[600px]">
        <Tabs value={activeTab} className="w-full">
          {/* 1. Infrastructure Tab */}
          <TabsContent value="infrastructure" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-6">
                {/* Fleet Saturation */}
                <div className="card-brief p-6 h-[400px]">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-primary" />
                      Fleet Saturation
                    </h3>
                    <div className="flex gap-4 text-[10px] font-mono text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                        <span>CPU %</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        <span>RAM %</span>
                      </div>
                    </div>
                  </div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={nodes.slice(0, 15).map(n => ({ name: n.name.split('-').pop() || '', cpu: n.cpu, mem: n.memory }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                        <XAxis dataKey="name" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#0a0a0f', border: '1px solid #27272a' }} />
                        <Bar dataKey="cpu" fill="#00d4aa" radius={[2, 2, 0, 0]} barSize={12} />
                        <Bar dataKey="mem" fill="#3b82f6" radius={[2, 2, 0, 0]} barSize={12} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Node Matrix */}
                <div className="card-brief p-0 overflow-hidden">
                  <div className="p-4 border-b border-border/50 flex items-center justify-between bg-secondary/10">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 text-primary" />
                      Regional Status Matrix
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="bg-secondary/30 border-b border-border/50">
                        <tr>
                          <th className="text-left p-3 text-muted-foreground font-bold">NODE_ID</th>
                          <th className="text-left p-3 text-muted-foreground font-bold">UPLINK</th>
                          <th className="text-left p-3 text-muted-foreground font-bold">RESOURCE_MAPPING</th>
                          <th className="text-right p-3 text-muted-foreground font-bold">STATE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nodes.slice(0, 10).map((node) => (
                          <tr key={node.id} className="border-b border-border/10 hover:bg-white/5 transition-colors group">
                            <td className="p-3 font-bold text-foreground">{(node.id.split('-')[0] ?? '').toUpperCase()}</td>
                            <td className="p-3 text-muted-foreground">{node.region} · {Math.round(node.latency)}ms</td>
                            <td className="p-3">
                              <div className="flex items-center gap-4">
                                <div className="flex-1 max-w-[100px] h-1 bg-secondary rounded-full overflow-hidden">
                                  <div className="h-full bg-primary" style={{ width: `${node.cpu}%` }} />
                                </div>
                                <span className="text-[10px] opacity-50">{Math.round(node.cpu)}% CPU</span>
                              </div>
                            </td>
                            <td className="p-3 text-right">
                              <StatusBadge status={node.status} className="h-5 px-2 text-[9px] font-black" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                <div className="card-brief p-6 space-y-6">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Traffic Analysis</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-end">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Ingress</p>
                        <p className="text-xl font-mono font-black">1.2 GB/s</p>
                      </div>
                      <div className="h-8 w-24 bg-primary/10 rounded flex items-end gap-0.5 p-1">
                        {[4, 7, 5, 8, 3, 9, 6, 8].map((h, i) => (
                          <div key={i} className="flex-1 bg-primary/40 rounded-t-[1px]" style={{ height: `${h * 10}%` }} />
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Requests</p>
                        <p className="text-xl font-mono font-black">8.4k rps</p>
                      </div>
                      <div className="h-8 w-24 bg-blue-500/10 rounded flex items-end gap-0.5 p-1">
                        {[6, 4, 8, 3, 7, 5, 9, 4].map((h, i) => (
                          <div key={i} className="flex-1 bg-blue-500/40 rounded-t-[1px]" style={{ height: `${h * 10}%` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card-brief p-6">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Topology Summary</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-secondary/20 p-3 rounded-lg border border-border/50">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase mb-1">Active Nodes</p>
                      <p className="text-lg font-black font-mono">{nodes.length}</p>
                    </div>
                    <div className="bg-secondary/20 p-3 rounded-lg border border-border/50">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase mb-1">Avg Latency</p>
                      <p className="text-lg font-black font-mono">24ms</p>
                    </div>
                    <div className="bg-secondary/20 p-3 rounded-lg border border-border/50">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase mb-1">Availability</p>
                      <p className="text-lg font-black font-mono text-primary">99.98%</p>
                    </div>
                    <div className="bg-secondary/20 p-3 rounded-lg border border-border/50">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase mb-1">Total Power</p>
                      <p className="text-lg font-black font-mono">420 TFlops</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ML Intelligence Tab */}
          <TabsContent value="ml-pipeline" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="card-brief p-6 h-[400px]">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    Model Drift & Feature Stability
                  </h3>
                  <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">v2.4.0-PROD</Badge>
                </div>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[
                      { time: '10:00', drift: 0.12, threshold: 0.45 },
                      { time: '11:00', drift: 0.14, threshold: 0.45 },
                      { time: '12:00', drift: 0.11, threshold: 0.45 },
                      { time: '13:00', drift: 0.18, threshold: 0.45 },
                      { time: '14:00', drift: 0.15, threshold: 0.45 },
                      { time: '15:00', drift: 0.13, threshold: 0.45 },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                      <XAxis dataKey="time" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: '#0a0a0f', border: '1px solid #27272a' }} />
                      <Line type="monotone" dataKey="drift" stroke="#00d4aa" strokeWidth={3} dot={{ fill: '#00d4aa' }} />
                      <Line type="stepAfter" dataKey="threshold" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card-brief p-6 h-[400px]">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Optimizer Reward Signal
                  </h3>
                </div>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="80%" data={[
                      { subject: 'Latency', A: 95, fullMark: 100 },
                      { subject: 'Cost', A: 82, fullMark: 100 },
                      { subject: 'Carbon', A: 91, fullMark: 100 },
                      { subject: 'Affinity', A: 85, fullMark: 100 },
                      { subject: 'Balance', A: 78, fullMark: 100 },
                    ]}>
                      <PolarGrid stroke="#ffffff10" />
                      <PolarAngleAxis dataKey="subject" stroke="#6b7280" fontSize={10} />
                      <Radar name="Scheduler" dataKey="A" stroke="#00d4aa" fill="#00d4aa" fillOpacity={0.3} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="card-brief p-6 space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Active Model</h4>
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-primary/10 rounded-xl">
                    <Brain className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-bold text-foreground">XGBoost-Regional-v4</p>
                    <p className="text-xs text-muted-foreground">Retrained: 2h ago</p>
                  </div>
                </div>
                <div className="pt-2">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-muted-foreground">Precision</span>
                    <span className="text-primary font-bold">98.4%</span>
                  </div>
                  <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: '98.4%' }} />
                  </div>
                </div>
              </div>
              
              <div className="card-brief p-6 space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Training Pipeline</h4>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
                    <span className="text-xs font-bold">Awaiting Validation</span>
                  </div>
                  <span className="text-[10px] font-mono opacity-50">#JOB-4912</span>
                </div>
              </div>

              <div className="card-brief p-6 space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Drift Alerts</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-2 rounded bg-emerald-500/5 border border-emerald-500/20">
                    <Shield className="h-3 w-3 text-emerald-500" />
                    <span className="text-[10px] font-bold text-emerald-500">FEATURE_STABLE</span>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Carbon & Cost Tab */}
          <TabsContent value="carbon-cost" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
             <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 card-brief p-6 h-[400px]">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                      <Leaf className="h-4 w-4 text-emerald-500" />
                      Ecological Footprint (gCO₂/kWh)
                    </h3>
                  </div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={[
                        { time: 'Mon', carbon: 320 },
                        { time: 'Tue', carbon: 280 },
                        { time: 'Wed', carbon: 350 },
                        { time: 'Thu', carbon: 240 },
                        { time: 'Fri', carbon: 210 },
                        { time: 'Sat', carbon: 190 },
                        { time: 'Sun', carbon: 180 },
                      ]}>
                        <defs>
                          <linearGradient id="colorCarbon" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                        <XAxis dataKey="time" stroke="#6b7280" fontSize={10} />
                        <YAxis stroke="#6b7280" fontSize={10} />
                        <Tooltip contentStyle={{ backgroundColor: '#0a0a0f', border: '1px solid #27272a' }} />
                        <Area type="monotone" dataKey="carbon" stroke="#10b981" fillOpacity={1} fill="url(#colorCarbon)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="card-brief p-6 flex flex-col justify-between">
                  <div className="space-y-6">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Eco Efficiency</h3>
                    <div className="flex items-center justify-center py-8">
                      <div className="relative h-40 w-40 flex items-center justify-center">
                        <svg className="h-full w-full -rotate-90">
                          <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-secondary/50" />
                          <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray={440} strokeDashoffset={440 - (440 * 0.85)} className="text-emerald-500 transition-all duration-1000" />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-3xl font-black font-mono">85%</span>
                          <span className="text-[9px] font-bold text-muted-foreground uppercase">Optimized</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl text-center">
                    <p className="text-[10px] font-bold text-emerald-500 uppercase mb-1">Carbon Savings</p>
                    <p className="text-xl font-black font-mono text-emerald-500 tracking-tight">1.4 tons / month</p>
                  </div>
                </div>
             </div>

             <div className="grid gap-6 lg:grid-cols-4">
                {[
                  { label: 'Compute Cost', value: '$12,402', change: '-4.2%', icon: BarChart3 },
                  { label: 'Network Cost', value: '$3,891', change: '+2.1%', icon: Network },
                  { label: 'Storage Cost', value: '$1,202', change: '0.0%', icon: Database },
                  { label: 'Total OpEx', value: '$17,495', change: '-1.8%', icon: TrendingUp },
                ].map((stat, i) => (
                  <div key={i} className="card-brief p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="p-2 bg-secondary/50 rounded-lg">
                        <stat.icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <span className={cn("text-[10px] font-black font-mono", stat.change.startsWith('-') ? "text-emerald-500" : "text-amber-500")}>
                        {stat.change}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{stat.label}</p>
                      <p className="text-xl font-black font-mono text-foreground">{stat.value}</p>
                    </div>
                  </div>
                ))}
             </div>
          </TabsContent>

          {/* Circuit Breakers Tab */}
          <TabsContent value="circuit-breakers" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-6">
                <div className="card-brief p-6 overflow-hidden">
                  <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 mb-6">
                    <ShieldAlert className="h-4 w-4 text-primary" />
                    Distributed Safety Protocols
                  </h3>
                  <div className="space-y-4">
                    {[
                      { name: 'Gateway.v2.Routing', status: 'closed', errorRate: 0.02, latency: 4, trips: 0, lastTrip: 'N/A' },
                      { name: 'Task.Lifecycle.Manager', status: 'closed', errorRate: 0.05, latency: 12, trips: 3, lastTrip: '2h ago' },
                      { name: 'ML.Inference.Scoring', status: 'half-open', errorRate: 12.4, latency: 450, trips: 14, lastTrip: '15m ago' },
                    ].map((cb) => (
                      <div key={cb.name} className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border border-border/50 bg-secondary/5 group hover:border-primary/30 transition-all gap-4">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "h-3 w-3 rounded-full shadow-[0_0_8px]",
                            cb.status === 'closed' ? "bg-emerald-500 shadow-emerald-500/50" : 
                            cb.status === 'open' ? "bg-destructive shadow-destructive/50" : "bg-amber-500 shadow-amber-500/50 animate-pulse"
                          )} />
                          <div>
                            <p className="text-sm font-bold text-foreground">{cb.name}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-8">
                          <Badge variant="outline" className={cn(
                            "font-black text-[9px] tracking-widest",
                            cb.status === 'closed' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                            cb.status === 'open' ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                          )}>
                            {cb.status.toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="card-brief p-6 bg-destructive/5 border-destructive/20">
                  <div className="flex items-center gap-2 mb-4 text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <h3 className="text-xs font-bold uppercase tracking-widest">Recent Incident</h3>
                  </div>
                  <Button variant="outline" size="sm" className="w-full text-[10px] font-bold uppercase tracking-widest border-destructive/20 hover:bg-destructive/10 text-destructive">
                    View Post-Mortem
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Distributed Tracing Tab */}
          <TabsContent value="traces" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="card-brief p-0 overflow-hidden min-h-[500px]">
              <div className="p-4 border-b border-border/50 flex items-center justify-between bg-secondary/10">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  Global Distributed Trace Log (OpenTelemetry)
                </h3>
              </div>
              
              <div className="p-0">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-secondary/30 border-b border-border/50">
                    <tr>
                      <th className="text-left p-4 text-muted-foreground font-bold">TRACE_ID</th>
                      <th className="text-left p-4 text-muted-foreground font-bold">OPERATION</th>
                      <th className="text-right p-4 text-muted-foreground font-bold">DURATION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { id: '8f2a...19e0', op: 'task.schedule.ml', duration: 45, status: 'ok', time: '2s ago' },
                      { id: '4c1d...a2b3', op: 'node.heartbeat.sync', duration: 12, status: 'ok', time: '14s ago' },
                    ].map((trace) => (
                      <tr key={trace.id} className="border-b border-border/10 hover:bg-white/5 transition-colors cursor-pointer group">
                        <td className="p-4 text-primary font-bold">{trace.id}</td>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-foreground font-bold">{trace.op}</span>
                            <span className="text-[9px] text-muted-foreground">{trace.time}</span>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <span className="font-bold">{trace.duration}ms</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
