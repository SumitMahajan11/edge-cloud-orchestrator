import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Input 
} from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { 
  ScrollText, 
  Search, 
  Download, 
  Loader2, 
  Play, 
  Pause, 
  Eye, 
  Terminal,
  Filter,
  ArrowDown,
  Server
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { DrawerPanel } from '../components/shared/DrawerPanel'
import { JsonViewer } from '../components/shared/JsonViewer'
import { useLogs, useLogStats } from '../hooks/useLogs'
import type { LogLevel, LogEntry } from '../types'
import { toast } from 'sonner'
import { cn } from '../lib/utils'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'

const LOG_LEVELS: (LogLevel | 'all')[] = ['all', 'info', 'warn', 'error', 'debug']

export function Logs() {
  const [searchQuery, setSearchQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all')
  const [category, setCategory] = useState('all')
  const [isLive, setIsLive] = useState(true)
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)
  
  const scrollRef = useRef<HTMLDivElement>(null)
  
  const { data: logs = [], isLoading } = useLogs(levelFilter !== 'all' ? { level: levelFilter } : undefined)
  const { data: stats } = useLogStats()
  
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = searchQuery === '' || 
        log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.source.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.taskId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.nodeId?.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesCategory = category === 'all' || 
        (category === 'errors' && log.level === 'error') ||
        (category === 'system' && log.source.includes('system')) ||
        (category === 'scheduler' && log.source.includes('scheduler'))

      return matchesSearch && matchesCategory
    })
  }, [logs, searchQuery, levelFilter, category])

  // Auto-scroll logic
  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, isLive])
  
  const handleExport = () => {
    const logText = filteredLogs.map(log => 
      `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}`
    ).join('\n')
    
    const blob = new Blob([logText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `edge-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Logs exported successfully')
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-4">
      {/* Header Actions */}
      <div className="flex items-center justify-between bg-card p-4 rounded-xl border border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Terminal className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Terminal Output</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Live system event stream</span>
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsLive(!isLive)}
            className={cn("gap-2", isLive ? "text-primary hover:text-primary/80" : "text-muted-foreground")}
          >
            {isLive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isLive ? "Live Tail On" : "Resume Tail"}
          </Button>
          <Separator orientation="vertical" className="h-4 mx-2" />
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Main Console */}
      <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-border bg-[#050508] overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-border bg-card/30 flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <Tabs value={category} onValueChange={setCategory} className="w-auto">
              <TabsList className="bg-secondary/50 border border-border/50">
                <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                <TabsTrigger value="errors" className="text-xs text-destructive data-[state=active]:bg-destructive/10">Errors</TabsTrigger>
                <TabsTrigger value="scheduler" className="text-xs">Scheduler</TabsTrigger>
                <TabsTrigger value="system" className="text-xs">System</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter by message, task, or node ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 bg-secondary/50 border-border/50 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as LogLevel | 'all')}>
              <SelectTrigger className="w-[120px] h-9 bg-secondary/50 border-border/50 text-xs">
                <Filter className="h-3 w-3 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                {LOG_LEVELS.map((level) => (
                  <SelectItem key={level} value={level} className="capitalize text-xs">
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <div className="flex gap-1">
              <LogStat count={stats?.errors ?? 0} color="text-destructive" label="E" />
              <LogStat count={stats?.warnings ?? 0} color="text-yellow-500" label="W" />
              <LogStat count={stats?.info ?? 0} color="text-primary" label="I" />
            </div>
          </div>
        </div>

        {/* Log Area */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-0 font-mono text-[11px] leading-relaxed relative scrollbar-thin"
        >
          {isLoading && logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mb-4" />
              <p>Initializing secure log stream...</p>
            </div>
          ) : filteredLogs.length > 0 ? (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#050508] z-10 border-b border-border shadow-sm">
                <tr className="text-[10px] uppercase text-muted-foreground">
                  <th className="w-24 px-4 py-2 text-left font-bold">Timestamp</th>
                  <th className="w-20 px-4 py-2 text-left font-bold">Level</th>
                  <th className="w-32 px-4 py-2 text-left font-bold">Source</th>
                  <th className="px-4 py-2 text-left font-bold">Message</th>
                  <th className="w-10 px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {filteredLogs.map((log) => (
                    <motion.tr 
                      key={log.id}
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={cn(
                        "group border-b border-border/10 hover:bg-white/5 transition-colors cursor-pointer",
                        log.level === 'error' && "bg-destructive/5",
                        log.level === 'warn' && "bg-yellow-500/5"
                      )}
                      onClick={() => setSelectedLog(log)}
                    >
                      <td className="px-4 py-1.5 text-muted-foreground whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        <span className="text-[8px] opacity-30 ml-1">.{(new Date(log.timestamp).getMilliseconds()).toString().padStart(3, '0')}</span>
                      </td>
                      <td className="px-4 py-1.5">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border",
                          log.level === 'error' ? "text-destructive border-destructive/30" : 
                          log.level === 'warn' ? "text-yellow-500 border-yellow-500/30" : 
                          log.level === 'debug' ? "text-muted-foreground border-border" :
                          "text-primary border-primary/30"
                        )}>
                          {log.level}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                        {log.source.split('.').pop() || log.source}
                      </td>
                      <td className="px-4 py-1.5 text-foreground leading-tight">
                        <div className="flex flex-wrap gap-2 items-center">
                          <span>{log.message}</span>
                          {(log.taskId || log.nodeId) && (
                            <div className="flex gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                              {log.taskId && <TraceBadge type="task" id={log.taskId} />}
                              {log.nodeId && <TraceBadge type="node" id={log.nodeId} />}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-1.5 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                        <Eye className="h-3 w-3 text-muted-foreground hover:text-primary" />
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-30">
              <ScrollText className="h-12 w-12 mb-4" />
              <p>No log entries match your criteria</p>
            </div>
          )}
          
          {isLive && filteredLogs.length > 0 && (
            <div className="sticky bottom-4 right-4 flex justify-end p-4 pointer-events-none">
              <div className="bg-primary/10 backdrop-blur-md border border-primary/30 px-3 py-1 rounded-full flex items-center gap-2 shadow-lg shadow-primary/20 animate-bounce">
                <ArrowDown className="h-3 w-3 text-primary" />
                <span className="text-[10px] font-bold text-primary tracking-widest uppercase">Live Tail</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Log Detail Drawer */}
      <DrawerPanel
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title="Event Metadata"
        description="Detailed trace information and raw log object"
        width="md"
      >
        {selectedLog && (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Message</label>
              <div className={cn(
                "p-4 rounded-lg border bg-secondary/30 text-sm font-medium",
                selectedLog.level === 'error' ? "border-destructive/20 text-destructive" : 
                selectedLog.level === 'warn' ? "border-yellow-500/20 text-yellow-500" : "border-border"
              )}>
                {selectedLog.message}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <MetadataItem label="Timestamp" value={new Date(selectedLog.timestamp).toLocaleString()} />
              <MetadataItem label="Level" value={<span className="uppercase font-bold">{selectedLog.level}</span>} />
              <MetadataItem label="Source" value={selectedLog.source} />
              <MetadataItem label="Process ID" value="orchestrator-v2-main" />
            </div>

            {(selectedLog.taskId || selectedLog.nodeId) && (
              <div className="space-y-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Contextual Links</label>
                <div className="space-y-2">
                  {selectedLog.taskId && (
                    <div className="flex items-center justify-between p-3 rounded border border-border bg-secondary/20 hover:border-primary/50 cursor-pointer transition-all">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-primary/10 rounded">
                          <ScrollText className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <span className="text-xs font-mono">Task: {selectedLog.taskId.slice(0, 12)}...</span>
                      </div>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                  {selectedLog.nodeId && (
                    <div className="flex items-center justify-between p-3 rounded border border-border bg-secondary/20 hover:border-primary/50 cursor-pointer transition-all">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-blue-500/10 rounded">
                          <Server className="h-3.5 w-3.5 text-blue-500" />
                        </div>
                        <span className="text-xs font-mono">Node: {selectedLog.nodeId.slice(0, 12)}...</span>
                      </div>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Full Payload</label>
              <div className="rounded-xl border border-border bg-[#050508] overflow-hidden">
                <JsonViewer data={selectedLog.metadata || {}} />
              </div>
            </div>
          </div>
        )}
      </DrawerPanel>
    </div>
  )
}

function LogStat({ count, color, label }: { count: number, color: string, label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-secondary/30 border border-border/50">
      <span className={cn("text-[10px] font-bold", color)}>{label}</span>
      <span className="text-xs font-mono font-bold text-foreground">{count}</span>
    </div>
  )
}

function MetadataItem({ label, value }: { label: string, value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className="text-sm font-mono text-foreground">{value}</p>
    </div>
  )
}

function TraceBadge({ type, id }: { type: 'task' | 'node', id: string }) {
  return (
    <div className={cn(
      "px-1 py-0 rounded text-[8px] font-bold tracking-tighter border",
      type === 'task' ? "bg-primary/5 border-primary/20 text-primary" : "bg-blue-500/5 border-blue-500/20 text-blue-500"
    )}>
      {type === 'task' ? 'TSK:' : 'NOD:'}{id.slice(0, 6)}
    </div>
  )
}

function Separator({ orientation = 'horizontal', className }: { orientation?: 'horizontal' | 'vertical', className?: string }) {
  return (
    <div className={cn(
      "bg-border",
      orientation === 'horizontal' ? "h-[1px] w-full" : "w-[1px] h-full",
      className
    )} />
  )
}

function ArrowUpRight(props: any) {
  return (
    <svg 
      {...props}
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path d="M7 7h10v10"/><path d="M7 17 17 7"/>
    </svg>
  )
}
