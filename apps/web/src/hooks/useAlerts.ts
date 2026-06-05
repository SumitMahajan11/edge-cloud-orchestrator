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
      try {
        const { data, error } = await getV2Alerts();
        if (error) throw error;
        return ((data as any)?.alerts || []) as SystemAlert[];
      } catch (err) {
        return MOCK_ALERTS;
      }
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

const MOCK_ALERTS: SystemAlert[] = [
  {
    id: "alt-1",
    severity: "CRITICAL",
    title: "Edge Node Latency Spike",
    description: "Multiple nodes in us-east region reporting p99 latency > 2s.",
    source: "monitoring.latency",
    firedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    acknowledgedAt: null,
  },
  {
    id: "alt-2",
    severity: "HIGH",
    title: "Model Drift Detected",
    description: "Scheduling accuracy dropped below 90% threshold in APAC.",
    source: "ml.optimizer",
    firedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    acknowledgedAt: null,
  },
  {
    id: "alt-3",
    severity: "LOW",
    title: "Scheduled Retraining Started",
    description: "Auto-retraining job initiated for global scheduler model.",
    source: "system.cron",
    firedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    acknowledgedAt: new Date(Date.now() - 1000 * 60 * 115).toISOString(),
  },
];
