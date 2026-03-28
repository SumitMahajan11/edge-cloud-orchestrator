import { useState, useEffect, useRef, useCallback } from 'react'
import { agentPool } from '../lib/agent-pool'
import type { EdgeNode } from '../types'

interface NodeMetrics {
  cpu: number
  memory: number
  activeTasks: number
  timestamp: number
}

interface CachedMetrics {
  [nodeId: string]: NodeMetrics
}

const METRICS_CACHE_TTL = 2000 // 2 seconds
const BATCH_SIZE = 5 // Process nodes in batches to avoid overwhelming

export function useCachedMetrics(nodes: EdgeNode[]) {
  const [cachedMetrics, setCachedMetrics] = useState<CachedMetrics>({})
  const [isLoading, setIsLoading] = useState(false)
  const lastFetchRef = useRef<number>(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchMetrics = useCallback(async () => {
    // Throttle: Don't fetch if last fetch was within TTL
    const now = Date.now()
    if (now - lastFetchRef.current < METRICS_CACHE_TTL) {
      return
    }

    // Cancel previous fetch if still running
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    abortControllerRef.current = new AbortController()
    setIsLoading(true)

    try {
      // Process nodes in batches for better performance
      const onlineNodes = nodes.filter(n => n.status === 'online')
      const newMetrics: CachedMetrics = {}

      for (let i = 0; i < onlineNodes.length; i += BATCH_SIZE) {
        const batch = onlineNodes.slice(i, i + BATCH_SIZE)
        
        const batchResults = await Promise.allSettled(
          batch.map(async (node) => {
            try {
              const metrics = await agentPool.getMetrics(node.url)
              return {
                nodeId: node.id,
                metrics: metrics as NodeMetrics
              }
            } catch {
              // Return cached value or default
              return {
                nodeId: node.id,
                metrics: cachedMetrics[node.id] || {
                  cpu: 0,
                  memory: 0,
                  activeTasks: 0,
                  timestamp: Date.now()
                }
              }
            }
          })
        )

        batchResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            newMetrics[result.value.nodeId] = {
              ...result.value.metrics,
              timestamp: Date.now()
            }
          }
        })

        // Small delay between batches to prevent overwhelming
        if (i + BATCH_SIZE < onlineNodes.length) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }

      lastFetchRef.current = Date.now()
      setCachedMetrics(prev => ({ ...prev, ...newMetrics }))
    } catch (error) {
      console.error('Failed to fetch metrics:', error)
    } finally {
      setIsLoading(false)
    }
  }, [nodes, cachedMetrics])

  useEffect(() => {
    // Initial fetch
    fetchMetrics()

    // Set up interval for periodic updates
    const interval = setInterval(fetchMetrics, METRICS_CACHE_TTL)

    return () => {
      clearInterval(interval)
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [fetchMetrics])

  // Get metrics for a specific node (returns cached or default)
  const getNodeMetrics = useCallback((nodeId: string): NodeMetrics => {
    return cachedMetrics[nodeId] || {
      cpu: 0,
      memory: 0,
      activeTasks: 0,
      timestamp: 0
    }
  }, [cachedMetrics])

  // Check if metrics are stale (> 5 seconds old)
  const isMetricsStale = useCallback((nodeId: string): boolean => {
    const metrics = cachedMetrics[nodeId]
    if (!metrics) return true
    return Date.now() - metrics.timestamp > 5000
  }, [cachedMetrics])

  // Force refresh all metrics
  const refreshMetrics = useCallback(async () => {
    lastFetchRef.current = 0
    await fetchMetrics()
  }, [fetchMetrics])

  return {
    metrics: cachedMetrics,
    isLoading,
    getNodeMetrics,
    isMetricsStale,
    refreshMetrics
  }
}

// Hook for single node metrics
export function useNodeMetrics(node: EdgeNode | null) {
  const [metrics, setMetrics] = useState<NodeMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!node) return

    let isMounted = true
    const fetchMetrics = async () => {
      setIsLoading(true)
      try {
        const data = await agentPool.getMetrics(node.url)
        if (isMounted) {
          setMetrics({
            ...(data as NodeMetrics),
            timestamp: Date.now()
          })
        }
      } catch {
        if (isMounted) {
          setMetrics(null)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchMetrics()
    const interval = setInterval(fetchMetrics, METRICS_CACHE_TTL)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [node])

  return { metrics, isLoading }
}
