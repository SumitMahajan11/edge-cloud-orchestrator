import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'

// Custom metrics
const errorRate = new Rate('errors')
const apiLatency = new Trend('api_latency')
const requestsPerSecond = new Counter('requests_per_second')

// Configuration
const BASE_URL = __ENV.API_URL || 'http://localhost:3000'
const VUS = parseInt(__ENV.VUS || '50')
const DURATION = __ENV.DURATION || '2m'

// Test options
export const options = {
  stages: [
    // Ramp-up
    { duration: '30s', target: VUS },
    // Steady state
    { duration: DURATION, target: VUS },
    // Ramp-down
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    errors: ['rate<0.1'], // Less than 10% errors
    api_latency: ['p(95)<300'],
  },
}

// Test data
const testUser = {
  email: 'loadtest@example.com',
  password: 'LoadTest123!',
  name: 'Load Test User',
}

let authToken = ''
let refreshToken = ''

export function setup() {
  // Register test user
  const registerRes = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify(testUser), {
    headers: { 'Content-Type': 'application/json' },
  })

  if (registerRes.status === 201 || registerRes.status === 409) {
    // Login to get token
    const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify(testUser), {
      headers: { 'Content-Type': 'application/json' },
    })

    if (loginRes.status === 200) {
      return {
        token: loginRes.json('token'),
        refreshToken: loginRes.json('refreshToken'),
      }
    }
  }

  return { token: '', refreshToken: '' }
}

export default function (data) {
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token}`,
  }

  // Test scenarios
  const scenarios = [
    () => testHealthCheck(),
    () => testAuthFlow(data),
    () => testNodeOperations(authHeaders),
    () => testTaskOperations(authHeaders),
    () => testMetricsEndpoints(authHeaders),
    () => testCostEndpoints(authHeaders),
  ]

  // Run random scenario
  const scenario = scenarios[Math.floor(Math.random() * scenarios.length)]
  scenario()

  sleep(1)
}

function testHealthCheck() {
  const res = http.get(`${BASE_URL}/health`)
  
  check(res, {
    'health check status is 200': (r) => r.status === 200,
    'health check returns healthy': (r) => r.json('status') === 'healthy',
  })
  
  recordMetrics(res)
}

function testAuthFlow(data) {
  // Test refresh token
  if (data.refreshToken) {
    const res = http.post(`${BASE_URL}/api/auth/refresh`, JSON.stringify({
      refreshToken: data.refreshToken,
    }), {
      headers: { 'Content-Type': 'application/json' },
    })

    check(res, {
      'token refresh status is 200': (r) => r.status === 200,
      'token refresh returns new token': (r) => r.json('token') !== undefined,
    })

    recordMetrics(res)
  }
}

function testNodeOperations(headers) {
  // List nodes
  let res = http.get(`${BASE_URL}/api/nodes`, { headers })
  
  check(res, {
    'list nodes status is 200': (r) => r.status === 200,
    'list nodes returns array': (r) => Array.isArray(r.json('data')),
  })
  
  recordMetrics(res)

  // Create node
  const nodeData = {
    name: `load-test-node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    location: 'Load Test Location',
    region: 'us-east-1',
    ipAddress: `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`,
    port: 4001,
    cpuCores: 4,
    memoryGB: 16,
    storageGB: 100,
  }

  res = http.post(`${BASE_URL}/api/nodes`, JSON.stringify(nodeData), { headers })
  
  check(res, {
    'create node status is 201': (r) => r.status === 201 || r.status === 200,
    'create node returns id': (r) => r.json('id') !== undefined,
  })
  
  recordMetrics(res)
}

function testTaskOperations(headers) {
  // List tasks
  let res = http.get(`${BASE_URL}/api/tasks`, { headers })
  
  check(res, {
    'list tasks status is 200': (r) => r.status === 200,
    'list tasks returns array': (r) => Array.isArray(r.json('data')),
  })
  
  recordMetrics(res)

  // Get task stats
  res = http.get(`${BASE_URL}/api/tasks/stats`, { headers })
  
  check(res, {
    'task stats status is 200': (r) => r.status === 200,
  })
  
  recordMetrics(res)

  // Create task
  const taskData = {
    name: `load-test-task-${Date.now()}`,
    type: 'INFERENCE',
    priority: 'NORMAL',
    input: { model: 'test-model', data: 'test-data' },
  }

  res = http.post(`${BASE_URL}/api/tasks`, JSON.stringify(taskData), { headers })
  
  check(res, {
    'create task status is 201': (r) => r.status === 201 || r.status === 200,
  })
  
  recordMetrics(res)
}

function testMetricsEndpoints(headers) {
  const res = http.get(`${BASE_URL}/api/metrics`, { headers })
  
  check(res, {
    'metrics status is 200': (r) => r.status === 200,
  })
  
  recordMetrics(res)
}

function testCostEndpoints(headers) {
  const res = http.get(`${BASE_URL}/api/cost/summary`, { headers })
  
  check(res, {
    'cost summary status is 200': (r) => r.status === 200,
  })
  
  recordMetrics(res)
}

function recordMetrics(res) {
  errorRate.add(res.status >= 400 ? 1 : 0)
  apiLatency.add(res.timings.duration)
  requestsPerSecond.add(1)
}

export function teardown(data) {
  // Cleanup: Could delete test user and data here
  console.log('Load test completed')
}
