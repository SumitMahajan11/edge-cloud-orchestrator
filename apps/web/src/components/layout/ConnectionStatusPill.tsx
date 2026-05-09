import { useEffect, useMemo, useState } from 'react'
import { useWsStatus } from '../../stores/websocket'
import { cn } from '../../lib/utils'

/**
 * Topbar pill that reflects the live WebSocket connection status.
 *   LIVE          → green pulse    + "LIVE"
 *   RECONNECTING  → yellow spinner + "RECONNECTING"
 *   DISCONNECTED  → red dot        + "DISCONNECTED"
 *
 * Also shows a compact "xs ago" for the last received event while LIVE.
 */
export function ConnectionStatusPill() {
  const { status, lastEventAt } = useWsStatus()
  const [, tick] = useState(0)

  // Tick every 1s so the "xs ago" label stays fresh without re-rendering the store
  useEffect(() => {
    if (status !== 'LIVE' || !lastEventAt) return
    const id = setInterval(() => tick((n) => (n + 1) % 1_000_000), 1_000)
    return () => clearInterval(id)
  }, [status, lastEventAt])

  const label = useMemo(() => {
    if (status === 'LIVE') {
      if (!lastEventAt) return 'LIVE'
      const secs = Math.max(0, Math.floor((Date.now() - lastEventAt) / 1000))
      if (secs < 1) return 'LIVE · now'
      if (secs < 60) return `LIVE · ${secs}s ago`
      const mins = Math.floor(secs / 60)
      return `LIVE · ${mins}m ago`
    }
    if (status === 'RECONNECTING') return 'RECONNECTING'
    return 'DISCONNECTED'
  }, [status, lastEventAt])

  const dotClass = cn(
    'h-2 w-2 rounded-full',
    status === 'LIVE' && 'bg-[#00d4aa] animate-pulse-teal',
    status === 'RECONNECTING' && 'bg-[#f59e0b] animate-pulse',
    status === 'DISCONNECTED' && 'bg-[#ef4444]'
  )

  const pillClass = cn(
    'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-mono text-[11px] tracking-wide',
    status === 'LIVE' &&
      'border-[#00d4aa]/40 bg-[#00d4aa]/10 text-[#00d4aa]',
    status === 'RECONNECTING' &&
      'border-[#f59e0b]/40 bg-[#f59e0b]/10 text-[#f59e0b]',
    status === 'DISCONNECTED' &&
      'border-[#ef4444]/40 bg-[#ef4444]/10 text-[#ef4444]'
  )

  return (
    <span className={pillClass} aria-live="polite">
      <span className={dotClass} />
      <span>{label}</span>
    </span>
  )
}
