import { useQuery, useMutation } from '@tanstack/react-query'
import { getV2Tasks, getV2TasksById, postV2Tasks, postV2TasksByIdCancel, postV2TasksByIdRetry, getV2TasksStats } from '@edgecloud/api-client'
import { queryKeys, STALE, queryClient } from '../lib/query-client'
import { transformTasksFromApi, transformTaskFromApi } from '../lib/typeTransformers'
import type { TaskPriority, TaskType, RuntimeType } from '../types'

export function useTasks(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.tasks.list(params),
    queryFn: async () => {
      const { data, error } = await getV2Tasks({ query: params as any })
      if (error) throw error
      return transformTasksFromApi(data as any)
    },
    staleTime: STALE.taskStatus,
  })
}

export function useTask(id: string) {
  return useQuery({
    queryKey: queryKeys.tasks.detail(id),
    queryFn: async () => {
      const { data, error } = await getV2TasksById({ path: { id } })
      if (error) throw error
      return transformTaskFromApi(data as any)
    },
    enabled: !!id,
  })
}

export function useSubmitTask() {
  return useMutation({
    mutationFn: async (task: { 
      name: string; 
      type: TaskType; 
      priority: TaskPriority; 
      runtime: RuntimeType; 
      affinity?: string | undefined; 
      specs?: { cpuCores: number; memoryGB: number } | undefined; 
      policy?: string | undefined;
    }) => {
      const { data, error } = await postV2Tasks({ body: task as any })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.stats() })
    },
  })
}

export function useCancelTask() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postV2TasksByIdCancel({ path: { id } })
      if (error) throw error
      return data
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) })
    },
  })
}

export function useRetryTask() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postV2TasksByIdRetry({ path: { id } })
      if (error) throw error
      return data
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) })
    },
  })
}

export function useTaskStats() {
  return useQuery({
    queryKey: queryKeys.tasks.stats(),
    queryFn: async () => {
      const { data, error } = await getV2TasksStats()
      if (error) throw error
      return data
    },
    staleTime: STALE.taskStatus,
  })
}
