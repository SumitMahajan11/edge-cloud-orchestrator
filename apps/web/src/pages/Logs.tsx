import { useState, useMemo } from 'react'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { StatusBadge } from '../components/shared/StatusBadge'
import { ScrollText, Search, Download, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import type { LogEntry, LogLevel } from '../types'

interface LogsProps {
  logs: LogEntry[]
  onClearLogs: () => void
}

const LOG_LEVELS: (LogLevel | 'all')[] = ['all', 'info', 'warn', 'error', 'debug']

export function Logs({ logs, onClearLogs }: LogsProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all')
  
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesLevel = levelFilter === 'all' || log.level === levelFilter
      const matchesSearch = searchQuery === '' || 
        log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.source.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesLevel && matchesSearch
    })
  }, [logs, levelFilter, searchQuery])
  
  const levelCounts = useMemo(() => {
    return {
      error: logs.filter(l => l.level === 'error').length,
      warn: logs.filter(l => l.level === 'warn').length,
      info: logs.filter(l => l.level === 'info').length,
      debug: logs.filter(l => l.level === 'debug').length,
    }
  }, [logs])
  
  const handleExport = () => {
    const logText = filteredLogs.map(log => 
      `[${log.timestamp.toISOString()}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}`
    ).join('\n')
    
    const blob = new Blob([logText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-${new Date().toISOString().slice(0, 10)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">System Logs</h2>
          <p className="text-muted-foreground">View and filter system events</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button variant="outline" onClick={onClearLogs} className="gap-2 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>
      
      {/* Level Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-destructive" />
            <span className="text-sm text-muted-foreground">Errors</span>
          </div>
          <p className="text-2xl font-bold font-mono text-destructive mt-1">{levelCounts.error}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-warning" />
            <span className="text-sm text-muted-foreground">Warnings</span>
          </div>
          <p className="text-2xl font-bold font-mono text-warning mt-1">{levelCounts.warn}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-info" />
            <span className="text-sm text-muted-foreground">Info</span>
          </div>
          <p className="text-2xl font-bold font-mono text-info mt-1">{levelCounts.info}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-muted-foreground" />
            <span className="text-sm text-muted-foreground">Debug</span>
          </div>
          <p className="text-2xl font-bold font-mono text-muted-foreground mt-1">{levelCounts.debug}</p>
        </div>
      </div>
      
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-secondary"
          />
        </div>
        <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as LogLevel | 'all')}>
          <SelectTrigger className="w-[180px] bg-secondary">
            <SelectValue placeholder="Filter by level" />
          </SelectTrigger>
          <SelectContent>
            {LOG_LEVELS.map((level) => (
              <SelectItem key={level} value={level} className="capitalize">
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {/* Log List */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
          {filteredLogs.length > 0 ? (
            <div className="divide-y divide-border">
              {filteredLogs.map((log) => (
                <div 
                  key={log.id} 
                  className="p-4 hover:bg-secondary/30 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <StatusBadge status={log.level} showDot={false} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">
                          {log.timestamp.toLocaleTimeString()}
                        </span>
                        <span className="text-xs text-muted-foreground">[{log.source}]</span>
                        {log.taskId && (
                          <code className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded">
                            Task: {log.taskId.slice(0, 8)}
                          </code>
                        )}
                        {log.nodeId && (
                          <code className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded">
                            Node: {log.nodeId.slice(0, 8)}
                          </code>
                        )}
                      </div>
                      <p className="text-sm text-foreground mt-1">{log.message}</p>
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <pre className="mt-2 text-xs text-muted-foreground bg-secondary/50 p-2 rounded overflow-x-auto">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <ScrollText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No logs found</h3>
              <p className="text-muted-foreground">
                {logs.length === 0 ? 'No logs available yet' : 'Try adjusting your filters'}
              </p>
            </div>
          )}
        </div>
      </div>
      
      {/* Footer */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Showing {filteredLogs.length} of {logs.length} logs</span>
        <span>Max retention: 500 entries</span>
      </div>
    </div>
  )
}
