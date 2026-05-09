import { cn } from '../../lib/utils'

interface SkeletonCardProps {
  className?: string
  rows?: number
}

export function SkeletonCard({ className, rows = 3 }: SkeletonCardProps) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-6', className)}>
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-2">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-11 w-11 animate-pulse rounded-lg bg-muted" />
      </div>
      {rows > 0 && (
        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="h-3 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
      )}
    </div>
  )
}

export function SkeletonLine({ className }: { className?: string }) {
  return (
    <div className={cn('h-4 animate-pulse rounded bg-muted', className)} />
  )
}

export function SkeletonCircle({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-full bg-muted', className)} />
  )
}
