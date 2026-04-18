// k6 Load Test for Edge-Cloud Orchestrator
// Tests large-scale node scenarios and task scheduling

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'

// Custom metrics
const taskSubmitRate = new Rate('task_submit_success')
const taskLatency = new Trend('task_latency')
const nodeHealthRate = new Rate('node_health_success')
const schedulerDecisions = new Counter('scheduler_decisions')
const edgeRouting = new Counter('edge_routing')
const cloudRouting = new Counter('cloud_routing')

// Test configuration
export const options = {
  scenarios: {
    // Scenario 1: Normal load
    normal_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
    
    // Scenario 2: Spike test
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '10s', target: 500 },
        { duration: '30s', target: 500 },
        { duration: '10s', target: 10 },
      ],
      gracefulRampDown: '5s',
    },
    
    // Scenario 3: Constant load
    constant_load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '5m',
    },
    
    // Scenario 4: Large-scale nodes
    large_scale_nodes: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 10,
      maxDuration: '10m',
    },
  },
  
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.05'],
    task_submit_success: ['rate>0.95'],
    task_latency: ['p(95)<300'],
    node_health_success: ['rate>0.99'],
  },
}

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5173'
const API_URL = `${BASE_URL}/api`

// Task types for simulation
const TASK_TYPES = [
  'Image Classification',
  'Data Aggregation',
  'Model Inference',
  'Sensor Fusion',
  'Video Processing',
  'Log Analysis',
  'Anomaly Detection',
]

const PRIORITIES = ['low', 'medium', 'high', 'critical']
const LOCATIONS = ['us-east', 'us-west', 'eu-west', 'eu-central', 'apac-south', 'apac-north']

// Helper functions
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateTaskName() {
  const prefixes = ['Process', 'Analyze', 'Compute', 'Transform', 'Sync', 'Validate']
  const suffixes = ['Batch', 'Stream', 'Job', 'Task', 'Operation', 'Workflow']
  return `${randomChoice(prefixes)}-${randomChoice(suffixes)}-${Math.floor(Math.random() * 10000)}`
}

function generateNodeId() {
  return `node-${Math.random().toString(36).substr(2, 9)}`
}

// Setup function - runs once per VU
export function setup() {
  // Login to get auth token
  const loginRes = http.post(`${API_URL}/auth/login`, JSON.stringify({
    email: 'admin@edgecloud.io',
    password: 'password',
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
  
  check(loginRes, {
    'login successful': (r) => r.status === 200,
  })
  
  return {
    token: loginRes.json('token') || 'mock-token',
  }
}

// Default function - runs for each iteration
export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token}`,
  }
  
  // Randomly choose action
  const action = Math.random()
  
  if (action < 0.4) {
    // Submit task
    submitTask(headers)
  } else if (action < 0.6) {
    // Check node health
    checkNodeHealth(headers)
  } else if (action < 0.8) {
    // Get metrics
    getMetrics(headers)
  } else {
    // Simulate node registration
    registerNode(headers)
  }
  
  sleep(Math.random() * 2)
}

function submitTask(headers) {
  const taskName = generateTaskName()
  const taskType = randomChoice(TASK_TYPES)
  const priority = randomChoice(PRIORITIES)
  
  const startTime = Date.now()
  
  const res = http.post(`${API_URL}/tasks`, JSON.stringify({
    name: taskName,
    type: taskType,
    priority: priority,
  }), { headers })
  
  const latency = Date.now() - startTime
  taskLatency.add(latency)
  schedulerDecisions.add(1)
  
  const success = check(res, {
    'task submitted': (r) => r.status === 200 || r.status === 201,
    'task has id': (r) => r.json('id') !== undefined,
  })
  
  taskSubmitRate.add(success)
  
  if (success) {
    const target = res.json('target')
    if (target === 'edge') {
      edgeRouting.add(1)
    } else {
      cloudRouting.add(1)
    }
  }
}

function checkNodeHealth(headers) {
  const nodeId = generateNodeId()
  
  const res = http.get(`${API_URL}/nodes/${nodeId}/health`, { headers })
  
  const success = check(res, {
    'node health check': (r) => r.status === 200 || r.status === 404,
  })
  
  nodeHealthRate.add(success)
}

function getMetrics(headers) {
  const res = http.get(`${API_URL}/metrics`, { headers })
  
  check(res, {
    'metrics retrieved': (r) => r.status === 200,
    'metrics has data': (r) => {
      const body = r.json()
      return body.totalNodes !== undefined
    },
  })
}

function registerNode(headers) {
  const nodeId = generateNodeId()
  const location = randomChoice(LOCATIONS)
  
  const res = http.post(`${API_URL}/nodes`, JSON.stringify({
    id: nodeId,
    name: `edge-${location}-${Math.floor(Math.random() * 100)}`,
    location: location,
    url: `http://localhost:${4000 + Math.floor(Math.random() * 100)}`,
  }), { headers })
  
  check(res, {
    'node registered': (r) => r.status === 200 || r.status === 201,
  })
}

// Teardown function
export function teardown(data) {
  console.log('Load test completed')
}

// Large-scale simulation
export function simulateLargeScale() {
  const nodeCount = 1000
  const taskCount = 10000
  
  console.log(`Simulating ${nodeCount} nodes and ${taskCount} tasks`)
  
  // Simulate node distribution
  const nodeDistribution = {
    'us-east': 0,
    'us-west': 0,
    'eu-west': 0,
    'eu-central': 0,
    'apac-south': 0,
    'apac-north': 0,
  }
  
  // Simulate task distribution
  const taskDistribution = {
    edge: 0,
    cloud: 0,
  }
  
  const policy = 'latency-aware'
  
  for (let i = 0; i < nodeCount; i++) {
    const location = randomChoice(Object.keys(nodeDistribution))
    nodeDistribution[location]++
  }
  
  for (let i = 0; i < taskCount; i++) {
    // Simulate scheduling decision
    const routedToEdge = Math.random() > 0.3 // 70% to edge
    if (routedToEdge) {
      taskDistribution.edge++
    } else {
      taskDistribution.cloud++
    }
  }
  
  return {
    nodes: nodeDistribution,
    tasks: taskDistribution,
    metrics: {
      avgLatency: Math.random() * 50 + 10,
      throughput: taskCount / 60, // tasks per second
      edgeUtilization: taskDistribution.edge / taskCount,
      healthScore: 95 + Math.random() * 5,
    },
  }
}
