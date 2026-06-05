export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: "running" | "stopped" | "paused" | "restarting";
  state: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
  created: Date;
  ports: ContainerPort[];
  labels: Record<string, string>;
}

export interface ContainerPort {
  privatePort: number;
  publicPort?: number | undefined;
  type: "tcp" | "udp";
}

export interface DockerImage {
  id: string;
  name: string;
  tag: string;
  size: number;
  created: Date;
  containers: number;
}

export interface TaskContainerMapping {
  taskType: string;
  image: string;
  command?: string[] | undefined;
  env?: Record<string, string> | undefined;
  ports?: number[] | undefined;
  resources?:
    | {
        CpuShares?: number | undefined;
        Memory?: number | undefined;
      }
    | undefined;
}

export interface ContainerExecution {
  containerId: string;
  taskId: string;
  taskName: string;
  status: "pending" | "pulling" | "running" | "completed" | "failed";
  startTime?: Date | undefined;
  endTime?: Date | undefined;
  exitCode?: number | undefined;
  logs: string[];
  error?: string | undefined;
}

export interface DockerStats {
  containers: {
    total: number;
    running: number;
    stopped: number;
  };
  images: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
}
