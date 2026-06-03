import { useQuery, useMutation } from '@tanstack/react-query'
import { getV2Workflows, getV2WorkflowsById, postV2Workflows, postV2WorkflowsByIdExecute } from '@edgecloud/api-client'
import { queryKeys, STALE, queryClient } from '../lib/query-client'

export function useWorkflows() {
  return useQuery({
    queryKey: queryKeys.workflows.all,
    queryFn: async () => {
      const { data, error } = await getV2Workflows()
      if (error) throw error
      return data
    },
    staleTime: STALE.taskStatus,
  })
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: queryKeys.workflows.detail(id),
    queryFn: async () => {
      const { data, error } = await getV2WorkflowsById({ path: { id } })
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

export function useExecuteWorkflow() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postV2WorkflowsByIdExecute({ path: { id } })
      if (error) throw error
      return data
    },
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows.detail(id) })
    },
  })
}
