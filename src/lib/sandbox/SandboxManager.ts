/**
 * Edge Isolation with Sandboxing
 * Provides strong isolation for edge node execution
 */

import { logger } from '../logger'
import type { Task, EdgeNode } from '../../types'

// Types
export interface SandboxConfig {
  memoryLimitMB: number
  cpuLimitPercent: number
  networkIsolated: boolean
  filesystemReadOnly: boolean
  maxProcesses: number
  timeoutMs: number
  allowedSyscalls: string[]
}

export interface SandboxInstance {
  id: string
  nodeId: string
  taskId: string
  status: 'creating' | 'running' | 'paused' | 'stopped' | 'error'
  config: SandboxConfig
  createdAt: number
  resourceUsage: {
    memoryMB: number
    cpuPercent: number
    networkBytesIn: number
    networkBytesOut: number
  }
  violations: SandboxViolation[]
}

export interface SandboxViolation {
  type: 'memory_exceeded' | 'cpu_exceeded' | 'syscall_blocked' | 'network_blocked' | 'filesystem_blocked' | 'timeout'
  timestamp: number
  details: string
  action: 'logged' | 'throttled' | 'killed'
}

export interface IsolationPolicy {
  name: string
  config: SandboxConfig
  applyTo: (task: Task) => boolean
}

type SandboxEvent = 'sandbox.created' | 'sandbox.violation' | 'sandbox.stopped'
type SandboxCallback = (event: SandboxEvent, data: unknown) => void

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  memoryLimitMB: 512,
  cpuLimitPercent: 80,
  networkIsolated: false,
  filesystemReadOnly: true,
  maxProcesses: 10,
  timeoutMs: 60000,
  allowedSyscalls: ['read', 'write', 'open', 'close', 'mmap', 'munmap', 'brk', 'exit'],
}

/**
 * Sandbox Manager - Manages isolated execution environments
 */
export class SandboxManager {
  private sandboxes: Map<string, SandboxInstance> = new Map()
  private policies: IsolationPolicy[] = []
  private callbacks: Map<SandboxEvent, Set<SandboxCallback>> = new Map()
  private monitoringInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.addDefaultPolicies()
    this.startMonitoring()
  }

  /**
   * Add default isolation policies
   */
  private addDefaultPolicies(): void {
    // High-security policy for untrusted tasks
    this.policies.push({
      name: 'high-security',
      config: {
        memoryLimitMB: 256,
        cpuLimitPercent: 50,
        networkIsolated: true,
        filesystemReadOnly: true,
        maxProcesses: 5,
        timeoutMs: 30000,
        allowedSyscalls: ['read', 'write', 'exit'],
      },
      applyTo: (task) => task.priority === 'low' && task.type === 'Log Analysis',
    })

    // Standard policy for normal tasks
    this.policies.push({
      name: 'standard',
      config: {
        memoryLimitMB: 512,
        cpuLimitPercent: 70,
        networkIsolated: false,
        filesystemReadOnly: true,
        maxProcesses: 10,
        timeoutMs: 60000,
        allowedSyscalls: DEFAULT_SANDBOX_CONFIG.allowedSyscalls,
      },
      applyTo: (task) => ['medium', 'high'].includes(task.priority),
    })

    // Trusted policy for critical tasks
    this.policies.push({
      name: 'trusted',
      config: {
        memoryLimitMB: 2048,
        cpuLimitPercent: 90,
        networkIsolated: false,
        filesystemReadOnly: false,
        maxProcesses: 50,
        timeoutMs: 300000,
        allowedSyscalls: ['*'], // All syscalls allowed
      },
      applyTo: (task) => task.priority === 'critical',
    })
  }

  /**
   * Create sandbox for task execution
   */
  createSandbox(task: Task, node: EdgeNode): SandboxInstance {
    // Find applicable policy
    const policy = this.policies.find(p => p.applyTo(task)) || {
      name: 'default',
      config: DEFAULT_SANDBOX_CONFIG,
    }

    const sandboxId = `sandbox-${task.id}-${Date.now()}`

    const sandbox: SandboxInstance = {
      id: sandboxId,
      nodeId: node.id,
      taskId: task.id,
      status: 'creating',
      config: policy.config,
      createdAt: Date.now(),
      resourceUsage: {
        memoryMB: 0,
        cpuPercent: 0,
        networkBytesIn: 0,
        networkBytesOut: 0,
      },
      violations: [],
    }

    this.sandboxes.set(sandboxId, sandbox)
    this.emit('sandbox.created', { sandboxId, taskId: task.id, policy: policy.name })

    logger.info('Sandbox created', {
      sandboxId,
      taskId: task.id,
      nodeId: node.id,
      policy: policy.name,
      config: sandbox.config,
    })

    // Simulate sandbox creation (in production, would use containers/VMs)
    setTimeout(() => {
      sandbox.status = 'running'
    }, 100)

    return sandbox
  }

  /**
   * Get sandbox by ID
   */
  getSandbox(sandboxId: string): SandboxInstance | undefined {
    return this.sandboxes.get(sandboxId)
  }

  /**
   * Get sandboxes by node
   */
  getSandboxesByNode(nodeId: string): SandboxInstance[] {
    return Array.from(this.sandboxes.values()).filter(s => s.nodeId === nodeId)
  }

  /**
   * Get sandboxes by task
   */
  getSandboxByTask(taskId: string): SandboxInstance | undefined {
    for (const sandbox of this.sandboxes.values()) {
      if (sandbox.taskId === taskId) return sandbox
    }
    return undefined
  }

  /**
   * Stop sandbox
   */
  stopSandbox(sandboxId: string, reason: string = 'manual'): boolean {
    const sandbox = this.sandboxes.get(sandboxId)
    if (!sandbox) return false

    sandbox.status = 'stopped'
    this.emit('sandbox.stopped', { sandboxId, reason, violations: sandbox.violations.length })

    logger.info('Sandbox stopped', { sandboxId, reason, violations: sandbox.violations.length })

    // Clean up after a delay
    setTimeout(() => {
      this.sandboxes.delete(sandboxId)
    }, 60000)

    return true
  }

  /**
   * Kill sandbox immediately
   */
  killSandbox(sandboxId: string, reason: string): boolean {
    const sandbox = this.sandboxes.get(sandboxId)
    if (!sandbox) return false

    sandbox.status = 'stopped'
    this.sandboxes.delete(sandboxId)

    logger.warn('Sandbox killed', { sandboxId, reason })
    return true
  }

  /**
   * Check if task can run on node (resource availability)
   */
  canRunOnNode(task: Task, node: EdgeNode): { allowed: boolean; reason?: string } {
    // Check node capacity
    const runningSandboxes = this.getSandboxesByNode(node.id)
      .filter(s => s.status === 'running')

    // Get policy for task
    const policy = this.policies.find(p => p.applyTo(task)) || { config: DEFAULT_SANDBOX_CONFIG }
    
    // Check memory
    const availableMemoryMB = (100 - node.memory) / 100 * 8192 // Assume 8GB total
    if (policy.config.memoryLimitMB > availableMemoryMB) {
      return { allowed: false, reason: 'Insufficient memory' }
    }

    // Check CPU
    const availableCpu = 100 - node.cpu
    if (policy.config.cpuLimitPercent > availableCpu) {
      return { allowed: false, reason: 'Insufficient CPU' }
    }

    // Check process limit
    if (runningSandboxes.length >= node.maxTasks) {
      return { allowed: false, reason: 'Max tasks reached' }
    }

    return { allowed: true }
  }

  /**
   * Report resource usage
   */
  reportUsage(sandboxId: string, usage: Partial<SandboxInstance['resourceUsage']>): void {
    const sandbox = this.sandboxes.get(sandboxId)
    if (!sandbox || sandbox.status !== 'running') return

    sandbox.resourceUsage = { ...sandbox.resourceUsage, ...usage }
  }

  /**
   * Record violation
   */
  recordViolation(sandboxId: string, violation: Omit<SandboxViolation, 'timestamp'>): void {
    const sandbox = this.sandboxes.get(sandboxId)
    if (!sandbox) return

    const fullViolation: SandboxViolation = {
      ...violation,
      timestamp: Date.now(),
    }

    sandbox.violations.push(fullViolation)
    this.emit('sandbox.violation', { sandboxId, violation: fullViolation })

    logger.warn('Sandbox violation', {
      sandboxId,
      type: violation.type,
      action: violation.action,
      details: violation.details,
    })

    // Kill sandbox if action is kill
    if (violation.action === 'killed') {
      this.killSandbox(sandboxId, `Violation: ${violation.type}`)
    }
  }

  /**
   * Add custom isolation policy
   */
  addPolicy(policy: IsolationPolicy): void {
    this.policies.push(policy)
    logger.info('Isolation policy added', { name: policy.name })
  }

  /**
   * Get all policies
   */
  getPolicies(): IsolationPolicy[] {
    return [...this.policies]
  }

  /**
   * Start monitoring sandboxes
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.monitorSandboxes()
    }, 1000)
  }

  /**
   * Monitor all sandboxes
   */
  private monitorSandboxes(): void {
    const now = Date.now()

    for (const [sandboxId, sandbox] of this.sandboxes) {
      if (sandbox.status !== 'running') continue

      // Check timeout
      if (now - sandbox.createdAt > sandbox.config.timeoutMs) {
        this.recordViolation(sandboxId, {
          type: 'timeout',
          details: `Execution exceeded ${sandbox.config.timeoutMs}ms`,
          action: 'killed',
        })
        continue
      }

      // Simulate resource checks (in production, would query actual resources)
      const simulatedMemory = sandbox.resourceUsage.memoryMB + Math.random() * 10
      const simulatedCpu = sandbox.resourceUsage.cpuPercent + (Math.random() - 0.5) * 5

      sandbox.resourceUsage.memoryMB = simulatedMemory
      sandbox.resourceUsage.cpuPercent = Math.max(0, Math.min(100, simulatedCpu))

      // Check memory limit
      if (simulatedMemory > sandbox.config.memoryLimitMB) {
        this.recordViolation(sandboxId, {
          type: 'memory_exceeded',
          details: `Memory ${simulatedMemory.toFixed(0)}MB exceeds limit ${sandbox.config.memoryLimitMB}MB`,
          action: 'throttled',
        })
      }

      // Check CPU limit
      if (simulatedCpu > sandbox.config.cpuLimitPercent) {
        this.recordViolation(sandboxId, {
          type: 'cpu_exceeded',
          details: `CPU ${simulatedCpu.toFixed(0)}% exceeds limit ${sandbox.config.cpuLimitPercent}%`,
          action: 'throttled',
        })
      }
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalSandboxes: number
    runningSandboxes: number
    totalViolations: number
    byStatus: Record<string, number>
  } {
    const byStatus: Record<string, number> = {}
    let running = 0
    let violations = 0

    for (const sandbox of this.sandboxes.values()) {
      byStatus[sandbox.status] = (byStatus[sandbox.status] || 0) + 1
      if (sandbox.status === 'running') running++
      violations += sandbox.violations.length
    }

    return {
      totalSandboxes: this.sandboxes.size,
      runningSandboxes: running,
      totalViolations: violations,
      byStatus,
    }
  }

  /**
   * Subscribe to events
   */
  on(event: SandboxEvent, callback: SandboxCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: SandboxEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Sandbox callback error', error as Error)
      }
    })
  }
}

/**
 * Network Isolation Manager
 */
export class NetworkIsolation {
  private isolatedNetworks: Map<string, Set<string>> = new Map() // networkId -> nodeIds
  private firewallRules: Map<string, Array<{ from: string; to: string; port: number; allowed: boolean }>> = new Map()

  /**
   * Create isolated network
   */
  createIsolatedNetwork(networkId: string, nodeIds: string[]): void {
    this.isolatedNetworks.set(networkId, new Set(nodeIds))
    logger.info('Isolated network created', { networkId, nodes: nodeIds.length })
  }

  /**
   * Add firewall rule
   */
  addFirewallRule(networkId: string, rule: { from: string; to: string; port: number; allowed: boolean }): void {
    if (!this.firewallRules.has(networkId)) {
      this.firewallRules.set(networkId, [])
    }
    this.firewallRules.get(networkId)!.push(rule)
  }

  /**
   * Check if connection is allowed
   */
  isConnectionAllowed(networkId: string, from: string, to: string, port: number): boolean {
    const network = this.isolatedNetworks.get(networkId)
    if (!network) return true // No isolation

    // Check if both nodes are in the network
    if (!network.has(from) || !network.has(to)) {
      return false
    }

    // Check firewall rules
    const rules = this.firewallRules.get(networkId) || []
    for (const rule of rules) {
      if (rule.from === from && rule.to === to && rule.port === port) {
        return rule.allowed
      }
    }

    return true // Default allow within network
  }
}

/**
 * Create sandbox manager
 */
export function createSandboxManager(): SandboxManager {
  return new SandboxManager()
}

// Default instance
export const sandboxManager = new SandboxManager()
export const networkIsolation = new NetworkIsolation()
