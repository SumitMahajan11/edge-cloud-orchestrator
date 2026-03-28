export interface DockerContainer {
  id: string
  name: string
  image: string
  status: 'running' | 'stopped' | 'paused' | 'restarting'
  state: string
  cpuPercent: number
  memoryUsage: number
  memoryLimit: number
  networkRx: number
  networkTx: number
  created: Date
  ports: ContainerPort[]
  labels: Record<string, string>
}

export interface ContainerPort {
  privatePort: number
  publicPort?: number
  type: 'tcp' | 'udp'
}

export interface DockerImage {
  id: string
  name: string
  tag: string
  size: number
  created: Date
  containers: number
}

export interface TaskContainerMapping {
  taskType: string
  image: string
  command?: string[]
  env?: Record<string, string>
  ports?: number[]
  resources?: {
    CpuShares?: number
    Memory?: number
  }
}

export interface ContainerExecution {
  containerId: string
  taskId: string
  taskName: string
  status: 'pending' | 'pulling' | 'running' | 'completed' | 'failed'
  startTime?: Date
  endTime?: Date
  exitCode?: number
  logs: string[]
  error?: string
}

export interface DockerStats {
  containers: {
    total: number
    running: number
    stopped: number
  }
  images: number
  cpuUsage: number
  memoryUsage: number
  diskUsage: number
}
