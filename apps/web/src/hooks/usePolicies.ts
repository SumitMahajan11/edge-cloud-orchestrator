import { useQuery, useMutation } from "@tanstack/react-query";
import {
  getV2Policies,
  getV2PoliciesActive,
  getV2PoliciesConfig,
  patchV2PoliciesActive,
  getV2PoliciesThresholds,
  patchV2PoliciesThresholds,
} from "@edgecloud/api-client";
import { STALE, queryClient } from "../lib/query-client";

export function usePolicies() {
  return useQuery({
    queryKey: ["policies"],
    queryFn: async () => {
      const { data, error } = await getV2Policies();
      if (error) throw error;
      return data as { active: string; available: any[] };
    },
    staleTime: STALE.default,
  });
}

export function useActivePolicy() {
  return useQuery({
    queryKey: ["policies", "active"],
    queryFn: async () => {
      const { data, error } = await getV2PoliciesActive();
      if (error) throw error;
      return data;
    },
    staleTime: STALE.default,
  });
}

export function usePolicyConfig() {
  return useQuery({
    queryKey: ["policies", "config"],
    queryFn: async () => {
      const { data, error } = await getV2PoliciesConfig();
      if (error) throw error;
      return data;
    },
    staleTime: STALE.default,
  });
}

export function useUpdatePolicy() {
  return useMutation({
    mutationFn: async (policy: string) => {
      const { data, error } = await patchV2PoliciesActive({ body: { policy } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["policies"] });
    },
  });
}

export function useThresholds() {
  return useQuery({
    queryKey: ["policies", "thresholds"],
    queryFn: async () => {
      const { data, error } = await getV2PoliciesThresholds();
      if (error) throw error;
      return data;
    },
    staleTime: STALE.default,
  });
}

export function useUpdateThreshold() {
  return useMutation({
    mutationFn: async (thresholds: any) => {
      const { data, error } = await patchV2PoliciesThresholds({
        body: thresholds,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["policies", "thresholds"],
      });
    },
  });
}

import { api } from "../lib/api-client";

export interface SchedulingPolicy {
  id: string;
  name: string;
  type: string;
  config: {
    costWeight: number;
    latencyWeight: number;
    carbonWeight: number;
  };
  isActive: boolean;
  tenantId: string;
}

export function useSchedulingPolicy() {
  return useQuery({
    queryKey: ["scheduling-policy"],
    queryFn: async () => {
      return api.get<SchedulingPolicy>("/v2/scheduling/policy");
    },
    staleTime: STALE.default,
  });
}

export function useUpdateSchedulingPolicy() {
  return useMutation({
    mutationFn: async (weights: {
      costWeight: number;
      latencyWeight: number;
      carbonWeight: number;
    }) => {
      return api.put<{ success: boolean; policy: SchedulingPolicy }>(
        "/v2/scheduling/policy",
        weights
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheduling-policy"] });
    },
  });
}
