import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useDebounce } from "./useDebounce";
import { useEffect, useState } from "react";

/**
 * useCarbonMetrics hook
 *
 * Manages reactive state for Carbon & Eco-Scheduling monitoring.
 * Replaces hardcoded mock data with live API telemetry.
 */
export function useCarbonMetrics() {
  const queryClient = useQueryClient();

  // 1. Intensity Query (Real-time grid data)
  const intensity = useQuery({
    queryKey: ["carbon", "intensity"],
    queryFn: async () => {
      return api.get<any>("/v2/carbon/intensity");
    },
    refetchInterval: 60_000, // Poll every minute
  });

  // 2. Savings Query (Historical and cumulative)
  const savings = useQuery({
    queryKey: ["carbon", "savings"],
    queryFn: async () => {
      return api.get<any>("/v2/carbon/savings?days=7");
    },
    staleTime: 300_000,
  });

  // 3. Policy Query (Current weights)
  const policy = useQuery({
    queryKey: ["carbon", "policy"],
    queryFn: async () => {
      return api.get<any>("/v2/carbon/policy");
    },
  });

  // 4. Update Policy Mutation
  const updatePolicy = useMutation({
    mutationFn: async (carbonWeight: number) => {
      return api.patch<any>("/v2/carbon/policy", { carbonWeight });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["carbon", "policy"], (old: any) => ({
        ...old,
        carbonWeight: data.carbonWeight,
      }));
    },
  });

  // Handle debounced weight updates
  const [localWeight, setLocalWeight] = useState<number>(0.2);
  const debouncedWeight = useDebounce(localWeight, 800);

  useEffect(() => {
    if (
      policy.data &&
      localWeight === 0.2 &&
      policy.data.carbonWeight !== 0.2
    ) {
      setLocalWeight(policy.data.carbonWeight);
    }
  }, [policy.data]);

  useEffect(() => {
    if (policy.data && debouncedWeight !== policy.data.carbonWeight) {
      updatePolicy.mutate(debouncedWeight);
    }
  }, [debouncedWeight]);

  return {
    regions: intensity.data?.regions || [],
    savings: savings.data,
    policy: policy.data,
    isLoading: intensity.isLoading || savings.isLoading || policy.isLoading,

    // Policy Control
    carbonWeight: localWeight,
    setCarbonWeight: setLocalWeight,
    isUpdating: updatePolicy.isPending,

    refetch: () => {
      void intensity.refetch();
      void savings.refetch();
      void policy.refetch();
    },
  };
}

export function useCarbonReport(from?: string, to?: string) {
  const query = useQuery({
    queryKey: ["carbon", "report", from, to],
    queryFn: async () => {
      let path = "/v2/carbon/report?format=json";
      if (from) {path += `&from=${encodeURIComponent(from)}`;}
      if (to) {path += `&to=${encodeURIComponent(to)}`;}
      return api.get<any>(path);
    },
    staleTime: 30_000,
  });

  const downloadCsv = async () => {
    let path = "/v2/carbon/report?format=csv";
    if (from) {path += `&from=${encodeURIComponent(from)}`;}
    if (to) {path += `&to=${encodeURIComponent(to)}`;}
    const csvContent = await api.get<string>(path);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const filenameFrom = from ? from.split('T')[0] : 'start';
    const filenameTo = to ? to.split('T')[0] : 'end';
    link.setAttribute("download", `carbon-report-${filenameFrom}-to-${filenameTo}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    downloadCsv,
  };
}
