import { useState } from 'react'
import { 
  Brain, 
  TrendingUp, 
  RefreshCw, 
  History, 
  Database, 
  Play,
  Settings2,
  Sparkles
} from 'lucide-react'
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Line
} from 'recharts'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Progress } from '../components/ui/progress'
import { motion } from 'framer-motion'
import { cn } from '../lib/utils'

const MODEL_VERSIONS = [
  { id: 'v4.2.1', status: 'ACTIVE', accuracy: 98.4, latency: 12, released: '2h ago', type: 'XGBoost' },
  { id: 'v4.2.0', status: 'ARCHIVED', accuracy: 97.9, latency: 14, released: '2d ago', type: 'XGBoost' },
  { id: 'v4.1.8', status: 'ARCHIVED', accuracy: 96.2, latency: 18, released: '1w ago', type: 'Random Forest' },
]

export function MLIntelligence() {
  const [isRetraining, setIsRetraining] = useState(false)

  const handleRetrain = () => {
    setIsRetraining(true)
    setTimeout(() => setIsRetraining(false), 3000)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-card p-6 rounded-xl border border-border gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-xl">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">ML Optimizer Core</h2>
            <p className="text-muted-foreground text-sm">Autonomous model registry and predictive scheduling telemetry</p>
          </div>
        </div>
        
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2 h-11 px-6">
            <Settings2 className="h-4 w-4" />
            Hyperparameters
          </Button>
          <Button onClick={handleRetrain} disabled={isRetraining} className="gap-2 h-11 px-6 font-bold shadow-lg shadow-primary/20">
            {isRetraining ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {isRetraining ? "Retraining..." : "Trigger Retrain"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Model Performance Deep Dive */}
        <div className="lg:col-span-2 card-brief p-6">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Inference Accuracy Trend (24h)
            </h3>
            <div className="flex items-center gap-4 font-mono text-[10px]">
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span>ACTIVE MODEL</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-muted" />
                <span>BASELINE</span>
              </div>
            </div>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={[
                { time: '00:00', acc: 94, base: 90 },
                { time: '04:00', acc: 95, base: 90 },
                { time: '08:00', acc: 93, base: 90 },
                { time: '12:00', acc: 98, base: 90 },
                { time: '16:00', acc: 97, base: 90 },
                { time: '20:00', acc: 98, base: 90 },
                { time: 'now', acc: 98.4, base: 90 },
              ]}>
                <defs>
                  <linearGradient id="mlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00d4aa" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#00d4aa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                <XAxis dataKey="time" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} domain={[85, 100]} />
                <Tooltip contentStyle={{ backgroundColor: '#0a0a0f', border: '1px solid #27272a' }} />
                <Area type="monotone" dataKey="acc" stroke="#00d4aa" strokeWidth={3} fill="url(#mlGrad)" />
                <Line type="monotone" dataKey="base" stroke="#3f3f46" strokeWidth={1} strokeDasharray="5 5" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Feature Importance */}
        <div className="card-brief p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 mb-8">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Feature Importance (SHAP)
          </h3>
          <div className="space-y-6">
            {[
              { label: 'NODE_LATENCY', weight: 88, color: 'bg-primary' },
              { label: 'CARBON_INTENSITY', weight: 74, color: 'bg-emerald-500' },
              { label: 'CPU_AVAILABILITY', weight: 65, color: 'bg-blue-500' },
              { label: 'TENANT_PRIORITY', weight: 42, color: 'bg-amber-500' },
              { label: 'HISTORIC_PERF', weight: 30, color: 'bg-purple-500' },
            ].map((feature) => (
              <div key={feature.label} className="space-y-2">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-muted-foreground">{feature.label}</span>
                  <span className="text-foreground font-bold">{feature.weight}%</span>
                </div>
                <div className="h-1.5 w-full bg-secondary/50 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${feature.weight}%` }}
                    className={cn("h-full rounded-full", feature.color)}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 pt-4 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Inference engine is currently prioritizing <span className="text-primary font-bold">network latency</span> as the primary optimization objective.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Model Registry */}
        <div className="lg:col-span-2 card-brief p-0 overflow-hidden">
           <div className="p-4 border-b border-border/50 bg-secondary/10 flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-primary" />
                Versioned Model Registry
              </h3>
           </div>
           <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="bg-secondary/30 border-b border-border/50">
                  <tr>
                    <th className="text-left p-4 text-muted-foreground font-bold">VERSION</th>
                    <th className="text-left p-4 text-muted-foreground font-bold">ACCURACY</th>
                    <th className="text-left p-4 text-muted-foreground font-bold">INF_LATENCY</th>
                    <th className="text-left p-4 text-muted-foreground font-bold">TIMESTAMP</th>
                    <th className="text-right p-4 text-muted-foreground font-bold">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_VERSIONS.map((v) => (
                    <tr key={v.id} className="border-b border-border/10 hover:bg-white/5 transition-colors group">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="p-1.5 bg-secondary rounded border border-border">
                            <Brain className="h-3 w-3 text-muted-foreground" />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-foreground">{v.id}</span>
                            <span className="text-[9px] text-muted-foreground uppercase">{v.type}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                         <span className={cn("font-bold", v.accuracy > 98 ? "text-primary" : "text-foreground")}>
                           {v.accuracy}%
                         </span>
                      </td>
                      <td className="p-4">
                        <span className="text-muted-foreground">{v.latency}ms</span>
                      </td>
                      <td className="p-4">
                         <span className="text-muted-foreground">{v.released}</span>
                      </td>
                      <td className="p-4 text-right">
                         <Badge 
                           variant="outline" 
                           className={cn(
                             "text-[9px] font-black tracking-widest",
                             v.status === 'ACTIVE' ? "bg-primary/10 text-primary border-primary/20" : "bg-secondary/50 text-muted-foreground border-border"
                           )}
                         >
                           {v.status}
                         </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
           </div>
        </div>

        {/* Prediction Stats */}
        <div className="card-brief p-6 flex flex-col justify-between">
           <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">Optimization Signal</h3>
           <div className="space-y-6">
              <div className="flex items-end justify-between">
                 <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Decisions / Min</p>
                    <p className="text-2xl font-black font-mono">1.8k</p>
                 </div>
                 <div className="h-10 w-24 bg-primary/10 rounded flex items-end gap-0.5 p-1">
                    {[3, 6, 4, 8, 5, 9, 7, 8].map((h, i) => (
                      <div key={i} className="flex-1 bg-primary/40 rounded-t-[1px]" style={{ height: `${h * 10}%` }} />
                    ))}
                 </div>
              </div>

              <div className="p-4 bg-secondary/30 border border-border rounded-xl space-y-3">
                 <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Cold Start Mit.</span>
                    <span className="text-[10px] font-black text-primary uppercase">Active</span>
                 </div>
                 <Progress value={92} className="h-1 bg-secondary" />
                 <p className="text-[9px] text-muted-foreground leading-relaxed">
                   Model is proactively pre-warming target nodes in the <span className="text-foreground font-bold">EU_WEST</span> cluster based on anticipated traffic bursts.
                 </p>
              </div>

              <Button variant="ghost" className="w-full text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary">
                 <History className="h-3 w-3 mr-2" />
                 View Training Logs
              </Button>
           </div>
        </div>
      </div>
    </div>
  )
}
