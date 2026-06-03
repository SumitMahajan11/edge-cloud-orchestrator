import { useQuery, useMutation } from '@tanstack/react-query'
import { 
  getV2Webhooks, 
  getV2WebhooksByIdDeliveries, 
  postV2Webhooks, 
  patchV2WebhooksById, 
  deleteV2WebhooksById,
  postV2WebhooksByIdTest,
  postV2WebhooksDeliveriesByIdRetry,
  getV2WebhooksStats
} from '@edgecloud/api-client'
import { queryKeys, STALE, queryClient } from '../lib/query-client'

export function useWebhooks() {
  return useQuery<any[]>({
    queryKey: queryKeys.webhooks.all,
    queryFn: async () => {
      const { data, error } = await getV2Webhooks()
      if (error) throw error
      return data as any[]
    },
    staleTime: STALE.default,
  })
}

export function useWebhookStats() {
  return useQuery({
    queryKey: ['webhooks', 'stats'],
    queryFn: async () => {
      const { data, error } = await getV2WebhooksStats()
      if (error) throw error
      return data
    },
    staleTime: STALE.default,
  })
}

export function useWebhookDeliveries(id: string) {
  return useQuery<any[]>({
    queryKey: queryKeys.webhooks.deliveries(id),
    queryFn: async () => {
      const { data, error } = await getV2WebhooksByIdDeliveries({ path: { id } })
      if (error) throw error
      return data as any[]
    },
    enabled: !!id,
    staleTime: STALE.live,
  })
}

export function useCreateWebhook() {
  return useMutation({
    mutationFn: async (webhookData: any) => {
      const { data, error } = await postV2Webhooks({ body: webhookData as any })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all })
      queryClient.invalidateQueries({ queryKey: ['webhooks', 'stats'] })
    },
  })
}

export function useUpdateWebhook() {
  return useMutation({
    mutationFn: async ({ id, config }: { id: string; config: any }) => {
      const { data, error } = await patchV2WebhooksById({ path: { id }, body: config })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all })
    },
  })
}

export function useDeleteWebhook() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await deleteV2WebhooksById({ path: { id } })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all })
      queryClient.invalidateQueries({ queryKey: ['webhooks', 'stats'] })
    },
  })
}

export function useToggleWebhook() {
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { data, error } = await patchV2WebhooksById({ path: { id }, body: { enabled } as any })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all })
    },
  })
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postV2WebhooksByIdTest({ path: { id } })
      if (error) throw error
      return data
    },
  })
}

export function useRetryDelivery() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postV2WebhooksDeliveriesByIdRetry({ path: { id } })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all })
    },
  })
}
