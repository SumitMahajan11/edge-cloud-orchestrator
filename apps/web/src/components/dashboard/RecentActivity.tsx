import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  Server,
  Cpu,
  AlertCircle,
  ZapOff,
  Zap,
  ChevronRight,
  Clock
} from 'lucide-react'
import { useWsEventStream } from '../../stores/websocket'
import { cn } from '../../lib/utils'

export function RecentActivity() {
  const events = useWsEventStream()
  const recent = [...events].reverse().slice(0, 20)

  return (
    <div className="card-brief p-6 flex flex-col h-[400px]">
      <div className="flex items-center justify-between mb-4 border-b border-border/50 pb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold uppercase tracking-widest text-foreground">Activity Stream</h3>
        </div>
        <Link
          href="/logs"
          className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
        >
          Detailed Logs <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin">
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {recent.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground opacity-30">
                <Clock className="h-8 w-8 mb-2" />
                <p className="text-xs font-mono uppercase tracking-widest">Awaiting Uplink...</p>
              </div>
            )}
            {recent.map((e, idx) => {
              const meta = classify(e.type)
              const entityId: string | undefined =
                (e.data as any)?.taskId ??
                (e.data as any)?.nodeId ??
                (e.data as any)?.id
              const entityPath = entityLink(e.type, entityId)
              
              return (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  className="group flex items-center gap-4 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition-all border border-transparent hover:border-border/30"
                >
                  <div className={cn('p-2 rounded-lg shrink-0 transition-all group-hover:scale-110', meta.bg)}>
                    <meta.Icon className={cn('h-3.5 w-3.5', meta.color)} />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={cn('text-[10px] font-black tracking-widest uppercase', meta.color)}>
                        {e.type.split('.').pop()?.replace('_', ' ')}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
                        {relTime(e.receivedAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {entityId && entityPath ? (
                        <Link
                          href={entityPath}
                          className="text-[11px] font-mono text-foreground hover:text-primary transition-colors truncate max-w-[200px]"
                        >
                          {entityId.slice(0, 16)}{entityId.length > 16 ? '...' : ''}
                        </Link>
                      ) : (
                        <span className="text-[11px] font-mono text-muted-foreground truncate flex-1">
                          {summary(e.data)}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function classify(type: string) {
  if (type.startsWith('task.')) {
    return { Icon: Zap, color: 'text-indigo-400', bg: 'bg-indigo-500/10' }
  }
  if (type.startsWith('node.')) {
    if (type === 'node.offline') {
      return { Icon: ZapOff, color: 'text-destructive', bg: 'bg-destructive/10' }
    }
    return { Icon: Server, color: 'text-primary', bg: 'bg-primary/10' }
  }
  if (type.startsWith('ml.') || type.startsWith('scheduler.')) {
    return { Icon: Cpu, color: 'text-primary', bg: 'bg-primary/10' }
  }
  if (type.includes('failed') || type.startsWith('circuit_breaker.opened')) {
    return { Icon: AlertCircle, color: 'text-destructive', bg: 'bg-destructive/10' }
  }
  return { Icon: Activity, color: 'text-muted-foreground', bg: 'bg-secondary' }
}



function entityLink(type: string, id: string | undefined): string | null {
  if (!id) return null
  if (type.startsWith('task.')) return `/scheduler?task=${encodeURIComponent(id)}`
  if (type.startsWith('node.')) return `/nodes?node=${encodeURIComponent(id)}`
  return null
}

function summary(d: any): string {
  if (!d || typeof d !== 'object') return String(d ?? '')
  if (d.message) return String(d.message)
  if (d.status) return `STATUS: ${String(d.status).toUpperCase()}`
  try {
    const keys = Object.keys(d).filter(k => k !== 'id' && k !== 'timestamp')
    const firstKey = keys[0]
    if (firstKey) return `${firstKey.toUpperCase()}: ${String(d[firstKey]).slice(0, 40)}`
    return JSON.stringify(d).slice(0, 60)
  } catch {
    return 'DATA_STREAM_BINARY'
  }
}

function relTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h`
}
