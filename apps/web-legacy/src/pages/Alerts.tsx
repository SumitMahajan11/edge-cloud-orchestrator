import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Bell, 
  AlertTriangle, 
  Info, 
  ShieldAlert, 
  CheckCircle2, 
  Search,
  Clock,
  ExternalLink,
  ChevronRight
} from 'lucide-react'
import { useAlerts, type SystemAlert } from '../hooks/useAlerts'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { cn } from '../lib/utils'
import { DrawerPanel } from '../components/shared/DrawerPanel'
import { JsonViewer } from '../components/shared/JsonViewer'

export function Alerts() {
  const { data: alerts = [] } = useAlerts()
  const [filter, setFilter] = useState<'all' | 'unacknowledged'>('unacknowledged')
  const [search, setSearch] = useState('')
  const [selectedAlert, setSelectedAlert] = useState<SystemAlert | null>(null)

  const filteredAlerts = useMemo(() => {
    return alerts.filter(a => {
      const matchesFilter = filter === 'all' || !a.acknowledged
      const matchesSearch = search === '' || 
        a.title.toLowerCase().includes(search.toLowerCase()) ||
        a.message.toLowerCase().includes(search.toLowerCase()) ||
        a.source.toLowerCase().includes(search.toLowerCase())
      return matchesFilter && matchesSearch
    })
  }, [alerts, filter, search])

  const severityStats = useMemo(() => {
    return {
      critical: alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length,
      warning: alerts.filter(a => a.severity === 'warning' && !a.acknowledged).length,
      info: alerts.filter(a => a.severity === 'info' && !a.acknowledged).length,
    }
  }, [alerts])

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="grid gap-6 md:grid-cols-4">
        <div className="md:col-span-1 bg-card p-6 rounded-xl border border-border flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Bell className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-xl font-bold">Alerts Feed</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Real-time infrastructure anomalies and system events requiring attention.
          </p>
        </div>

        {[
          { label: 'Critical', count: severityStats.critical, color: 'text-destructive', bg: 'bg-destructive/10', icon: ShieldAlert },
          { label: 'Warning', count: severityStats.warning, color: 'text-amber-500', bg: 'bg-amber-500/10', icon: AlertTriangle },
          { label: 'Info', count: severityStats.info, color: 'text-blue-500', bg: 'bg-blue-500/10', icon: Info },
        ].map((stat) => (
          <div key={stat.label} className={cn("bg-card p-6 rounded-xl border border-border flex items-center justify-between", stat.count > 0 && "ring-1 ring-inset " + stat.color.replace('text', 'ring'))}>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{stat.label}</p>
              <p className={cn("text-3xl font-black font-mono", stat.color)}>{stat.count}</p>
            </div>
            <div className={cn("p-3 rounded-xl", stat.bg)}>
              <stat.icon className={cn("h-6 w-6", stat.color)} />
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="bg-card p-4 rounded-xl border border-border flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="flex bg-secondary/50 p-1 rounded-lg border border-border/50">
            <button
              onClick={() => setFilter('unacknowledged')}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-md transition-all",
                filter === 'unacknowledged' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Pending
            </button>
            <button
              onClick={() => setFilter('all')}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-md transition-all",
                filter === 'all' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              All History
            </button>
          </div>
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by title, message, or source..."
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              className="pl-10 bg-secondary/30 border-border/50 h-10"
            />
          </div>
        </div>
        
        <Button variant="outline" className="gap-2 h-10">
          <CheckCircle2 className="h-4 w-4" />
          Acknowledge All
        </Button>
      </div>

      {/* Alert List */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {filteredAlerts.length > 0 ? (
            filteredAlerts.map((alert) => (
              <motion.div
                key={alert.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(
                  "group relative bg-card border border-border rounded-xl p-4 flex items-start gap-4 transition-all hover:border-primary/30 cursor-pointer",
                  !alert.acknowledged && "border-l-4",
                  !alert.acknowledged && alert.severity === 'critical' && "border-l-destructive",
                  !alert.acknowledged && alert.severity === 'warning' && "border-l-amber-500",
                  !alert.acknowledged && alert.severity === 'info' && "border-l-blue-500",
                  alert.acknowledged && "opacity-60"
                )}
                onClick={() => setSelectedAlert(alert)}
              >
                <div className={cn(
                  "mt-1 p-2 rounded-lg shrink-0",
                  alert.severity === 'critical' ? "bg-destructive/10 text-destructive" :
                  alert.severity === 'warning' ? "bg-amber-500/10 text-amber-500" : "bg-blue-500/10 text-blue-500"
                )}>
                  {alert.severity === 'critical' ? <ShieldAlert className="h-5 w-5" /> : 
                   alert.severity === 'warning' ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-foreground truncate">{alert.title}</h3>
                    <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-widest px-1.5 h-4">
                      {alert.source}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-1">{alert.message}</p>
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground font-mono">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(alert.timestamp).toLocaleString()}
                    </div>
                    {alert.metadata?.region && (
                      <div className="flex items-center gap-1">
                        <span>REGION:</span>
                        <span className="text-foreground font-bold">{alert.metadata.region}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                   <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                     <CheckCircle2 className="h-4 w-4" />
                   </Button>
                   <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </motion.div>
            ))
          ) : (
            <div className="py-20 flex flex-col items-center justify-center text-muted-foreground opacity-30">
              <CheckCircle2 className="h-12 w-12 mb-4" />
              <p className="text-lg font-bold">All Systems Nominal</p>
              <p className="text-sm">No active alerts matching your criteria</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Alert Detail Drawer */}
      <DrawerPanel
        isOpen={!!selectedAlert}
        onClose={() => setSelectedAlert(null)}
        title="Alert Intelligence"
        description="Detailed anomaly data and resolution context"
        width="md"
      >
        {selectedAlert && (
          <div className="space-y-8">
             <div className={cn(
               "p-6 rounded-2xl border flex items-start gap-4",
               selectedAlert.severity === 'critical' ? "bg-destructive/5 border-destructive/20" :
               selectedAlert.severity === 'warning' ? "bg-amber-500/5 border-amber-500/20" : "bg-blue-500/5 border-blue-500/20"
             )}>
                <div className={cn(
                  "p-3 rounded-xl",
                  selectedAlert.severity === 'critical' ? "bg-destructive/10 text-destructive" :
                  selectedAlert.severity === 'warning' ? "bg-amber-500/10 text-amber-500" : "bg-blue-500/10 text-blue-500"
                )}>
                  {selectedAlert.severity === 'critical' ? <ShieldAlert className="h-6 w-6" /> : 
                   selectedAlert.severity === 'warning' ? <AlertTriangle className="h-6 w-6" /> : <Info className="h-6 w-6" />}
                </div>
                <div className="space-y-1">
                   <h3 className="text-lg font-bold text-foreground leading-tight">{selectedAlert.title}</h3>
                   <p className="text-sm text-muted-foreground leading-relaxed">{selectedAlert.message}</p>
                </div>
             </div>

             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Source Subsystem</p>
                  <p className="text-sm font-mono font-bold text-foreground flex items-center gap-2">
                    {selectedAlert.source}
                    <ExternalLink className="h-3 w-3 opacity-50" />
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">First Observed</p>
                  <p className="text-sm font-mono font-bold text-foreground">
                    {new Date(selectedAlert.timestamp).toLocaleString()}
                  </p>
                </div>
             </div>

             {selectedAlert.metadata && (
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Telemetry Payload</p>
                  <div className="rounded-xl border border-border bg-[#050508] overflow-hidden">
                    <JsonViewer data={selectedAlert.metadata} />
                  </div>
                </div>
             )}

             <div className="space-y-3">
               <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Resolution Protocol</p>
               <div className="bg-secondary/20 p-4 rounded-xl border border-border/50 text-xs text-muted-foreground leading-relaxed space-y-2">
                  <p>1. Verify regional health via Monitoring dashboard.</p>
                  <p>2. Check for recent policy deployments or model updates.</p>
                  <p>3. If persistent, consider failing over to secondary cloud region.</p>
               </div>
             </div>

             <div className="flex gap-4 pt-4">
                <Button className="flex-1 h-11 font-bold">
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Acknowledge
                </Button>
                <Button variant="outline" className="flex-1 h-11 font-bold">
                  Create Incident
                </Button>
             </div>
          </div>
        )}
      </DrawerPanel>
    </div>
  )
}
