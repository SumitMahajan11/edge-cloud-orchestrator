import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, AlertCircle, X } from 'lucide-react'
import Link from 'next/link'
import { useWsEventStream } from '../../stores/websocket'
import { cn } from '../../lib/utils'

export interface SystemAlert {
  id: string
  severity: 'critical' | 'warning'
  title: string
  description?: string
  source?: string
  createdAt: number
}

/**
 * Dashboard Section F — Sticky alerts banner.
 * Derives alerts from WS event stream:
 *   - circuit_breaker.opened     → critical
 *   - ml.drift_detected          → warning
 *   - ml.fallback (rate high)    → warning (first occurrence)
 *   - node.offline               → warning (per node)
 */
export function SystemAlertsBanner() {
  const events = useWsEventStream()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // Derive alerts from recent events (last 100)
  const derived = useMemo<SystemAlert[]>(() => {
    const recent = events.slice(-100)
    const seen = new Map<string, SystemAlert>()

    for (const e of recent) {
      const d: any = e.data ?? {}
      const ts = e.receivedAt

      if (e.type === 'circuit_breaker.opened') {
        const key = `cb:${d.service ?? d.name ?? 'unknown'}`
        seen.set(key, {
          id: key,
          severity: 'critical',
          title: `Circuit breaker OPEN: ${d.service ?? d.name ?? 'service'}`,
          description: d.reason ?? 'Downstream failures exceeded threshold',
          source: d.service,
          createdAt: ts,
        })
      } else if (e.type === 'circuit_breaker.closed') {
        const key = `cb:${d.service ?? d.name ?? 'unknown'}`
        seen.delete(key)
      } else if (e.type === 'ml.drift_detected') {
        const key = `drift:${d.model ?? 'default'}`
        seen.set(key, {
          id: key,
          severity: 'warning',
          title: `ML model drift detected${d.model ? `: ${d.model}` : ''}`,
          description:
            d.reason ??
            `Drift score ${d.score ?? '?'} crossed threshold. Consider retraining.`,
          createdAt: ts,
        })
      } else if (e.type === 'ml.fallback') {
        const key = 'ml-fallback'
        const existing = seen.get(key)
        const count = (existing as any)?._count ? (existing as any)._count + 1 : 1
        if (count >= 3) {
          const alert: any = {
            id: key,
            severity: 'warning',
            title: 'ML fallback rate elevated',
            description: `${count} fallback decisions in last stream window`,
            createdAt: ts,
            _count: count,
          }
          seen.set(key, alert)
        } else if (existing) {
          ;(existing as any)._count = count
        } else {
          ;(seen as any).set(key, { _count: 1 })
        }
      } else if (e.type === 'node.offline') {
        const key = `node-offline:${d.nodeId ?? d.id ?? 'unknown'}`
        seen.set(key, {
          id: key,
          severity: 'warning',
          title: `Node offline: ${d.name ?? d.nodeId ?? 'unknown'}`,
          description: d.reason,
          createdAt: ts,
        })
      } else if (e.type === 'node.registered' || e.type === 'node.heartbeat') {
        // Clear offline alert once node returns
        const key = `node-offline:${d.nodeId ?? d.id ?? 'unknown'}`
        seen.delete(key)
      }
    }

    // Only return proper SystemAlert shapes (filter out internal _count-only entries)
    return [...seen.values()].filter((a): a is SystemAlert => !!a && 'title' in a)
  }, [events])

  // Prune dismissed-set to ids that no longer exist
  useEffect(() => {
    setDismissed((prev) => {
      const active = new Set(derived.map((a) => a.id))
      const next = new Set<string>()
      for (const id of prev) if (active.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [derived])

  const visible = derived.filter((a) => !dismissed.has(a.id))
  if (visible.length === 0) return null

  return (
    <div className="sticky top-16 z-20 -mx-6 mb-4 px-6">
      <div className="space-y-2">
        {visible.slice(0, 5).map((a) => (
          <AlertRow
            key={a.id}
            alert={a}
            onDismiss={() =>
              setDismissed((prev) => {
                const n = new Set(prev)
                n.add(a.id)
                return n
              })
            }
          />
        ))}
      </div>
    </div>
  )
}

function AlertRow({
  alert,
  onDismiss,
}: {
  alert: SystemAlert
  onDismiss: () => void
}) {
  const isCritical = alert.severity === 'critical'
  const Icon = isCritical ? AlertCircle : AlertTriangle

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 animate-pulse-teal',
        isCritical
          ? 'border-[#ef4444]/40 bg-[#ef4444]/5 text-[#ef4444]'
          : 'border-[#f59e0b]/40 bg-[#f59e0b]/5 text-[#f59e0b]'
      )}
      role="alert"
    >
      <Icon className="h-5 w-5 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{alert.title}</p>
        {alert.description && (
          <p className="text-xs opacity-80 mt-0.5">{alert.description}</p>
        )}
      </div>
      <Link
        href="/monitoring"
        className="text-xs underline-offset-2 hover:underline opacity-80 hover:opacity-100 shrink-0 mt-0.5"
      >
        View all
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        className="opacity-60 hover:opacity-100 shrink-0 mt-0.5"
        aria-label="Dismiss alert"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
