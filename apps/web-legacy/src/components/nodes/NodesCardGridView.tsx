import { AnimatePresence, motion } from 'framer-motion'
import { Leaf, Server } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { EdgeNode } from '../../types'

interface NodesCardGridViewProps {
  nodes: EdgeNode[]
  onSelect: (node: EdgeNode) => void
}

/**
 * Card grid view — one card per node showing mini CPU/Memory gauges,
 * latency sparkline, tasks badge, and carbon indicator.
 */
export function NodesCardGridView({ nodes, onSelect }: NodesCardGridViewProps) {
  if (nodes.length === 0) {
    return (
      <div className="card-brief p-16 text-center">
        <Server className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground font-mono">
          No nodes match the current filter.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <AnimatePresence mode="popLayout">
        {nodes.map((node) => (
          <motion.button
            key={node.id}
            type="button"
            onClick={() => onSelect(node)}
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="card-brief p-5 text-left transition-all hover:border-[#00d4aa]/50 hover:glow-teal"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <StatusDot status={node.status} />
                  {node.name}
                </h3>
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                  {node.region} · {node.id.slice(0, 8)}
                </p>
              </div>
              <CarbonLeaf nodeId={node.id} />
            </div>

            {/* Gauges */}
            <div className="grid grid-cols-2 gap-4">
              <CircularGauge
                label="CPU"
                value={node.cpu}
                color="#00d4aa"
              />
              <CircularGauge
                label="MEM"
                value={node.memory}
                color="#6366f1"
              />
            </div>

            {/* Latency sparkline */}
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">
                Latency
              </p>
              <LatencySparkline history={node.healthHistory} />
            </div>

            {/* Task badge */}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Tasks
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#00d4aa]/10 text-[#00d4aa] font-mono text-xs">
                {node.tasksRunning}/{node.maxTasks}
              </span>
            </div>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}

function StatusDot({ status }: { status: EdgeNode['status'] }) {
  const color =
    status === 'online'
      ? 'bg-[#00d4aa] animate-pulse-teal'
      : status === 'degraded'
        ? 'bg-[#f59e0b]'
        : 'bg-[#ef4444]'
  return <span className={cn('h-2.5 w-2.5 rounded-full', color)} />
}

function CircularGauge({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  const size = 72
  const stroke = 6
  const r = (size - stroke) / 2
  const circumference = r * 2 * Math.PI
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="#1e1e2e"
            strokeWidth={stroke}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-sm font-semibold" style={{ color }}>
            {Math.round(value)}%
          </span>
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mt-1">
        {label}
      </span>
    </div>
  )
}

function LatencySparkline({
  history,
}: {
  history: EdgeNode['healthHistory']
}) {
  const points = (history ?? []).slice(-20).map((h) => h.latency)
  if (points.length < 2) {
    return <div className="h-6 text-[10px] text-muted-foreground font-mono">—</div>
  }
  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1
  const w = 200
  const h = 24
  const step = w / (points.length - 1)
  const d = points
    .map((v, i) => {
      const x = (i * step).toFixed(1)
      const y = (h - ((v - min) / range) * h).toFixed(1)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-6 text-[#00d4aa]"
      preserveAspectRatio="none"
    >
      <path d={d} stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}

function CarbonLeaf({ nodeId }: { nodeId: string }) {
  // Derive a pseudo carbon intensity from the node id (deterministic).
  // Clean < 200 gCO2/kWh (green), medium 200-400 (amber), dirty > 400 (red).
  const hash =
    nodeId.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0) & 0xffff
  const intensity = 100 + (hash % 450)
  const color =
    intensity < 200
      ? 'text-[#22c55e]'
      : intensity < 400
        ? 'text-[#f59e0b]'
        : 'text-[#ef4444]'
  return (
    <span
      title={`~${intensity} gCO₂/kWh`}
      className={cn('inline-flex items-center', color)}
    >
      <Leaf className="h-3.5 w-3.5" />
    </span>
  )
}
