import { useQuery } from '@tanstack/react-query'
import { 
  getV2MetricsSystem, 
  getV2CarbonSummary, 
  getV2CostSummary,
  getV2SchedulerMetrics,
  getV2MetricsMl,
  getV2MetricsNetwork,
  getV2SystemCircuitBreakers
} from '@edgecloud/api-client'
import { queryKeys, STALE } from '../lib/query-client'
import { transformMetricsFromApi } from '../lib/typeTransformers'

export function useSystemMetrics() {
  return useQuery({
    queryKey: queryKeys.metrics.system(),
    queryFn: async () => {
      const { data, error } = await getV2MetricsSystem()
      if (error) throw error
      return transformMetricsFromApi(data as any)
    },
    staleTime: STALE.nodeHealth,
  })
}

export function useSchedulerMetrics() {
  return useQuery({
    queryKey: queryKeys.scheduler.metrics(),
    queryFn: async () => {
      const { data, error } = await getV2SchedulerMetrics()
      if (error) throw error
      return data
    },
    staleTime: STALE.default,
  })
}

export function useCarbonMetrics() {
  return useQuery({
    queryKey: queryKeys.carbon.summary(),
    queryFn: async () => {
      const { data, error } = await getV2CarbonSummary()
      if (error) throw error
      return data
    },
    staleTime: STALE.long,
  })
}

export function useCostMetrics() {
  return useQuery({
    queryKey: queryKeys.cost.summary(),
    queryFn: async () => {
      const { data, error } = await getV2CostSummary()
      if (error) throw error
      return data
    },
    staleTime: STALE.long,
  })
}

export function useMLMetrics() {
  return useQuery({
    queryKey: ['metrics', 'ml'],
    queryFn: async () => {
      const { data, error } = await getV2MetricsMl()
      if (error) throw error
      return data
    },
    staleTime: STALE.default,
  })
}

export function useNetworkMetrics() {
  return useQuery({
    queryKey: ['metrics', 'network'],
    queryFn: async () => {
      const { data, error } = await getV2MetricsNetwork()
      if (error) throw error
      return data
    },
    staleTime: STALE.nodeHealth,
  })
}

export function useCircuitBreakers() {
  return useQuery({
    queryKey: ['circuit-breakers'],
    queryFn: async () => {
      const { data, error } = await getV2SystemCircuitBreakers()
      if (error) throw error
      return data as any[]
    },
    staleTime: STALE.nodeHealth,
  })
}
