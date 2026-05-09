import { cn } from '../../lib/utils'

interface LiveIndicatorProps {
  active?: boolean
  label?: string
  className?: string
}

export function LiveIndicator({ active = true, label = 'LIVE', className }: LiveIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2 px-2 py-1 rounded-md bg-secondary/50 border border-border/50', className)}>
      <div className="relative flex h-2 w-2">
        {active && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
        )}
        <span className={cn('relative inline-flex rounded-full h-2 w-2', active ? 'bg-primary' : 'bg-muted-foreground')}></span>
      </div>
      <span className={cn('text-[10px] font-bold tracking-wider font-mono', active ? 'text-primary' : 'text-muted-foreground')}>
        {label}
      </span>
    </div>
  )
}
