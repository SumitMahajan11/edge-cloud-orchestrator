import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";

/**
 * useMLMetrics hook
 *
 * Manages reactive state for ML Pipeline monitoring.
 * Replaces hardcoded mock data with live API telemetry.
 */
export function useMLMetrics() {
  const queryClient = useQueryClient();

  // 1. Drift State Query
  const driftCurrent = useQuery({
    queryKey: ["ml", "drift", "current"],
    queryFn: async () => {
      return api.get<any>("/v2/ml/drift/current");
    },
    refetchInterval: 30_000, // Background poll every 30s
    staleTime: 25_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // 2. Drift History Query
  const driftHistory = useQuery({
    queryKey: ["ml", "drift", "history"],
    queryFn: async () => {
      return api.get<any[]>("/v2/ml/drift/history?hours=24");
    },
    refetchInterval: 120_000, // Poll history every 120s
    staleTime: 115_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // 3. Model Status Query
  const modelCurrent = useQuery({
    queryKey: ["ml", "model", "current"],
    queryFn: async () => {
      return api.get<any>("/v2/ml/model/current");
    },
    staleTime: 300_000, // 5 minutes stale time
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // 4. Outcome & Bandit Stats Query
  const outcomeStats = useQuery({
    queryKey: ["ml", "outcomes", "stats"],
    queryFn: async () => {
      return api.get<any>("/v2/ml/outcomes/stats");
    },
    refetchInterval: 60_000, // Outcomes accumulated slowly (60s)
    staleTime: 55_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // 5. Retrain Status Query (Polled when active)
  const retrainStatus = useQuery({
    queryKey: ["ml", "retrain", "status"],
    queryFn: async () => {
      return api.get<any>("/v2/ml/retrain/status");
    },
    // Poll every 15 seconds if a retraining job is in progress
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return ["QUEUED", "TRAINING", "VALIDATING"].includes(data.status)
        ? 15_000
        : false;
    },
    staleTime: (query) => {
      const data = query.state.data;
      if (!data) return 0;
      return ["QUEUED", "TRAINING", "VALIDATING"].includes(data.status)
        ? 10_000
        : 30_000;
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // 6. Retrain Mutation
  const retrainMutation = useMutation({
    mutationFn: async () => {
      return api.post<any>("/v2/ml/retrain");
    },
    onSuccess: () => {
      // Refresh status immediately
      void retrainStatus.refetch();
      void queryClient.invalidateQueries({ queryKey: ["ml"] });
    },
  });

  const activeStatus = retrainStatus.data?.status || "IDLE";
  const isRetraining = ["QUEUED", "TRAINING", "VALIDATING"].includes(
    activeStatus,
  );

  return {
    // Data
    drift: driftCurrent.data,
    driftHistory: driftHistory.data,
    model: modelCurrent.data,
    stats: outcomeStats.data,
    retrainStatus: retrainStatus.data,

    // States
    isLoading: driftCurrent.isLoading || modelCurrent.isLoading,
    isError: driftCurrent.isError || modelCurrent.isError,
    isRetraining,
    retrainError: retrainStatus.data?.error,

    // Actions
    triggerRetrain: () => retrainMutation.mutate(),

    // Helpers
    refetch: () => {
      void driftCurrent.refetch();
      void modelCurrent.refetch();
      void outcomeStats.refetch();
      void retrainStatus.refetch();
    },
  };
}
