// Simple API client that always uses relative URLs
// This works because the backend serves the frontend on the same origin

const API_BASE = '/api'

export interface ApiResponse<T> {
  data?: T
  error?: string
  message?: string
}

export interface User {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER'
  createdAt: Date
  lastLoginAt?: Date
}

export interface LoginResponse {
  token: string
  refreshToken: string
  expiresAt: string
  user: User
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

// Simple fetch wrapper
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = authStorage.getToken()
  const url = `${API_BASE}${endpoint}`
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  
  if (options.headers) {
    Object.assign(headers, options.headers)
  }
  
  try {
    console.log('[API] Fetching:', options.method || 'GET', url)
    const response = await fetch(url, {
      ...options,
      headers,
    })
    
    const data = await response.json()
    console.log('[API] Response:', response.status, data)
    
    if (!response.ok) {
      return { error: data.error || data.message || `HTTP ${response.status}` }
    }
    
    return { data }
  } catch (error) {
    console.error('[API] Error:', error)
    return { error: error instanceof Error ? error.message : 'Network error' }
  }
}

// Auth API
export const authApi = {
  async login(email: string, password: string): Promise<ApiResponse<LoginResponse>> {
    console.log('[Auth] Login called:', email)
    const response = await apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    
    if (response.data) {
      authStorage.setToken(response.data.token)
      authStorage.setRefreshToken(response.data.refreshToken)
      authStorage.setUser(response.data.user)
    }
    
    return response
  },
  
  async register(email: string, password: string, name: string): Promise<ApiResponse<User>> {
    return apiRequest<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    })
  },
  
  async logout(): Promise<void> {
    await apiRequest('/auth/logout', { method: 'POST' })
    authStorage.clear()
  },
  
  async getMe(): Promise<ApiResponse<User>> {
    return apiRequest<User>('/auth/me')
  },
}

// Generic API client for other endpoints
export const apiClient = {
  get: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: 'GET' }),
  post: <T>(endpoint: string, body?: unknown) => apiRequest<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(endpoint: string, body?: unknown) => apiRequest<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: 'DELETE' }),
}

// Nodes API
export const nodesApi = {
  list: (): Promise<ApiResponse<{ data: unknown[] }>> => apiRequest('/nodes'),
  create: (data: unknown): Promise<ApiResponse<unknown>> => apiClient.post('/nodes', data),
  delete: (id: string): Promise<ApiResponse<void>> => apiClient.delete(`/nodes/${id}`),
  update: (id: string, data: unknown): Promise<ApiResponse<unknown>> => apiClient.patch(`/nodes/${id}`, data),
}

// Tasks API
export const tasksApi = {
  list: (): Promise<ApiResponse<{ data: unknown[] }>> => apiRequest('/tasks'),
  create: (data: unknown): Promise<ApiResponse<unknown>> => apiClient.post('/tasks', data),
  retry: (id: string): Promise<ApiResponse<void>> => apiClient.post(`/tasks/${id}/retry`),
  cancel: (id: string): Promise<ApiResponse<void>> => apiClient.post(`/tasks/${id}/cancel`),
}

// Metrics API
export const metricsApi = {
  getSystem: (): Promise<ApiResponse<unknown>> => apiClient.get('/metrics/system'),
}
