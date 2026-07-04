'use client'

export const dynamic = 'force-dynamic'

import { format } from 'date-fns'
import { AnimatePresence,motion } from 'framer-motion'
import { 
  Activity,
  ArrowDown, 
  Calendar,
  Download, 
  Filter, 
  Layers,
  Pause, 
  Play, 
  Search, 
  Settings2,
  Terminal,
  Trash2} from 'lucide-react'
import { useMemo,useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLogs } from '@/hooks/useLogs'

type LogLevel = 'all' | 'info' | 'warn' | 'error' | 'debug'

export default function LogsPage() {
  const { data: logs = [], isLoading } = useLogs()
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<LogLevel>('all')
  const [isPaused, setIsPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const filteredLogs = useMemo(() => {
    let result = logs
    
    if (level !== 'all') {
      result = result.filter((l) => l.level === level)
    }
    
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((l) => 
        l.message.toLowerCase().includes(q) || 
        l.source.toLowerCase().includes(q) ||
        l.nodeId?.toLowerCase().includes(q)
      )
    }
    
    return result
  }, [logs, level, search])

  const stats = useMemo(() => {
    const counts = { info: 0, warn: 0, error: 0, debug: 0 }
    logs.forEach((l) => {
      if (l.level in counts) {
        counts[l.level as keyof typeof counts]++
      }
    })
    return counts
  }, [logs])

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">System Logs</h1>
          <p className="text-muted-foreground">Real-time distributed log aggregation</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsPaused(!isPaused)}>
            {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
            {isPaused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button variant="outline" size="sm" className="text-rose-400 hover:text-rose-300">
            <Trash2 className="h-4 w-4 mr-2" /> Clear
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <LogStatCard label="Total" value={logs.length} icon={<Terminal className="h-4 w-4" />} />
        <LogStatCard label="Errors" value={stats.error} icon={<Activity className="h-4 w-4 text-rose-400" />} color="text-rose-400" />
        <LogStatCard label="Warnings" value={stats.warn} icon={<Activity className="h-4 w-4 text-amber-400" />} color="text-amber-400" />
        <LogStatCard label="Debug" value={stats.debug} icon={<Activity className="h-4 w-4 text-blue-400" />} color="text-blue-400" />
      </div>

      <Card className="bg-card/50 border-border flex-1 flex flex-col min-h-0">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by message, service, or node ID..."
                className="pl-8 bg-background/50"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={level} onValueChange={(val) => setLevel(val as LogLevel)}>
              <SelectTrigger className="w-32 bg-background/50">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden relative">
          <div className="absolute inset-0 overflow-y-auto font-mono text-[13px] scrollbar-thin scrollbar-thumb-border">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-card z-10 text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2 text-left font-medium border-b border-border">Timestamp</th>
                  <th className="px-4 py-2 text-left font-medium border-b border-border">Level</th>
                  <th className="px-4 py-2 text-left font-medium border-b border-border">Service</th>
                  <th className="px-4 py-2 text-left font-medium border-b border-border">Message</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {filteredLogs.map((log, i) => (
                    <motion.tr 
                      key={log.id || i}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="border-b border-border/30 hover:bg-white/5 group transition-colors"
                    >
                      <td className="px-4 py-1.5 whitespace-nowrap text-muted-foreground">
                        {format(new Date(log.timestamp), 'HH:mm:ss.SSS')}
                      </td>
                      <td className="px-4 py-1.5 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          log.level === 'error' ? 'bg-rose-500/10 text-rose-400' :
                          log.level === 'warn' ? 'bg-amber-500/10 text-amber-400' :
                          log.level === 'debug' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-emerald-500/10 text-emerald-400'
                        }`}>
                          {log.level}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 whitespace-nowrap text-teal-400/80">
                        {log.source}
                      </td>
                      <td className="px-4 py-1.5 break-all text-foreground/90 font-medium">
                        {log.message}
                        {log.metadata && (
                          <span className="ml-2 text-muted-foreground/60 text-xs font-normal">
                            {JSON.stringify(log.metadata)}
                          </span>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
                {filteredLogs.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={4} className="py-20 text-center text-muted-foreground italic">
                      No logs matching current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          {autoScroll && (
            <Button 
              size="sm" 
              variant="secondary" 
              className="absolute bottom-4 right-6 rounded-full shadow-lg opacity-80 hover:opacity-100"
              onClick={() => setAutoScroll(false)}
            >
              <ArrowDown className="h-4 w-4 mr-2" /> Auto-scroll ON
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function LogStatCard({ label, value, icon, color = 'text-foreground' }: { label: string, value: number, icon: React.ReactNode, color?: string }) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-tight">{label}</div>
          <div className={`text-xl font-bold mt-0.5 ${color}`}>{value.toLocaleString()}</div>
        </div>
        <div className="p-2 rounded-lg bg-background/50 border border-border/50">
          {icon}
        </div>
      </CardContent>
    </Card>
  )
}
