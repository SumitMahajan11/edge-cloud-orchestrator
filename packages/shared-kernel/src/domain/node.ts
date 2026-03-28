export type NodeStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'MAINTENANCE';

export interface EdgeNode {
  id: string;
  name: string;
  location: string;
  region: string;
  status: NodeStatus;
  ipAddress: string;
  port: number;
  url: string;
  cpuCores: number;
  memoryGB: number;
  storageGB: number;
  cpuUsage: number;
  memoryUsage: number;
  storageUsage: number;
  latency: number;
  tasksRunning: number;
  maxTasks: number;
  costPerHour: number;
  bandwidthInMbps: number;
  bandwidthOutMbps: number;
  isMaintenanceMode: boolean;
  healthScore: number;
  consecutiveFailures: number;
  lastHeartbeat: Date;
  capabilities?: string[];
  labels?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NodeMetrics {
  nodeId: string;
  timestamp: Date;
  cpuUsage: number;
  memoryUsage: number;
  storageUsage: number;
  networkLatency: number;
  tasksRunning: number;
  tasksCompleted: number;
  tasksFailed: number;
}

export interface RegisterNodeCommand {
  name: string;
  location: string;
  region: string;
  ipAddress: string;
  port: number;
  cpuCores: number;
  memoryGB: number;
  storageGB: number;
  costPerHour?: number;
  maxTasks?: number;
  bandwidthInMbps?: number;
  bandwidthOutMbps?: number;
  capabilities?: string[];
  labels?: Record<string, string>;
}

export interface NodeHealthScore {
  nodeId: string;
  score: number;
  factors: {
    uptime: number;
    successRate: number;
    latency: number;
    resourceUtilization: number;
  };
}
