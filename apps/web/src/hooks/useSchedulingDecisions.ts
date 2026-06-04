import { client } from '@edgecloud/api-client'
import { useQuery } from '@tanstack/react-query'

import { queryKeys, STALE } from '../lib/query-client'

import type { SchedulingDecision } from '../types'

export function useSchedulingDecisions(params?: { nodeId?: string; limit?: number }) {
  return useQuery({
    queryKey: [...queryKeys.scheduler.metrics(), 'decisions', params],
    queryFn: async () => {
      const { data, error } = await client.get({
        url: '/v2/scheduler/decisions',
        query: params
      })
      if (error) {
        throw error
      }
      return data as SchedulingDecision[]
    },
    staleTime: STALE.default,
  })
}
