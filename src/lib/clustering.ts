interface ClusterNode {
  id: string
  url: string
  weight: number
  healthy: boolean
  lastHeartbeat: number
  metadata: Record<string, unknown>
}

interface ClusterConfig {
  heartbeatInterval?: number
  nodeTimeout?: number
  loadBalancingStrategy?: 'round-robin' | 'least-connections' | 'weighted'
}

interface TaskDistribution {
  nodeId: string
  taskCount: number
  loadPercentage: number
}

class ClusterManager {
  private nodes: Map<string, ClusterNode> = new Map()
  private config: Required<ClusterConfig>
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private currentIndex = 0
  private taskDistribution: Map<string, number> = new Map()

  constructor(config: ClusterConfig = {}) {
    this.config = {
      heartbeatInterval: 30000, // 30 seconds
      nodeTimeout: 60000, // 1 minute
      loadBalancingStrategy: 'round-robin',
      ...config,
    }
    this.startHeartbeat()
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.checkNodeHealth()
    }, this.config.heartbeatInterval)
  }

  private checkNodeHealth(): void {
    const now = Date.now()
    const timeout = this.config.nodeTimeout

    for (const [id, node] of this.nodes) {
      if (now - node.lastHeartbeat > timeout) {
        node.healthy = false
        console.warn(`Node ${id} marked as unhealthy (timeout)`)
      }
    }
  }

  registerNode(id: string, url: string, weight = 1, metadata: Record<string, unknown> = {}): ClusterNode {
    const node: ClusterNode = {
      id,
      url,
      weight,
      healthy: true,
      lastHeartbeat: Date.now(),
      metadata,
    }

    this.nodes.set(id, node)
    this.taskDistribution.set(id, 0)
    console.log(`Node ${id} registered: ${url}`)
    return node
  }

  unregisterNode(id: string): boolean {
    const deleted = this.nodes.delete(id)
    this.taskDistribution.delete(id)
    if (deleted) {
      console.log(`Node ${id} unregistered`)
    }
    return deleted
  }

  updateHeartbeat(id: string): boolean {
    const node = this.nodes.get(id)
    if (!node) return false

    node.lastHeartbeat = Date.now()
    node.healthy = true
    return true
  }

  getHealthyNodes(): ClusterNode[] {
    return Array.from(this.nodes.values()).filter(n => n.healthy)
  }

  selectNode(): ClusterNode | null {
    const healthyNodes = this.getHealthyNodes()
    if (healthyNodes.length === 0) return null

    switch (this.config.loadBalancingStrategy) {
      case 'round-robin':
        return this.roundRobin(healthyNodes)
      case 'least-connections':
        return this.leastConnections(healthyNodes)
      case 'weighted':
        return this.weighted(healthyNodes)
      default:
        return this.roundRobin(healthyNodes)
    }
  }

  private roundRobin(nodes: ClusterNode[]): ClusterNode {
    const node = nodes[this.currentIndex % nodes.length]
    this.currentIndex++
    return node
  }

  private leastConnections(nodes: ClusterNode[]): ClusterNode {
    return nodes.reduce((best, node) => {
      const bestCount = this.taskDistribution.get(best.id) || 0
      const nodeCount = this.taskDistribution.get(node.id) || 0
      return nodeCount < bestCount ? node : best
    })
  }

  private weighted(nodes: ClusterNode[]): ClusterNode {
    const totalWeight = nodes.reduce((sum, n) => sum + n.weight, 0)
    let random = Math.random() * totalWeight

    for (const node of nodes) {
      random -= node.weight
      if (random <= 0) return node
    }

    return nodes[0]
  }

  assignTask(nodeId: string): void {
    const count = this.taskDistribution.get(nodeId) || 0
    this.taskDistribution.set(nodeId, count + 1)
  }

  completeTask(nodeId: string): void {
    const count = this.taskDistribution.get(nodeId) || 0
    if (count > 0) {
      this.taskDistribution.set(nodeId, count - 1)
    }
  }

  getTaskDistribution(): TaskDistribution[] {
    const total = Array.from(this.taskDistribution.values()).reduce((a, b) => a + b, 0)

    return Array.from(this.nodes.values()).map(node => {
      const count = this.taskDistribution.get(node.id) || 0
      return {
        nodeId: node.id,
        taskCount: count,
        loadPercentage: total > 0 ? (count / total) * 100 : 0,
      }
    })
  }

  getStats(): {
    total: number
    healthy: number
    unhealthy: number
    totalTasks: number
    strategy: string
  } {
    const healthy = this.getHealthyNodes().length
    const totalTasks = Array.from(this.taskDistribution.values()).reduce((a, b) => a + b, 0)

    return {
      total: this.nodes.size,
      healthy,
      unhealthy: this.nodes.size - healthy,
      totalTasks,
      strategy: this.config.loadBalancingStrategy,
    }
  }

  broadcast(message: unknown): Promise<unknown[]> {
    const promises = Array.from(this.nodes.values())
      .filter(n => n.healthy)
      .map(async node => {
        try {
          const response = await fetch(`${node.url}/broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
          })
          return response.json()
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'Unknown error' }
        }
      })

    return Promise.all(promises)
  }

  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }
    this.nodes.clear()
    this.taskDistribution.clear()
  }
}

// Leader election for distributed coordination
class LeaderElection {
  private nodeId: string
  private isLeader = false
  private leaderId: string | null = null
  private callbacks: Array<(isLeader: boolean) => void> = []

  constructor(nodeId: string) {
    this.nodeId = nodeId
  }

  async elect(nodes: string[]): Promise<boolean> {
    // Simple leader election: lowest node ID wins
    const sorted = [...nodes].sort()
    const newLeader = sorted[0]

    const wasLeader = this.isLeader
    this.leaderId = newLeader
    this.isLeader = newLeader === this.nodeId

    if (wasLeader !== this.isLeader) {
      this.callbacks.forEach(cb => cb(this.isLeader))
    }

    return this.isLeader
  }

  onLeadershipChange(callback: (isLeader: boolean) => void): () => void {
    this.callbacks.push(callback)
    return () => {
      const index = this.callbacks.indexOf(callback)
      if (index !== -1) {
        this.callbacks.splice(index, 1)
      }
    }
  }

  isCurrentLeader(): boolean {
    return this.isLeader
  }

  getLeaderId(): string | null {
    return this.leaderId
  }
}

// Singleton instance
export const clusterManager = new ClusterManager()

export { ClusterManager, LeaderElection }
export type { ClusterNode, ClusterConfig, TaskDistribution }
