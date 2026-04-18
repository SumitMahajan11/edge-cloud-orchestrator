import { cn } from '../../lib/utils'
import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  title: string
  value: string | number | React.ReactNode
  subtitle?: string
  icon: LucideIcon
  glow?: 'primary' | 'accent' | 'destructive' | 'none'
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  className?: string
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  glow = 'none',
  trend,
  trendValue,
  className,
}: MetricCardProps) {
  const glowClasses = {
    primary: 'glow-primary',
    accent: 'glow-accent',
    destructive: 'glow-destructive',
    none: '',
  }
  
  const trendColors = {
    up: 'text-success',
    down: 'text-destructive',
    neutral: 'text-muted-foreground',
  }
  
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:border-primary/50',
        glow !== 'none' && glowClasses[glow],
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold font-mono text-foreground">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
          {trend && trendValue && (
            <p className={cn('text-xs font-medium', trendColors[trend])}>
              {trend === 'up' && '↑ '}
              {trend === 'down' && '↓ '}
              {trendValue}
            </p>
          )}
        </div>
        <div className="rounded-lg bg-secondary p-3">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </div>
  )
}
