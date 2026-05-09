import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Server, MapPin, Activity, HardDrive, Wifi, Clock } from 'lucide-react'
import { StatusBadge } from '../shared/StatusBadge'
import { 
  // AreaChart,
  // Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts'
import type { EdgeNode } from '../../types'
import { formatDuration } from '../../lib/utils'

interface NodeDetailModalProps {
  node: EdgeNode | null
  isOpen: boolean
  onClose: () => void
}

export function NodeDetailModal({ node, isOpen, onClose }: NodeDetailModalProps) {
  const healthData = useMemo(() => {
    if (!node) return []
    return node.healthHistory.map((h, i) => ({
      index: i,
      cpu: h.cpu,
      memory: h.memory,
      latency: h.latency,
    }))
  }, [node])
  
  if (!node) return null
  
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl z-50"
          >
            <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-border">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
                    <Server className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">{node.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={node.status} />
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {node.location} ({node.region})
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-secondary transition-colors"
                >
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
              
              {/* Content */}
              <div className="p-6 space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg bg-secondary/50 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Activity className="h-4 w-4" />
                      <span className="text-xs">CPU</span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-foreground">{node.cpu.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <HardDrive className="h-4 w-4" />
                      <span className="text-xs">Memory</span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-foreground">{node.memory.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Wifi className="h-4 w-4" />
                      <span className="text-xs">Latency</span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-foreground">{Math.round(node.latency)}ms</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Clock className="h-4 w-4" />
                      <span className="text-xs">Uptime</span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-foreground">{node.uptime.toFixed(1)}%</p>
                  </div>
                </div>
                
                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">IP Address</span>
                    <span className="font-mono text-foreground">{node.ip}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">Cost/Hour</span>
                    <span className="font-mono text-foreground">${node.costPerHour.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">Tasks Running</span>
                    <span className="font-mono text-foreground">{node.tasksRunning} / {node.maxTasks}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">Storage</span>
                    <span className="font-mono text-foreground">{node.storage.toFixed(0)} GB</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">Bandwidth In</span>
                    <span className="font-mono text-foreground">{node.bandwidthIn.toFixed(1)} Mbps</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">Bandwidth Out</span>
                    <span className="font-mono text-foreground">{node.bandwidthOut.toFixed(1)} Mbps</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">Last Heartbeat</span>
                    <span className="font-mono text-foreground">
                      {formatDuration(Date.now() - node.lastHeartbeat.getTime())} ago
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">Maintenance Mode</span>
                    <span className="font-mono text-foreground">{node.isMaintenanceMode ? 'Yes' : 'No'}</span>
                  </div>
                </div>
                
                {/* Health History Chart */}
                {healthData.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">Health History</h3>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={healthData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="index" hide />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'hsl(var(--card))', 
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '8px'
                            }}
                          />
                          <Line type="monotone" dataKey="cpu" name="CPU %" stroke="hsl(175, 80%, 50%)" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="memory" name="Memory %" stroke="hsl(210, 80%, 55%)" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="latency" name="Latency" stroke="hsl(38, 92%, 50%)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
