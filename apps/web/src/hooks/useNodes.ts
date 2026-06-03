import { useQuery, useMutation } from '@tanstack/react-query'
import { getV2Nodes, getV2NodesById, postV2Nodes, postV2NodesByIdDrain, postV2NodesByIdOffline } from '@edgecloud/api-client'
import { queryKeys, STALE, queryClient } from '../lib/query-client'
import { transformNodesFromApi, transformNodeFromApi } from '../lib/typeTransformers'

export function useNodes() {
  return useQuery({
    queryKey: queryKeys.nodes.all,
    queryFn: async () => {
      const { data, error } = await getV2Nodes()
      if (error) throw error
      return transformNodesFromApi(data as any)
    },
    staleTime: STALE.nodeHealth,
  })
}

export function useNode(id: string) {
  return useQuery({
    queryKey: queryKeys.nodes.detail(id),
    queryFn: async () => {
      const { data, error } = await getV2NodesById({ path: { id } })
      if (error) throw error
      return transformNodeFromApi(data as any)
    },
    enabled: !!id,
  })
}

export function useDrainNode() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postV2NodesByIdDrain({ path: { id } })
      if (error) throw error
      return data
    },
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.detail(id) })
    },
  })
}

export function useForceOfflineNode() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postV2NodesByIdOffline({ path: { id } })
      if (error) throw error
      return data
    },
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.detail(id) })
    },
  })
}

export function useRegisterNode() {
  return useMutation({
    mutationFn: async (nodeData: any) => {
      const { data, error } = await postV2Nodes({ body: nodeData as any })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
    },
  })
}
