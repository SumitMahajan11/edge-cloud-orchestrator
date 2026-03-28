/**
 * Production API Endpoints for Edge-Cloud Orchestrator
 * Handles node registration, metrics, and cluster management
 */

import { logger } from '../logger'
import { nodeRegistry, discoveryService } from '../discovery/nodeRegistry'
import { metricsExporter } from '../metrics/exporter'
import { geoRouter } from '../routing/geoRouter'
import { leaderElection } from '../cluster/leaderElection'
import { agentAuthManager } from '../auth/AgentAuth'
import type { EdgeNode, Task } from '../../types'

// Types
export interface APIRequest {
  method: string
  path: string
  headers: Record<string, string>
  body?: unknown
  query: Record<string, string>
}

export interface APIResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

export interface RouteHandler {
  (req: APIRequest): Promise<APIResponse>
}

export interface APIConfig {
  requireAuth: boolean
  corsOrigins: string[]
  rateLimit: number
}

const DEFAULT_CONFIG: APIConfig = {
  requireAuth: true,
  corsOrigins: ['*'],
  rateLimit: 100,
}

/**
 * API Router
 */
export class APIRouter {
  private routes: Map<string, Map<string, RouteHandler>> = new Map()
  // @ts-expect-error - Config used for future features
  private config: APIConfig
  private middleware: Array<(req: APIRequest) => Promise<APIRequest | null>> = []

  constructor(config: Partial<APIConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.setupDefaultRoutes()
  }

  /**
   * Setup default routes
   */
  private setupDefaultRoutes(): void {
    // Health check
    this.get('/health', this.healthCheck.bind(this))
    
    // Node registration
    this.post('/nodes/register', this.registerNode.bind(this))
    this.post('/nodes/heartbeat', this.nodeHeartbeat.bind(this))
    this.delete('/nodes/:nodeId', this.deregisterNode.bind(this))
    this.get('/nodes', this.getNodes.bind(this))
    this.get('/nodes/:nodeId', this.getNode.bind(this))
    
    // Metrics
    this.get('/metrics', this.getMetrics.bind(this))
    this.get('/metrics/json', this.getMetricsJSON.bind(this))
    
    // Cluster
    this.get('/cluster/status', this.getClusterStatus.bind(this))
    this.get('/cluster/leader', this.getLeader.bind(this))
    
    // Geo-routing
    this.post('/routing/select', this.selectNode.bind(this))
    this.get('/routing/nearby', this.getNearbyNodes.bind(this))
    
    // Auth
    this.post('/auth/api-key', this.generateApiKey.bind(this))
    this.post('/auth/jwt', this.generateJWT.bind(this))
  }

  /**
   * Register route
   */
  private register(method: string, path: string, handler: RouteHandler): void {
    if (!this.routes.has(path)) {
      this.routes.set(path, new Map())
    }
    this.routes.get(path)!.set(method.toUpperCase(), handler)
  }

  get(path: string, handler: RouteHandler): void {
    this.register('GET', path, handler)
  }

  post(path: string, handler: RouteHandler): void {
    this.register('POST', path, handler)
  }

  put(path: string, handler: RouteHandler): void {
    this.register('PUT', path, handler)
  }

  delete(path: string, handler: RouteHandler): void {
    this.register('DELETE', path, handler)
  }

  /**
   * Add middleware
   */
  use(middleware: (req: APIRequest) => Promise<APIRequest | null>): void {
    this.middleware.push(middleware)
  }

  /**
   * Handle request
   */
  async handle(req: APIRequest): Promise<APIResponse> {
    try {
      // Run middleware
      for (const mw of this.middleware) {
        const result = await mw(req)
        if (result === null) {
          return this.error(401, 'Unauthorized')
        }
        req = result
      }

      // Find route
      const pathRoutes = this.routes.get(req.path)
      if (!pathRoutes) {
        // Try pattern matching
        const matchedRoute = this.matchRoute(req.path, req.method)
        if (matchedRoute) {
          return await matchedRoute.handler(req)
        }
        return this.error(404, 'Not Found')
      }

      const handler = pathRoutes.get(req.method)
      if (!handler) {
        return this.error(405, 'Method Not Allowed')
      }

      return await handler(req)
    } catch (error) {
      logger.error('API error', error as Error, { path: req.path, method: req.method })
      return this.error(500, 'Internal Server Error')
    }
  }

  /**
   * Match route with parameters
   */
  private matchRoute(path: string, method: string): { handler: RouteHandler; params: Record<string, string> } | null {
    for (const [routePath, methods] of this.routes) {
      const params = this.matchPath(routePath, path)
      if (params !== null && methods.has(method)) {
        return {
          handler: methods.get(method)!,
          params,
        }
      }
    }
    return null
  }

  /**
   * Match path pattern
   */
  private matchPath(pattern: string, path: string): Record<string, string> | null {
    const patternParts = pattern.split('/')
    const pathParts = path.split('/')
    
    if (patternParts.length !== pathParts.length) return null
    
    const params: Record<string, string> = {}
    
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i]
      } else if (patternParts[i] !== pathParts[i]) {
        return null
      }
    }
    
    return params
  }

  /**
   * Response helpers
   */
  private json(status: number, body: unknown): APIResponse {
    return {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body,
    }
  }

  private error(status: number, message: string): APIResponse {
    return this.json(status, { error: message })
  }

  // Route handlers

  private async healthCheck(): Promise<APIResponse> {
    return this.json(200, {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    })
  }

  private async registerNode(req: APIRequest): Promise<APIResponse> {
    const body = req.body as {
      nodeId: string
      ip: string
      location: string
      region: string
      cpuCores: number
      memory: number
      storage: number
      dockerVersion: string
      capabilities?: string[]
      tags?: Record<string, string>
      latitude?: number
      longitude?: number
    }

    if (!body.nodeId || !body.ip) {
      return this.error(400, 'Missing required fields: nodeId, ip')
    }

    try {
      const result = await discoveryService.handleRegistration(body)
      
      if (result.success && result.node) {
        // Register geo info if provided
        if (body.latitude !== undefined && body.longitude !== undefined) {
          geoRouter.registerNode(body.nodeId, {
            nodeId: body.nodeId,
            location: { latitude: body.latitude, longitude: body.longitude },
            region: body.region,
            zone: body.region, // Use region as zone
            networkLatency: 0,
          })
        }
        
        return this.json(201, result.node)
      }
      
      return this.error(400, result.error || 'Registration failed')
    } catch (error) {
      return this.error(500, (error as Error).message)
    }
  }

  private async nodeHeartbeat(req: APIRequest): Promise<APIResponse> {
    const body = req.body as {
      nodeId: string
      cpu: number
      memory: number
      storage: number
      tasksRunning: number
      latency: number
    }

    if (!body.nodeId) {
      return this.error(400, 'Missing required field: nodeId')
    }

    const result = await discoveryService.handleHeartbeat({
      ...body,
      timestamp: Date.now(),
    })

    if (result.success) {
      return this.json(200, { acknowledged: true })
    }
    
    return this.error(400, result.error || 'Heartbeat failed')
  }

  private async deregisterNode(req: APIRequest): Promise<APIResponse> {
    const params = req.query as { nodeId: string }
    const nodeId = params.nodeId
    
    if (!nodeId) {
      return this.error(400, 'Missing nodeId')
    }

    const result = await discoveryService.handleDeregistration(nodeId)
    
    if (result.success) {
      return this.json(200, { deregistered: true })
    }
    
    return this.error(400, result.error || 'Deregistration failed')
  }

  private async getNodes(): Promise<APIResponse> {
    const nodes = nodeRegistry.getAllNodes()
    return this.json(200, { nodes, count: nodes.length })
  }

  private async getNode(req: APIRequest): Promise<APIResponse> {
    const params = req.query as { nodeId: string }
    const node = nodeRegistry.getNode(params.nodeId)
    
    if (!node) {
      return this.error(404, 'Node not found')
    }
    
    return this.json(200, node)
  }

  private async getMetrics(): Promise<APIResponse> {
    const { contentType, body } = metricsExporter.getPrometheusMetrics()
    return {
      status: 200,
      headers: {
        'Content-Type': contentType,
      },
      body,
    }
  }

  private async getMetricsJSON(): Promise<APIResponse> {
    const { body } = metricsExporter.getJSONMetrics()
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.parse(body),
    }
  }

  private async getClusterStatus(): Promise<APIResponse> {
    const nodeStats = nodeRegistry.getStats()
    const leaderState = leaderElection.getState()
    
    return this.json(200, {
      nodes: nodeStats,
      leadership: {
        isLeader: leaderState.isLeader,
        leaderId: leaderState.leaderId,
        term: leaderState.term,
      },
    })
  }

  private async getLeader(): Promise<APIResponse> {
    const state = leaderElection.getState()
    return this.json(200, {
      leaderId: state.leaderId,
      isLeader: state.isLeader,
      term: state.term,
    })
  }

  private async selectNode(req: APIRequest): Promise<APIResponse> {
    const body = req.body as {
      task: Task
      nodes: EdgeNode[]
      userLatitude?: number
      userLongitude?: number
    }

    if (!body.task || !body.nodes) {
      return this.error(400, 'Missing required fields: task, nodes')
    }

    const userLocation = body.userLatitude !== undefined && body.userLongitude !== undefined
      ? { latitude: body.userLatitude, longitude: body.userLongitude }
      : undefined

    const result = geoRouter.selectNode(body.task, body.nodes, userLocation)
    
    return this.json(200, result)
  }

  private async getNearbyNodes(req: APIRequest): Promise<APIResponse> {
    const query = req.query as {
      latitude: string
      longitude: string
      radiusKm: string
    }

    const latitude = parseFloat(query.latitude)
    const longitude = parseFloat(query.longitude)
    const radiusKm = parseFloat(query.radiusKm) || 100

    if (isNaN(latitude) || isNaN(longitude)) {
      return this.error(400, 'Invalid latitude or longitude')
    }

    const nodes = nodeRegistry.getAllNodes().map(r => nodeRegistry.toEdgeNode(r))
    const nearby = geoRouter.getNodesWithinRadius(nodes, { latitude, longitude }, radiusKm)
    
    return this.json(200, { nodes: nearby, count: nearby.length })
  }

  private async generateApiKey(req: APIRequest): Promise<APIResponse> {
    const body = req.body as {
      agentId: string
      permissions?: string[]
    }

    if (!body.agentId) {
      return this.error(400, 'Missing required field: agentId')
    }

    const result = agentAuthManager.generateApiKey(body.agentId, body.permissions)
    
    return this.json(201, {
      id: result.id,
      key: result.key,
      message: 'Store this key securely. It will not be shown again.',
    })
  }

  private async generateJWT(req: APIRequest): Promise<APIResponse> {
    const body = req.body as {
      agentId: string
      nodeId: string
      location: string
      permissions?: string[]
    }

    if (!body.agentId || !body.nodeId) {
      return this.error(400, 'Missing required fields: agentId, nodeId')
    }

    const result = await agentAuthManager.generateJWT(
      body.agentId,
      body.nodeId,
      body.location || 'unknown',
      body.permissions || ['task:execute', 'metrics:report']
    )
    
    return this.json(201, {
      token: result.token,
      expiresAt: new Date(result.expiresAt).toISOString(),
    })
  }
}

/**
 * Authentication Middleware
 */
export async function authMiddleware(req: APIRequest): Promise<APIRequest | null> {
  // Skip auth for health endpoint
  if (req.path === '/health') {
    return req
  }

  const authHeader = req.headers['authorization'] || req.headers['Authorization']
  
  if (!authHeader) {
    return null
  }

  const result = await agentAuthManager.authenticate(req.headers, JSON.stringify(req.body))
  
  if (!result.authenticated) {
    return null
  }

  // Attach auth info to request
  return {
    ...req,
    headers: {
      ...req.headers,
      'x-auth-agent-id': result.agentId || '',
      'x-auth-permissions': (result.permissions || []).join(','),
    },
  }
}

/**
 * CORS Middleware
 */
export function corsMiddleware(_origins: string[] = ['*']): (req: APIRequest) => Promise<APIRequest> {
  return async (req: APIRequest) => {
    // Just pass through - CORS headers are added in response
    return req
  }
}

/**
 * Rate Limiter
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map()
  private limit: number
  private windowMs: number

  constructor(limit: number = 100, windowMs: number = 60000) {
    this.limit = limit
    this.windowMs = windowMs
  }

  async check(clientId: string): Promise<boolean> {
    const now = Date.now()
    const requests = this.requests.get(clientId) || []
    
    // Filter out old requests
    const validRequests = requests.filter(t => now - t < this.windowMs)
    
    if (validRequests.length >= this.limit) {
      return false
    }
    
    validRequests.push(now)
    this.requests.set(clientId, validRequests)
    
    return true
  }
}

// Factory functions
export function createAPIRouter(config: Partial<APIConfig> = {}): APIRouter {
  return new APIRouter(config)
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  return new RateLimiter(limit, windowMs)
}

// Default instance
export const apiRouter = new APIRouter()
