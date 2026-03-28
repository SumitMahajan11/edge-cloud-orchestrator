import type { DockerContainer, DockerImage, TaskContainerMapping } from '../types/docker'

const DOCKER_API_BASE = 'http://localhost:2375/v1.41'

class DockerClient {
  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    const url = `${DOCKER_API_BASE}${path}`
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
    
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Docker API error: ${response.status} - ${error}`)
    }
    
    return response
  }

  async listContainers(all = false): Promise<DockerContainer[]> {
    try {
      const response = await this.fetch(`/containers/json?all=${all}`)
      const containers = await response.json()
      
      return containers.map((c: unknown) => this.parseContainer(c))
    } catch (error) {
      console.error('Failed to list containers:', error)
      return []
    }
  }

  async getContainerStats(containerId: string): Promise<{ cpu: number; memory: number } | null> {
    try {
      const response = await this.fetch(`/containers/${containerId}/stats?stream=false`)
      const stats = await response.json()
      
      // Calculate CPU percentage
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0
      
      // Calculate memory usage
      const memoryUsage = stats.memory_stats.usage || 0
      const memoryLimit = stats.memory_stats.limit || 1
      const memoryPercent = (memoryUsage / memoryLimit) * 100
      
      return {
        cpu: Math.round(cpuPercent * 100) / 100,
        memory: Math.round(memoryPercent * 100) / 100,
      }
    } catch (error) {
      console.error('Failed to get container stats:', error)
      return null
    }
  }

  async createContainer(config: {
    image: string
    name: string
    cmd?: string[]
    env?: string[]
    ports?: Record<string, {}>
    labels?: Record<string, string>
    resources?: {
      CpuShares?: number
      Memory?: number
    }
  }): Promise<string> {
    // Create container
    const createResponse = await this.fetch('/containers/create', {
      method: 'POST',
      body: JSON.stringify({
        Image: config.image,
        Cmd: config.cmd,
        Env: config.env,
        ExposedPorts: config.ports,
        Labels: config.labels,
        HostConfig: {
          PortBindings: config.ports,
          Resources: config.resources,
        },
      }),
    })
    
    const { Id } = await createResponse.json()
    
    // Rename container
    await this.fetch(`/containers/${Id}/rename?name=${config.name}`, {
      method: 'POST',
    })
    
    return Id
  }

  async startContainer(containerId: string): Promise<void> {
    await this.fetch(`/containers/${containerId}/start`, {
      method: 'POST',
    })
  }

  async stopContainer(containerId: string, timeout = 30): Promise<void> {
    await this.fetch(`/containers/${containerId}/stop?t=${timeout}`, {
      method: 'POST',
    })
  }

  async removeContainer(containerId: string, force = false): Promise<void> {
    await this.fetch(`/containers/${containerId}?force=${force}`, {
      method: 'DELETE',
    })
  }

  async getContainerLogs(containerId: string, tail = 100): Promise<string> {
    const response = await this.fetch(
      `/containers/${containerId}/logs?stdout=true&stderr=true&tail=${tail}`
    )
    const logs = await response.text()
    // Docker logs have an 8-byte header, strip it
    return logs.replace(/[\x00-\x08]/g, '').trim()
  }

  async pullImage(image: string): Promise<void> {
    const response = await this.fetch(`/images/create?fromImage=${encodeURIComponent(image)}`, {
      method: 'POST',
    })
    // Wait for pull to complete
    await response.text()
  }

  async listImages(): Promise<DockerImage[]> {
    try {
      const response = await this.fetch('/images/json')
      const images = await response.json()
      
      return images.map((img: unknown) => ({
        id: (img as { Id: string }).Id,
        name: ((img as { RepoTags: string[] }).RepoTags?.[0] || 'none').split(':')[0],
        tag: ((img as { RepoTags: string[] }).RepoTags?.[0] || 'none').split(':')[1] || 'latest',
        size: (img as { Size: number }).Size,
        created: new Date((img as { Created: number }).Created * 1000),
        containers: (img as { Containers: number }).Containers || 0,
      }))
    } catch (error) {
      console.error('Failed to list images:', error)
      return []
    }
  }

  async getSystemInfo(): Promise<{ version: string; cpus: number; memory: number } | null> {
    try {
      const response = await this.fetch('/info')
      const info = await response.json()
      
      return {
        version: info.ServerVersion,
        cpus: info.NCPU,
        memory: info.MemTotal,
      }
    } catch (error) {
      console.error('Failed to get system info:', error)
      return null
    }
  }

  isAvailable(): boolean {
    // Check if Docker API is accessible
    return typeof window !== 'undefined' && window.location.hostname === 'localhost'
  }

  private parseContainer(c: unknown): DockerContainer {
    const container = c as {
      Id: string
      Names: string[]
      Image: string
      State: string
      Status: string
      Created: number
      Ports: Array<{
        PrivatePort: number
        PublicPort?: number
        Type: string
      }>
      Labels: Record<string, string>
    }
    
    return {
      id: container.Id,
      name: container.Names[0]?.replace('/', '') || 'unknown',
      image: container.Image,
      status: this.parseStatus(container.State),
      state: container.Status,
      cpuPercent: 0,
      memoryUsage: 0,
      memoryLimit: 0,
      networkRx: 0,
      networkTx: 0,
      created: new Date(container.Created * 1000),
      ports: container.Ports?.map(p => ({
        privatePort: p.PrivatePort,
        publicPort: p.PublicPort,
        type: p.Type as 'tcp' | 'udp',
      })) || [],
      labels: container.Labels || {},
    }
  }

  private parseStatus(state: string): DockerContainer['status'] {
    switch (state) {
      case 'running':
        return 'running'
      case 'exited':
      case 'dead':
        return 'stopped'
      case 'paused':
        return 'paused'
      case 'restarting':
        return 'restarting'
      default:
        return 'stopped'
    }
  }
}

export const dockerClient = new DockerClient()

// Default task type to container image mappings
export const DEFAULT_TASK_MAPPINGS: TaskContainerMapping[] = [
  {
    taskType: 'image-classification',
    image: 'tensorflow/tensorflow:latest',
    command: ['python', '-c', 'print("Image classification task")'],
  },
  {
    taskType: 'data-aggregation',
    image: 'python:3.9-alpine',
    command: ['python', '-c', 'print("Data aggregation task")'],
  },
  {
    taskType: 'video-processing',
    image: 'jrottenberg/ffmpeg:latest',
  },
  {
    taskType: 'model-inference',
    image: 'pytorch/pytorch:latest',
    command: ['python', '-c', 'print("Model inference task")'],
  },
  {
    taskType: 'sensor-analysis',
    image: 'python:3.9-alpine',
    command: ['python', '-c', 'print("Sensor analysis task")'],
  },
]
