import { useQuery } from '@tanstack/react-query'
import { getV2Logs, getV2LogsStats } from '@edgecloud/api-client'
import { STALE } from '../lib/query-client'
import { transformLogsFromApi } from '../lib/typeTransformers'

export function useLogs(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['logs', params],
    queryFn: async () => {
      const { data, error } = await getV2Logs({ query: params as any })
      if (error) throw error
      return transformLogsFromApi(data as any[])
    },
    staleTime: STALE.live,
  })
}

export function useLogStats() {
  return useQuery({
    queryKey: ['logs', 'stats'],
    queryFn: async () => {
      const { data, error } = await getV2LogsStats()
      if (error) throw error
      return data
    },
    staleTime: STALE.default,
  })
}
