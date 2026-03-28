// Environment configuration
// When frontend is served from same origin as backend (production/static build),
// use relative URLs. Otherwise use the configured API URL.
function getApiBaseUrl(): string {
  // Check if we're in a browser environment
  if (typeof window !== 'undefined') {
    // If served from localhost:300x, use relative URLs (same origin)
    if (window.location.origin.includes('localhost:300')) {
      return ''
    }
  }
  return import.meta.env.VITE_API_URL || 'http://localhost:3006'
}

function getWsUrl(): string {
  if (typeof window !== 'undefined' && window.location.origin.includes('localhost:300')) {
    return '/ws'
  }
  return import.meta.env.VITE_WS_URL || 'ws://localhost:3006/ws'
}

export const config = {
  // Primary API gateway URL - use relative path when served from backend
  get apiBaseUrl() { return getApiBaseUrl() },
  // Direct service URLs for development
  services: {
    task: import.meta.env.VITE_TASK_SERVICE_URL || 'http://localhost:3001',
    node: import.meta.env.VITE_NODE_SERVICE_URL || 'http://localhost:3002',
    scheduler: import.meta.env.VITE_SCHEDULER_SERVICE_URL || 'http://localhost:3003',
    websocket: import.meta.env.VITE_WS_URL || 'ws://localhost:3004',
    backend: import.meta.env.VITE_BACKEND_URL || 'http://localhost:3006',
  },
  get wsUrl() { return getWsUrl() },
}

// API Response types
export interface ApiResponse<T> {
  data?: T
  error?: string
  message?: string
}

// Auth types
export interface User {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'admin' | 'operator' | 'viewer'
  createdAt: Date
  lastLoginAt?: Date
}

export interface LoginResponse {
  token: string
  refreshToken: string
  expiresAt: string
  user: User
}

export interface ApiKey {
  id: string
  name: string
  key?: string // Only returned on creation
  permissions: string[]
  expiresAt?: string
  createdAt: string
  lastUsedAt?: string
}

// Token management
const TOKEN_KEY = 'auth_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const USER_KEY = 'user_data'

export const authStorage = {
  getToken: (): string | null => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  getRefreshToken: (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY),
  setRefreshToken: (token: string) => localStorage.setItem(REFRESH_TOKEN_KEY, token),
  getUser: (): User | null => {
    const user = localStorage.getItem(USER_KEY)
    return user ? JSON.parse(user) : null
  },
  setUser: (user: User) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  },
}

// HTTP Client with auth
class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const token = authStorage.getToken()
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          // Try to refresh token
          const refreshed = await this.refreshToken()
          if (refreshed) {
            // Retry the request
            return this.request<T>(endpoint, options)
          } else {
            authStorage.clear()
            // Don't redirect - let ProtectedRoute handle it
          }
        }
        return { error: data.error || data.message || 'Request failed' }
      }

      return { data }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Network error' }
    }
  }

  private async refreshToken(): Promise<boolean> {
    const refreshToken = authStorage.getRefreshToken()
    if (!refreshToken) return false

    try {
      const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })

      if (!response.ok) return false

      const data = await response.json()
      authStorage.setToken(data.token)
      authStorage.setRefreshToken(data.refreshToken)
      return true
    } catch {
      return false
    }
  }

  // HTTP methods
  get<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'GET' })
  }

  post<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  patch<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  delete<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }
}

// Create a dynamic API client that reads config at request time
class DynamicApiClient {
  private getBaseUrl: () => string

  constructor(getBaseUrl: () => string) {
    this.getBaseUrl = getBaseUrl
  }

  private async requestDynamic<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const token = authStorage.getToken()
    const baseUrl = this.getBaseUrl()
    
    console.log('[API] Request:', options.method, endpoint, 'baseUrl:', baseUrl)
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`
    }

    try {
      const url = `${baseUrl}${endpoint}`
      console.log('[API] Fetching:', url)
      const response = await fetch(url, {
        ...options,
        headers,
      })
      console.log('[API] Response status:', response.status)

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          const refreshed = await this.refreshToken()
          if (refreshed) {
            return this.requestDynamic<T>(endpoint, options)
          } else {
            authStorage.clear()
          }
        }
        return { error: data.error || data.message || 'Request failed' }
      }

      return { data }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Network error' }
    }
  }

  private async refreshToken(): Promise<boolean> {
    const refreshToken = authStorage.getRefreshToken()
    if (!refreshToken) return false

    try {
      const baseUrl = this.getBaseUrl()
      const response = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })

      if (!response.ok) {
        return false
      }

      const data = await response.json()
      if (data.token) {
        authStorage.setToken(data.token)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  get<T>(endpoint: string) {
    return this.requestDynamic<T>(endpoint, { method: 'GET' })
  }

  post<T>(endpoint: string, body?: unknown) {
    return this.requestDynamic<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  patch<T>(endpoint: string, body?: unknown) {
    return this.requestDynamic<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  delete<T>(endpoint: string) {
    return this.requestDynamic<T>(endpoint, { method: 'DELETE' })
  }
}

export const apiClient = new DynamicApiClient(() => config.apiBaseUrl)

// Service-specific clients for direct access
export const taskServiceClient = new ApiClient(config.services.task)
export const nodeServiceClient = new ApiClient(config.services.node)
export const schedulerServiceClient = new ApiClient(config.services.scheduler)
export const backendClient = new ApiClient(config.services.backend)

// Auth API
export const authApi = {
  async login(email: string, password: string): Promise<ApiResponse<LoginResponse>> {
    console.log('[Auth] Login called with email:', email)
    const response = await apiClient.post<LoginResponse>('/api/auth/login', { email, password })
    console.log('[Auth] Login response:', response)
    if (response.data) {
      authStorage.setToken(response.data.token)
      authStorage.setRefreshToken(response.data.refreshToken)
      authStorage.setUser(response.data.user)
    }
    return response
  },

  async register(email: string, password: string, name: string): Promise<ApiResponse<User>> {
    return apiClient.post<User>('/api/auth/register', { email, password, name })
  },

  async logout(): Promise<void> {
    await apiClient.post('/api/auth/logout')
    authStorage.clear()
  },

  async getMe(): Promise<ApiResponse<User>> {
    return apiClient.get<User>('/api/auth/me')
  },

  async createApiKey(name: string, permissions: string[] = [], expiresAt?: string): Promise<ApiResponse<ApiKey>> {
    return apiClient.post<ApiKey>('/api/auth/api-keys', { name, permissions, expiresAt })
  },

  async getApiKeys(): Promise<ApiResponse<ApiKey[]>> {
    return apiClient.get<ApiKey[]>('/api/auth/api-keys')
  },

  async deleteApiKey(id: string): Promise<ApiResponse<void>> {
    return apiClient.delete<void>(`/api/auth/api-keys/${id}`)
  },
}

// Nodes API - connects to Node Service (port 3002)
export const nodesApi = {
  async list(params?: { region?: string; status?: string; page?: number; limit?: number }) {
    const query = new URLSearchParams()
    if (params?.region) query.set('region', params.region)
    if (params?.status) query.set('status', params.status)
    
    const queryString = query.toString()
    const response = await nodeServiceClient.get<any[]>(
      `/nodes${queryString ? `?${queryString}` : ''}`
    )
    // Transform to paginated response for compatibility
    if (response.data) {
      return { data: { data: response.data, pagination: { total: response.data.length, page: 1, limit: 100, totalPages: 1 } } }
    }
    return { error: response.error }
  },

  async get(id: string) {
    return nodeServiceClient.get<any>(`/nodes/${id}`)
  },

  async create(data: {
    name: string
    location: string
    region: string
    ipAddress: string
    port: number
    cpuCores: number
    memoryGB: number
    storageGB: number
    costPerHour?: number
    maxTasks?: number
    bandwidthInMbps?: number
    bandwidthOutMbps?: number
    capabilities?: string[]
    labels?: Record<string, string>
  }) {
    return nodeServiceClient.post<any>('/nodes', data)
  },

  async update(id: string, data: Partial<{
    name: string
    location: string
    region: string
    cpuCores: number
    memoryGB: number
    storageGB: number
    costPerHour: number
    maxTasks: number
    isMaintenanceMode: boolean
  }>) {
    return nodeServiceClient.patch<any>(`/nodes/${id}`, data)
  },

  async delete(id: string) {
    return nodeServiceClient.delete<void>(`/nodes/${id}`)
  },

  async heartbeat(id: string, metrics: {
    cpuUsage: number
    memoryUsage: number
    storageUsage: number
    latency: number
    tasksRunning: number
  }) {
    return nodeServiceClient.post<any>(`/nodes/${id}/heartbeat`, metrics)
  },

  async getHealthy() {
    return nodeServiceClient.get<any[]>('/internal/nodes/healthy')
  },

  async setMaintenance(id: string, enabled: boolean) {
    return nodeServiceClient.post<any>(`/nodes/${id}/maintenance`, { enabled })
  },

  async healthCheck() {
    return nodeServiceClient.get<{ status: string; service: string; timestamp: string }>(`/health`)
  },
}

// Tasks API - connects to Task Service (port 3001)
export const tasksApi = {
  async list(params?: {
    status?: string
    type?: string
    nodeId?: string
    priority?: string
    limit?: number
    offset?: number
  }) {
    const query = new URLSearchParams()
    if (params?.status) query.set('status', params.status)
    if (params?.limit) query.set('limit', params.limit.toString())
    if (params?.offset) query.set('offset', params.offset.toString())
    
    const queryString = query.toString()
    const response = await taskServiceClient.get<{ tasks: any[]; total: number }>(
      `/tasks${queryString ? `?${queryString}` : ''}`
    )
    // Transform to paginated response for compatibility
    if (response.data) {
      return { data: { data: response.data.tasks, pagination: { total: response.data.total, page: 1, limit: params?.limit || 20, totalPages: Math.ceil(response.data.total / (params?.limit || 20)) } } }
    }
    return { error: response.error }
  },

  async get(id: string) {
    return taskServiceClient.get<any>(`/tasks/${id}`)
  },

  async create(data: {
    name: string
    type: string
    priority?: string
    target?: string
    nodeId?: string
    input?: Record<string, unknown>
    metadata?: Record<string, unknown>
    maxRetries?: number
  }) {
    return taskServiceClient.post<any>('/tasks', data)
  },

  async cancel(id: string, reason?: string) {
    return taskServiceClient.post<any>(`/tasks/${id}/cancel`, { reason: reason || 'Cancelled by user' })
  },

  async retry(id: string) {
    // Retry is handled by resubmitting with same parameters
    // Get the original task and resubmit
    const taskRes = await taskServiceClient.get<any>(`/tasks/${id}`)
    if (taskRes.error || !taskRes.data) {
      return { error: taskRes.error || 'Task not found' }
    }
    const originalTask = taskRes.data
    return taskServiceClient.post<any>('/tasks', {
      name: `${originalTask.name}-retry`,
      type: originalTask.type,
      priority: originalTask.priority,
      input: originalTask.input,
      metadata: { ...originalTask.metadata, retryOf: id },
    })
  },

  async getStats() {
    return taskServiceClient.get<any>('/tasks/stats')
  },

  async healthCheck() {
    return taskServiceClient.get<{ status: string; service: string; timestamp: string }>(`/health`)
  },
}

// Metrics API
export const metricsApi = {
  async getSystem() {
    // Aggregate metrics from all services
    const [taskStats, nodesRes] = await Promise.all([
      tasksApi.getStats(),
      nodesApi.list(),
    ])
    
    const stats = taskStats.data || {}
    const nodes = nodesRes.data?.data || []
    
    return {
      data: {
        totalNodes: nodes.length,
        onlineNodes: nodes.filter((n: any) => n.status === 'ONLINE').length,
        offlineNodes: nodes.filter((n: any) => n.status === 'OFFLINE').length,
        degradedNodes: nodes.filter((n: any) => n.status === 'DEGRADED').length,
        totalTasks: stats.total || 0,
        runningTasks: stats.running || 0,
        pendingTasks: stats.pending || 0,
        completedTasks: stats.completed || 0,
        failedTasks: stats.failed || 0,
        avgLatency: nodes.reduce((sum: number, n: any) => sum + (n.latency || 0), 0) / (nodes.length || 1),
        totalCost: nodes.reduce((sum: number, n: any) => sum + (n.costPerHour || 0), 0),
        edgeUtilization: nodes.reduce((sum: number, n: any) => sum + (n.cpuUsage || 0), 0) / (nodes.length || 1),
        cloudUtilization: 0,
        throughput: stats.completed || 0,
        cpuHistory: [],
        taskDistribution: { edge: stats.running || 0, cloud: 0 },
        healthScore: 100,
        completionRate: stats.total ? (stats.completed / stats.total) * 100 : 0,
        costOverTime: [],
      }
    }
  },

  async getRequests() {
    return backendClient.get<any>('/api/metrics/requests')
  },

  async getNodes() {
    return backendClient.get<any>('/api/metrics/nodes')
  },
}

// Scheduler API - connects to Scheduler Service (port 3003)
export const schedulerApi = {
  async getStatus() {
    return schedulerServiceClient.get<any>('/health')
  },

  async getMetrics() {
    return schedulerServiceClient.get<any>('/metrics')
  },

  async triggerSchedule(taskId: string) {
    return schedulerServiceClient.post<any>(`/schedule/${taskId}`)
  },

  async healthCheck() {
    return schedulerServiceClient.get<{ status: string; service: string; isLeader: boolean; raftState: string }>(`/health`)
  },
}

// Webhooks API
export const webhooksApi = {
  async list() {
    return apiClient.get<any[]>('/api/webhooks')
  },

  async create(data: { name: string; url: string; events: string[]; secret?: string; enabled?: boolean }) {
    return apiClient.post<any>('/api/webhooks', data)
  },

  async update(id: string, data: Partial<{ name: string; url: string; events: string[]; secret: string; enabled: boolean }>) {
    return apiClient.patch<any>(`/api/webhooks/${id}`, data)
  },

  async delete(id: string) {
    return apiClient.delete<void>(`/api/webhooks/${id}`)
  },

  async getDeliveries(id: string, limit?: number) {
    const query = limit ? `?limit=${limit}` : ''
    return apiClient.get<any[]>(`/api/webhooks/${id}/deliveries${query}`)
  },
}

// Workflows API
export const workflowsApi = {
  async list() {
    return apiClient.get<any[]>('/api/workflows')
  },

  async get(id: string) {
    return apiClient.get<any>(`/api/workflows/${id}`)
  },

  async create(data: any) {
    return apiClient.post<any>('/api/workflows', data)
  },

  async execute(id: string, input?: Record<string, unknown>) {
    return apiClient.post<any>(`/api/workflows/${id}/execute`, { input })
  },

  async getExecution(executionId: string) {
    return apiClient.get<any>(`/api/workflows/executions/${executionId}`)
  },
}

// Cost API
export const costApi = {
  async getSummary() {
    return apiClient.get<any>('/api/cost/summary')
  },

  async getRecords(params?: { nodeId?: string; resourceType?: string; from?: string; to?: string }) {
    const query = new URLSearchParams()
    if (params?.nodeId) query.set('nodeId', params.nodeId)
    if (params?.resourceType) query.set('resourceType', params.resourceType)
    if (params?.from) query.set('from', params.from)
    if (params?.to) query.set('to', params.to)
    
    const queryString = query.toString()
    return apiClient.get<any[]>(`/api/cost/records${queryString ? `?${queryString}` : ''}`)
  },

  async getByNode() {
    return apiClient.get<any[]>('/api/cost/by-node')
  },

  async getProjections() {
    return apiClient.get<any>('/api/cost/projections')
  },
}

// Carbon API
export const carbonApi = {
  async getSummary() {
    return apiClient.get<any>('/api/carbon/summary')
  },

  async getMetrics(params?: { region?: string; from?: string; to?: string }) {
    const query = new URLSearchParams()
    if (params?.region) query.set('region', params.region)
    if (params?.from) query.set('from', params.from)
    if (params?.to) query.set('to', params.to)
    
    const queryString = query.toString()
    return apiClient.get<any[]>(`/api/carbon/metrics${queryString ? `?${queryString}` : ''}`)
  },

  async getByRegion() {
    return apiClient.get<any[]>('/api/carbon/by-region')
  },
}

// Admin API
export const adminApi = {
  async getAuditLogs(params?: { userId?: string; action?: string; limit?: number }) {
    const query = new URLSearchParams()
    if (params?.userId) query.set('userId', params.userId)
    if (params?.action) query.set('action', params.action)
    if (params?.limit) query.set('limit', params.limit.toString())
    
    const queryString = query.toString()
    return apiClient.get<any[]>(`/api/admin/audit-logs${queryString ? `?${queryString}` : ''}`)
  },

  async getUsers() {
    return apiClient.get<any[]>('/api/admin/users')
  },

  async updateUserRole(id: string, role: string) {
    return apiClient.patch<any>(`/api/admin/users/${id}/role`, { role })
  },

  async deactivateUser(id: string) {
    return apiClient.post<any>(`/api/admin/users/${id}/deactivate`)
  },

  async getHealth() {
    return apiClient.get<any>('/api/admin/health')
  },

  async cleanup(data: { olderThanDays: number; types: string[] }) {
    return apiClient.post<any>('/api/admin/cleanup', data)
  },
}
