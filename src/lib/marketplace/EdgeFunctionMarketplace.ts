/**
 * Edge Function Marketplace
 * Deploy and manage serverless functions at edge nodes
 */

import { logger } from '../logger'
import type { EdgeNode } from '../../types'

// Types
export interface EdgeFunction {
  id: string
  name: string
  description: string
  version: string
  runtime: 'nodejs18' | 'nodejs20' | 'python39' | 'python311' | 'wasm'
  handler: string
  code: string
  dependencies: Record<string, string>
  envVars: Record<string, string>
  memoryMB: number
  timeoutMs: number
  coldStartMs: number
  maxInstances: number
  triggers: FunctionTrigger[]
  author: string
  category: string
  tags: string[]
  downloads: number
  rating: number
  price: number // $ per 1000 invocations, 0 = free
  createdAt: number
  updatedAt: number
}

export interface FunctionTrigger {
  type: 'http' | 'schedule' | 'event' | 'queue'
  config: Record<string, unknown>
}

export interface FunctionDeployment {
  id: string
  functionId: string
  nodeId: string
  status: 'deploying' | 'active' | 'inactive' | 'failed'
  version: string
  deployedAt: number
  lastInvokedAt?: number
  invocationCount: number
  errorCount: number
  avgLatencyMs: number
  coldStartCount: number
}

export interface FunctionInvocation {
  id: string
  functionId: string
  nodeId: string
  triggeredBy: string
  input: unknown
  output?: unknown
  status: 'pending' | 'running' | 'success' | 'failed' | 'timeout'
  startedAt: number
  completedAt?: number
  durationMs: number
  memoryUsedMB: number
  coldStart: boolean
  error?: string
}

export interface MarketplaceListing {
  function: EdgeFunction
  featured: boolean
  verified: boolean
  reviews: FunctionReview[]
}

export interface FunctionReview {
  id: string
  functionId: string
  userId: string
  rating: number
  comment: string
  createdAt: number
}

export interface MarketplaceConfig {
  maxFunctionsPerNode: number
  defaultMemoryMB: number
  defaultTimeoutMs: number
  maxCodeSizeKB: number
  retentionDays: number
}

type MarketplaceEvent = 'function.published' | 'function.deployed' | 'function.invoked' | 'function.failed'
type MarketplaceCallback = (event: MarketplaceEvent, data: unknown) => void

const DEFAULT_CONFIG: MarketplaceConfig = {
  maxFunctionsPerNode: 50,
  defaultMemoryMB: 256,
  defaultTimeoutMs: 30000,
  maxCodeSizeKB: 5000,
  retentionDays: 30,
}

/**
 * Edge Function Marketplace
 */
export class EdgeFunctionMarketplace {
  // @ts-expect-error - Config used for future features
  private config: MarketplaceConfig
  private functions: Map<string, EdgeFunction> = new Map()
  private deployments: Map<string, FunctionDeployment> = new Map()
  private invocations: Map<string, FunctionInvocation> = new Map()
  private listings: Map<string, MarketplaceListing> = new Map()
  private callbacks: Map<MarketplaceEvent, Set<MarketplaceCallback>> = new Map()
  private nodeProvider: (() => EdgeNode[]) | null = null

  constructor(config: Partial<MarketplaceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.seedMarketplace()
  }

  /**
   * Set node provider
   */
  setNodeProvider(provider: () => EdgeNode[]): void {
    this.nodeProvider = provider
  }

  /**
   * Seed marketplace with sample functions
   */
  private seedMarketplace(): void {
    const sampleFunctions: Array<Omit<EdgeFunction, 'id' | 'createdAt' | 'updatedAt' | 'downloads' | 'rating'>> = [
      {
        name: 'image-resizer',
        description: 'Resize images to specified dimensions',
        version: '1.0.0',
        runtime: 'nodejs20',
        handler: 'index.handler',
        code: 'exports.handler = async (event) => { /* resize logic */ }',
        dependencies: { 'sharp': '^0.32.0' },
        envVars: {},
        memoryMB: 512,
        timeoutMs: 30000,
        coldStartMs: 150,
        maxInstances: 100,
        triggers: [{ type: 'http', config: { path: '/resize', method: 'POST' } }],
        author: 'edge-team',
        category: 'image-processing',
        tags: ['image', 'resize', 'media'],
        price: 0.001,
      },
      {
        name: 'sentiment-analyzer',
        description: 'Analyze text sentiment using ML',
        version: '1.2.0',
        runtime: 'python311',
        handler: 'handler.analyze',
        code: 'def analyze(event): return {"sentiment": "positive"}',
        dependencies: { 'transformers': '^4.30.0' },
        envVars: {},
        memoryMB: 1024,
        timeoutMs: 60000,
        coldStartMs: 500,
        maxInstances: 50,
        triggers: [{ type: 'http', config: { path: '/sentiment', method: 'POST' } }],
        author: 'ml-team',
        category: 'machine-learning',
        tags: ['nlp', 'sentiment', 'ai'],
        price: 0.005,
      },
      {
        name: 'geo-enrichment',
        description: 'Enrich data with geographic information',
        version: '2.0.0',
        runtime: 'nodejs20',
        handler: 'index.enrich',
        code: 'exports.enrich = async (event) => { /* geo lookup */ }',
        dependencies: {},
        envVars: {},
        memoryMB: 256,
        timeoutMs: 10000,
        coldStartMs: 80,
        maxInstances: 200,
        triggers: [{ type: 'event', config: { topic: 'data.received' } }],
        author: 'data-team',
        category: 'data-processing',
        tags: ['geo', 'location', 'enrichment'],
        price: 0,
      },
    ]

    for (const fn of sampleFunctions) {
      const id = `fn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const now = Date.now()
      
      const edgeFn: EdgeFunction = {
        ...fn,
        id,
        createdAt: now,
        updatedAt: now,
        downloads: Math.floor(Math.random() * 1000),
        rating: 3.5 + Math.random() * 1.5,
      }

      this.functions.set(id, edgeFn)
      this.listings.set(id, {
        function: edgeFn,
        featured: Math.random() > 0.7,
        verified: Math.random() > 0.5,
        reviews: [],
      })
    }
  }

  /**
   * Publish a function to marketplace
   */
  publishFunction(fn: Omit<EdgeFunction, 'id' | 'createdAt' | 'updatedAt' | 'downloads' | 'rating'>): EdgeFunction {
    const id = `fn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    const edgeFn: EdgeFunction = {
      ...fn,
      id,
      createdAt: now,
      updatedAt: now,
      downloads: 0,
      rating: 0,
    }

    this.functions.set(id, edgeFn)
    this.listings.set(id, {
      function: edgeFn,
      featured: false,
      verified: false,
      reviews: [],
    })

    this.emit('function.published', edgeFn)
    logger.info('Function published', { functionId: id, name: fn.name })

    return edgeFn
  }

  /**
   * Deploy function to edge nodes
   */
  async deployFunction(functionId: string, nodeIds?: string[]): Promise<FunctionDeployment[]> {
    const fn = this.functions.get(functionId)
    if (!fn) {
      throw new Error(`Function ${functionId} not found`)
    }

    const nodes = nodeIds || (this.nodeProvider ? this.nodeProvider().filter(n => n.status === 'online').map(n => n.id) : [])
    
    if (nodes.length === 0) {
      throw new Error('No nodes available for deployment')
    }

    const deployments: FunctionDeployment[] = []

    for (const nodeId of nodes) {
      const deploymentId = `deploy-${functionId}-${nodeId}`

      // Check if already deployed
      const existing = this.deployments.get(deploymentId)
      if (existing && existing.status === 'active') {
        deployments.push(existing)
        continue
      }

      const deployment: FunctionDeployment = {
        id: deploymentId,
        functionId,
        nodeId,
        status: 'deploying',
        version: fn.version,
        deployedAt: Date.now(),
        invocationCount: 0,
        errorCount: 0,
        avgLatencyMs: 0,
        coldStartCount: 0,
      }

      this.deployments.set(deploymentId, deployment)

      // Simulate deployment
      await new Promise(resolve => setTimeout(resolve, 100))

      deployment.status = 'active'
      this.emit('function.deployed', { functionId, nodeId })
      deployments.push(deployment)
    }

    fn.downloads += nodes.length
    logger.info('Function deployed', { functionId, nodes: nodes.length })

    return deployments
  }

  /**
   * Invoke a function
   */
  async invokeFunction(
    functionId: string,
    input: unknown,
    nodeId?: string
  ): Promise<FunctionInvocation> {
    const fn = this.functions.get(functionId)
    if (!fn) {
      throw new Error(`Function ${functionId} not found`)
    }

    // Find deployment
    const targetNodeId = nodeId || this.findBestNode(functionId)
    if (!targetNodeId) {
      throw new Error('No available deployment for function')
    }

    const deploymentId = `deploy-${functionId}-${targetNodeId}`
    const deployment = this.deployments.get(deploymentId)
    if (!deployment || deployment.status !== 'active') {
      throw new Error('Function not deployed to node')
    }

    const invocationId = `invoke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const coldStart = Date.now() - (deployment.lastInvokedAt || deployment.deployedAt) > 60000

    const invocation: FunctionInvocation = {
      id: invocationId,
      functionId,
      nodeId: targetNodeId,
      triggeredBy: 'api',
      input,
      status: 'running',
      startedAt: Date.now(),
      durationMs: 0,
      memoryUsedMB: 0,
      coldStart,
    }

    this.invocations.set(invocationId, invocation)
    this.emit('function.invoked', { functionId, nodeId: targetNodeId, coldStart })

    // Simulate execution
    try {
      const startMs = Date.now()
      await new Promise(resolve => setTimeout(resolve, coldStart ? fn.coldStartMs : 10 + Math.random() * 50))
      
      invocation.status = 'success'
      invocation.output = { result: 'success', data: input }
      invocation.durationMs = Date.now() - startMs
      invocation.memoryUsedMB = fn.memoryMB * (0.3 + Math.random() * 0.5)
      invocation.completedAt = Date.now()

      // Update deployment stats
      deployment.invocationCount++
      deployment.lastInvokedAt = Date.now()
      deployment.avgLatencyMs = (deployment.avgLatencyMs * 0.9) + (invocation.durationMs * 0.1)
      if (coldStart) deployment.coldStartCount++

    } catch (error) {
      invocation.status = 'failed'
      invocation.error = (error as Error).message
      invocation.completedAt = Date.now()
      invocation.durationMs = Date.now() - invocation.startedAt

      deployment.errorCount++
      this.emit('function.failed', { functionId, nodeId: targetNodeId, error: invocation.error })
    }

    return invocation
  }

  /**
   * Find best node for function
   */
  private findBestNode(functionId: string): string | null {
    const deployments = Array.from(this.deployments.values())
      .filter(d => d.functionId === functionId && d.status === 'active')

    if (deployments.length === 0) return null

    // Sort by latency and load
    deployments.sort((a, b) => {
      const scoreA = a.avgLatencyMs - (a.errorCount * 100)
      const scoreB = b.avgLatencyMs - (b.errorCount * 100)
      return scoreA - scoreB
    })

    return deployments[0].nodeId
  }

  /**
   * Undeploy function from node
   */
  undeployFunction(functionId: string, nodeId: string): boolean {
    const deploymentId = `deploy-${functionId}-${nodeId}`
    const deployment = this.deployments.get(deploymentId)
    
    if (!deployment) return false

    deployment.status = 'inactive'
    return true
  }

  /**
   * Browse marketplace
   */
  browseMarketplace(category?: string, search?: string): MarketplaceListing[] {
    let listings = Array.from(this.listings.values())

    if (category) {
      listings = listings.filter(l => l.function.category === category)
    }

    if (search) {
      const searchLower = search.toLowerCase()
      listings = listings.filter(l => 
        l.function.name.toLowerCase().includes(searchLower) ||
        l.function.description.toLowerCase().includes(searchLower) ||
        l.function.tags.some(t => t.toLowerCase().includes(searchLower))
      )
    }

    // Sort by featured, then rating, then downloads
    listings.sort((a, b) => {
      if (a.featured !== b.featured) return b.featured ? 1 : -1
      if (b.function.rating !== a.function.rating) return b.function.rating - a.function.rating
      return b.function.downloads - a.function.downloads
    })

    return listings
  }

  /**
   * Get function details
   */
  getFunction(functionId: string): EdgeFunction | undefined {
    return this.functions.get(functionId)
  }

  /**
   * Get deployment status
   */
  getDeployment(functionId: string, nodeId: string): FunctionDeployment | undefined {
    return this.deployments.get(`deploy-${functionId}-${nodeId}`)
  }

  /**
   * Get invocation history
   */
  getInvocationHistory(functionId: string, limit: number = 100): FunctionInvocation[] {
    return Array.from(this.invocations.values())
      .filter(i => i.functionId === functionId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalFunctions: number
    totalDeployments: number
    totalInvocations: number
    avgLatencyMs: number
    errorRate: number
    categories: Record<string, number>
  } {
    let totalInvocations = 0
    let totalErrors = 0
    let totalLatency = 0
    let latencyCount = 0
    const categories: Record<string, number> = {}

    for (const fn of this.functions.values()) {
      categories[fn.category] = (categories[fn.category] || 0) + 1
    }

    for (const invocation of this.invocations.values()) {
      totalInvocations++
      if (invocation.status === 'failed') totalErrors++
      if (invocation.durationMs > 0) {
        totalLatency += invocation.durationMs
        latencyCount++
      }
    }

    return {
      totalFunctions: this.functions.size,
      totalDeployments: Array.from(this.deployments.values()).filter(d => d.status === 'active').length,
      totalInvocations,
      avgLatencyMs: latencyCount > 0 ? totalLatency / latencyCount : 0,
      errorRate: totalInvocations > 0 ? (totalErrors / totalInvocations) * 100 : 0,
      categories,
    }
  }

  /**
   * Subscribe to events
   */
  on(event: MarketplaceEvent, callback: MarketplaceCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: MarketplaceEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Marketplace callback error', error as Error)
      }
    })
  }
}

/**
 * Create marketplace
 */
export function createEdgeFunctionMarketplace(config: Partial<MarketplaceConfig> = {}): EdgeFunctionMarketplace {
  return new EdgeFunctionMarketplace(config)
}

// Default instance
export const edgeFunctionMarketplace = new EdgeFunctionMarketplace()
