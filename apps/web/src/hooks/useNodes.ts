import { useQuery, useMutation } from "@tanstack/react-query";
import {
  getV2Nodes,
  getV2NodesById,
  postV2Nodes,
  postV2NodesByIdDrain,
  postV2NodesByIdOffline,
} from "@edgecloud/api-client";
import { queryKeys, STALE, queryClient } from "../lib/query-client";
import {
  transformNodesFromApi,
  transformNodeFromApi,
  transformNodeToApi,
} from "../lib/typeTransformers";

export function useNodes() {
  return useQuery({
    queryKey: queryKeys.nodes.all,
    queryFn: async () => {
      const { data, error } = await getV2Nodes();
      if (error) throw error;
      return transformNodesFromApi((data as any).data || []);
    },
    staleTime: STALE.nodeHealth,
  });
}

export function useNode(id: string) {
  return useQuery({
    queryKey: queryKeys.nodes.detail(id),
    queryFn: async () => {
      const { data, error } = await getV2NodesById({ path: { id } });
      if (error) throw error;
      return transformNodeFromApi(data as any);
    },
    enabled: !!id,
  });
}

export function useDrainNode() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postV2NodesByIdDrain({ path: { id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.nodes.detail(id),
      });
    },
  });
}

export function useForceOfflineNode() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postV2NodesByIdOffline({ path: { id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.nodes.detail(id),
      });
    },
  });
}

import { api } from "../lib/api-client";

export function useRegisterNode() {
  return useMutation({
    mutationFn: async (nodeData: any) => {
      const apiPayload = transformNodeToApi(nodeData);
      delete apiPayload.status;
      delete apiPayload.isMaintenanceMode;
      const { data, error } = await postV2Nodes({ body: apiPayload });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all });
    },
  });
}

export function useRotateCertificate() {
  return useMutation({
    mutationFn: async (id: string) => {
      return api.post<{
        success: boolean;
        message: string;
        certificatePem: string;
        serialNumber: string;
        expiresAt: string;
        privateKey: string;
      }>(`/v2/nodes/${id}/rotate-certificate`, {});
    },
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.nodes.detail(id),
      });
    },
  });
}

