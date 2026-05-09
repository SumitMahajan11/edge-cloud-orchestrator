import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../lib/api-client'
import { useWsStore } from '../stores/websocket'
import { toast } from 'sonner'

export interface CircuitBreakerState {
  name: string
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  failureRate: number
  lastStateChange: string
  successCount: number
  failureCount: number
  nextRetryAt?: string
}

export function useCircuitBreakers() {
  const queryClient = useQueryClient()
  const eventStream = useWsStore((s) => s.eventStream)

  const query = useQuery({
    queryKey: ['circuit-breakers'],
    queryFn: () => api.get<CircuitBreakerState[]>('/v2/circuit-breakers'),
    refetchInterval: 10000, // 10s polling as requested
  })

  // Subscribe to WebSocket events for immediate updates
  useEffect(() => {
    if (eventStream.length === 0) return
    
    const lastEvent = eventStream[eventStream.length - 1]
    if (lastEvent.type === 'circuit_breaker.opened' || 
        lastEvent.type === 'circuit_breaker.closed' || 
        lastEvent.type === 'circuit_breaker.half_open') {
      
      const payload = lastEvent.data as { name: string }
      const newState: CircuitBreakerState['state'] = 
        lastEvent.type === 'circuit_breaker.opened' ? 'OPEN' : 
        lastEvent.type === 'circuit_breaker.closed' ? 'CLOSED' : 'HALF_OPEN'

      // Optimistically update the cache
      queryClient.setQueryData<CircuitBreakerState[]>(['circuit-breakers'], (old) => {
        if (!old) return old
        return old.map((cb) => 
          cb.name === payload.name 
            ? { ...cb, state: newState, lastStateChange: new Date().toISOString() } 
            : cb
        )
      })

      // Toast notification for state changes
      if (newState === 'OPEN') {
        toast.error(`Circuit Breaker Tripped: ${payload.name}`, {
          description: 'Service is now in protective isolation.',
        })
      } else if (newState === 'CLOSED') {
        toast.success(`Circuit Breaker Recovered: ${payload.name}`, {
          description: 'Service connectivity restored.',
        })
      }
    }
  }, [eventStream, queryClient])

  const resetMutation = useMutation({
    mutationFn: (name: string) => 
      api.post<{ success: boolean; message: string }>(`/v2/circuit-breakers/${name}/reset`),
    onSuccess: (_, name) => {
      // Optimistically set to HALF_OPEN
      queryClient.setQueryData<CircuitBreakerState[]>(['circuit-breakers'], (old) => {
        if (!old) return old
        return old.map((cb) => 
          cb.name === name 
            ? { ...cb, state: 'HALF_OPEN', lastStateChange: new Date().toISOString() } 
            : cb
        )
      })
      toast.info(`Manual reset initiated for ${name}`)
    },
    onError: (error: any) => {
      toast.error('Reset failed', {
        description: error.message || 'An unexpected error occurred',
      })
    }
  })

  return {
    ...query,
    resetBreaker: resetMutation.mutate,
    isResetting: resetMutation.isPending
  }
}
