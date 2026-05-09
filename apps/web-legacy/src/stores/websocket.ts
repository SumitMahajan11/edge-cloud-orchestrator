import { create } from 'zustand'
import { wsClient } from '../lib/websocketClient'
import { authStorage } from '../lib/auth-storage'
import { queryClient, queryKeys } from '../lib/query-client'

/**
 * Event types streamed over the /ws channel by the v4.0.0 backend.
 */
export type WsEventType =
  | 'task.created'
  | 'task.scheduled'
  | 'task.running'
  | 'task.completed'
  | 'task.failed'
  | 'node.registered'
  | 'node.heartbeat'
  | 'node.offline'
  | 'node.degraded'
  | 'scheduler.decision'
  | 'ml.fallback'
  | 'ml.drift_detected'
  | 'circuit_breaker.opened'
  | 'circuit_breaker.closed'
  | 'saga.started'
  | 'saga.compensating'
  | 'saga.completed'

export type ConnectionStatus = 'LIVE' | 'RECONNECTING' | 'DISCONNECTED'

export interface WsEvent<T = any> {
  /** Unique monotonic id assigned client-side */
  id: number
  /** Server event type or inferred type */
  type: WsEventType | string
  /** Source channel */
  channel?: string
  /** Arbitrary event payload */
  data: T
  /** Client-side receive timestamp (ms) */
  receivedAt: number
}

const MAX_EVENTS = 500
let nextId = 1

interface WsState {
  status: ConnectionStatus
  isConnected: boolean
  lastEventAt: number | null
  eventStream: WsEvent[]
  reconnectAttempts: number
  // Actions
  connect: () => Promise<void>
  disconnect: () => void
  /** Internal: append event */
  _appendEvent: (evt: Omit<WsEvent, 'id' | 'receivedAt'>) => void
  /** Clear the event ring buffer */
  clearEvents: () => void
}

export const useWsStore = create<WsState>((set) => ({
  status: 'DISCONNECTED',
  isConnected: false,
  lastEventAt: null,
  eventStream: [],
  reconnectAttempts: 0,

  connect: async () => {
    const token = authStorage.getToken()
    if (token) wsClient.setToken(token)
    set({ status: 'RECONNECTING' })
    try {
      await wsClient.connect()
    } catch (err) {
      console.warn('[wsStore] connect failed:', err)
      set({ status: 'DISCONNECTED', isConnected: false })
    }
  },

  disconnect: () => {
    wsClient.disconnect()
    set({ status: 'DISCONNECTED', isConnected: false })
  },

  _appendEvent: (evt) => {
    const event: WsEvent = {
      id: nextId++,
      receivedAt: Date.now(),
      ...evt,
    }
    
    // Batch event updates to prevent rendering thrash during high-frequency bursts
    pendingEvents.push(event)
    if (!batchTimer) {
      batchTimer = requestAnimationFrame(processBatch)
    }
    
    // Immediate invalidation is okay as React Query handles its own batching/deduping
    invalidateForEvent(event)
  },

  clearEvents: () => set({ eventStream: [] }),
}))

let pendingEvents: WsEvent[] = []
let batchTimer: number | null = null

function processBatch() {
  const events = [...pendingEvents]
  pendingEvents = []
  batchTimer = null
  
  if (events.length === 0) return
  
  const store = useWsStore.getState()
  const prev = store.eventStream
  const lastEvent = events[events.length - 1]
  
  const next = [...prev, ...events].slice(-MAX_EVENTS)
  
  useWsStore.setState({ 
    eventStream: next, 
    lastEventAt: lastEvent!.receivedAt 
  })
}

/**
 * Map each event type to the React Query keys that should refetch.
 */
function invalidateForEvent(evt: WsEvent) {
  const t = evt.type
  if (t.startsWith('task.')) {
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
    // If it's a state change, also invalidate stats
    if (t === 'task.completed' || t === 'task.failed' || t === 'task.scheduled') {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.stats() })
      queryClient.invalidateQueries({ queryKey: queryKeys.metrics.system() })
    }
  } else if (t.startsWith('node.')) {
    queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.metrics.system() })
  } else if (t.startsWith('scheduler.') || t.startsWith('ml.')) {
    queryClient.invalidateQueries({ queryKey: queryKeys.scheduler.metrics() })
    if (t === 'ml.drift_detected') {
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduler.status() })
    }
  } else if (t.startsWith('circuit_breaker.')) {
    queryClient.invalidateQueries({ queryKey: queryKeys.metrics.system() })
    // Specifically refresh circuit breaker states
    queryClient.invalidateQueries({ queryKey: ['circuit-breakers'] })
  } else if (t.startsWith('saga.')) {
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
  }
}

/**
 * One-time bootstrap that wires wsClient connection/event handlers to the
 * Zustand store. Idempotent — safe to call from <App /> mount.
 */
let wired = false
export function initWsStore() {
  if (wired) return
  wired = true

  wsClient.onConnect(() => {
    useWsStore.setState({
      status: 'LIVE',
      isConnected: true,
      reconnectAttempts: 0,
    })
  })

  wsClient.onDisconnect(() => {
    useWsStore.setState((s) => ({
      status: 'RECONNECTING',
      isConnected: false,
      reconnectAttempts: s.reconnectAttempts + 1,
    }))
  })

  wsClient.onError(() => {
    // Reflect as RECONNECTING unless explicitly disconnected
    useWsStore.setState((s) =>
      s.status === 'LIVE' ? { status: 'RECONNECTING' } : {}
    )
  })

  // Subscribe to canonical channels. Each incoming payload is normalized
  // into a typed WsEvent and appended to the stream.
  const channels: Array<{ channel: string; typePrefix: string }> = [
    { channel: 'tasks', typePrefix: 'task' },
    { channel: 'nodes', typePrefix: 'node' },
    { channel: 'scheduler', typePrefix: 'scheduler' },
    { channel: 'ml', typePrefix: 'ml' },
    { channel: 'circuit_breaker', typePrefix: 'circuit_breaker' },
    { channel: 'saga', typePrefix: 'saga' },
    { channel: 'events', typePrefix: '' },
  ]

  for (const { channel, typePrefix } of channels) {
    wsClient.subscribe(channel, (data: any) => {
      // Accept either {type,data} envelopes or raw payloads
      const inferredType: string =
        (data && typeof data === 'object' && typeof data.type === 'string'
          ? data.type
          : typePrefix
            ? `${typePrefix}.${data?.event ?? 'update'}`
            : 'unknown') || 'unknown'

      useWsStore.getState()._appendEvent({
        type: inferredType,
        channel,
        data,
      })
    })
  }
}

/**
 * React hook for components that just want the connection pill.
 */
export function useWsStatus() {
  return useWsStore((s) => ({
    status: s.status,
    isConnected: s.isConnected,
    lastEventAt: s.lastEventAt,
  }))
}

/**
 * React hook for the live event stream (last 500 events).
 * Optionally filter by type prefix (e.g. "scheduler.").
 */
export function useWsEventStream(typePrefix?: string) {
  return useWsStore((s) =>
    typePrefix
      ? s.eventStream.filter((e) => e.type.startsWith(typePrefix))
      : s.eventStream
  )
}
