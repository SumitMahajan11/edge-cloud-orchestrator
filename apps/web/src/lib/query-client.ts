import { QueryClient } from "@tanstack/react-query";

/**
 * Global React Query client with stale-time tiers per data volatility:
 * - Logs/events: always fresh (0s)
 * - Node health / task status: 5s
 * - Default: 30s
 *
 * WebSocket events invalidate the relevant query keys in real time, so tables
 * update without a full refetch (see useWsInvalidator in src/stores/websocket.ts).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

// Stale-time presets for hooks to import
export const STALE = {
  live: 0,
  nodeHealth: 5_000,
  taskStatus: 5_000,
  default: 30_000,
  long: 60_000,
} as const;

// Canonical query keys — single source of truth
export const queryKeys = {
  nodes: {
    all: ["nodes"] as const,
    list: (params?: Record<string, unknown>) =>
      ["nodes", "list", params ?? {}] as const,
    detail: (id: string) => ["nodes", "detail", id] as const,
    health: (id: string) => ["nodes", "health", id] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    list: (params?: Record<string, unknown>) =>
      ["tasks", "list", params ?? {}] as const,
    detail: (id: string) => ["tasks", "detail", id] as const,
    stats: () => ["tasks", "stats"] as const,
    schedulingDecision: (id: string) =>
      ["tasks", "scheduling-decision", id] as const,
  },
  metrics: {
    system: () => ["metrics", "system"] as const,
    nodes: () => ["metrics", "nodes"] as const,
  },
  scheduler: {
    status: () => ["scheduler", "status"] as const,
    metrics: () => ["scheduler", "metrics"] as const,
  },
  webhooks: {
    all: ["webhooks"] as const,
    deliveries: (id: string) => ["webhooks", "deliveries", id] as const,
  },
  cost: {
    summary: () => ["cost", "summary"] as const,
    byNode: () => ["cost", "by-node"] as const,
  },
  carbon: {
    summary: () => ["carbon", "summary"] as const,
    byRegion: () => ["carbon", "by-region"] as const,
  },
  workflows: {
    all: ["workflows"] as const,
    detail: (id: string) => ["workflows", "detail", id] as const,
    executions: (id: string) => ["workflows", "executions", id] as const,
  },
} as const;
