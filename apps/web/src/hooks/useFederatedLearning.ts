import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export function useFederatedLearning() {
  const queryClient = useQueryClient();

  // 1. List all FL Models
  const modelsQuery = useQuery({
    queryKey: ["fl", "models"],
    queryFn: async () => {
      const response = await api.get<{ data: any[] }>("/v2/fl/models");
      return response.data || [];
    },
    refetchInterval: 60_000, // refresh every 60s
    staleTime: 55_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // 2. Start FL Session Mutation
  const startSessionMutation = useMutation({
    mutationFn: async ({
      modelId,
      totalRounds,
      config,
    }: {
      modelId: string;
      totalRounds: number;
      config: any;
    }) => {
      return api.post<any>("/v2/fl/sessions", {
        modelId,
        totalRounds,
        config,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["fl"] });
    },
  });

  // 3. Stop FL Session Mutation
  const stopSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return api.post<any>(`/v2/fl/sessions/${sessionId}/stop`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["fl"] });
    },
  });

  return {
    models: modelsQuery.data || [],
    isLoading: modelsQuery.isLoading,
    isError: modelsQuery.isError,
    startSession: startSessionMutation.mutate,
    isStarting: startSessionMutation.isPending,
    stopSession: stopSessionMutation.mutate,
    isStopping: stopSessionMutation.isPending,
    refetch: () => {
      void modelsQuery.refetch();
    },
  };
}

export function useFLModelDetails(modelId: string) {
  return useQuery({
    queryKey: ["fl", "model", modelId],
    queryFn: async () => {
      return api.get<any>(`/v2/fl/models/${modelId}`);
    },
    enabled: !!modelId,
  });
}
