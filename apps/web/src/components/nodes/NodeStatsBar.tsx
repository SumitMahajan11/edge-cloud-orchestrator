import { useMemo } from 'react'
import type { EdgeNode } from '../../types'

interface NodeStatsBarProps {
  nodes: EdgeNode[]
}

/**
 * Edge Nodes top stats — fleet-level summary.
 */
export function NodeStatsBar({ nodes }: NodeStatsBarProps) {
  const stats = useMemo(() => {
    const online = nodes.filter((n) => n.status === 'online').length
    const degraded = nodes.filter((n) => n.status === 'degraded').length
    const offline = nodes.filter((n) => n.status === 'offline').length
    const count = nodes.length || 1
    const avgCpu = nodes.reduce((s, n) => s + n.cpu, 0) / count
    const avgMem = nodes.reduce((s, n) => s + n.memory, 0) / count
    const tasksRunning = nodes.reduce((s, n) => s + n.tasksRunning, 0)
    return {
      total: nodes.length,
      online,
      degraded,
      offline,
      avgCpu,
      avgMem,
      tasksRunning,
    }
  }, [nodes])

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
      <Stat label="Total Nodes" value={stats.total} tone="default" />
      <Stat label="Online" value={stats.online} tone="ok" />
      <Stat label="Degraded" value={stats.degraded} tone="warn" />
      <Stat label="Offline" value={stats.offline} tone="err" />
      <Stat label="Avg CPU" value={`${stats.avgCpu.toFixed(1)}%`} tone="default" />
      <Stat label="Avg Memory" value={`${stats.avgMem.toFixed(1)}%`} tone="default" />
      <Stat label="Tasks Running" value={stats.tasksRunning} tone="info" />
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone: 'default' | 'ok' | 'warn' | 'err' | 'info'
}) {
  const color =
    tone === 'ok'
      ? 'text-[#10b981]'
      : tone === 'warn'
        ? 'text-[#f59e0b]'
        : tone === 'err'
          ? 'text-[#ef4444]'
          : tone === 'info'
            ? 'text-[#6366f1]'
            : 'text-foreground'
  return (
    <div className="card-brief p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
    </div>
  )
}
