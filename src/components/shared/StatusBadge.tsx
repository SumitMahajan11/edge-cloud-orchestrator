import { cn } from '../../lib/utils'
import type { NodeStatus, TaskStatus, LogLevel } from '../../types'

type BadgeStatus = NodeStatus | TaskStatus | LogLevel | 'online' | 'offline' | 'edge' | 'cloud' | 'low' | 'medium' | 'high' | 'critical'

interface StatusBadgeProps {
  status: BadgeStatus
  showDot?: boolean
  className?: string
}

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  // Node statuses
  online: { bg: 'bg-success/20', text: 'text-success', dot: 'bg-success' },
  offline: { bg: 'bg-destructive/20', text: 'text-destructive', dot: 'bg-destructive' },
  degraded: { bg: 'bg-warning/20', text: 'text-warning', dot: 'bg-warning' },
  // Task statuses
  pending: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  scheduled: { bg: 'bg-info/20', text: 'text-info', dot: 'bg-info' },
  running: { bg: 'bg-primary/20', text: 'text-primary', dot: 'bg-primary' },
  completed: { bg: 'bg-success/20', text: 'text-success', dot: 'bg-success' },
  failed: { bg: 'bg-destructive/20', text: 'text-destructive', dot: 'bg-destructive' },
  // Log levels
  info: { bg: 'bg-info/20', text: 'text-info', dot: 'bg-info' },
  warn: { bg: 'bg-warning/20', text: 'text-warning', dot: 'bg-warning' },
  error: { bg: 'bg-destructive/20', text: 'text-destructive', dot: 'bg-destructive' },
  debug: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  // Targets
  edge: { bg: 'bg-primary/20', text: 'text-primary', dot: 'bg-primary' },
  cloud: { bg: 'bg-info/20', text: 'text-info', dot: 'bg-info' },
  // Priorities
  low: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  medium: { bg: 'bg-info/20', text: 'text-info', dot: 'bg-info' },
  high: { bg: 'bg-warning/20', text: 'text-warning', dot: 'bg-warning' },
  critical: { bg: 'bg-destructive/20', text: 'text-destructive', dot: 'bg-destructive' },
}

export function StatusBadge({ status, showDot = true, className }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.info
  
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono',
        config.bg,
        config.text,
        className
      )}
    >
      {showDot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            config.dot,
            status === 'running' && 'animate-pulse'
          )}
        />
      )}
      <span className="capitalize">{status}</span>
    </span>
  )
}
