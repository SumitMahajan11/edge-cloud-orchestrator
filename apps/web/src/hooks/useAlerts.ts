import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getV2Alerts } from "@edgecloud/api-client";
import { api } from "../lib/api-client";

export interface SystemAlert {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  description: string;
  source: string;
  firedAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
}

export function useAlerts() {
  return useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const { data, error } = await getV2Alerts();
      if (error) {throw error;}
      return ((data as any)?.alerts || []) as SystemAlert[];
    },
    refetchInterval: 10000,
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return api.post(`/v2/alerts/${id}/acknowledge`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}
