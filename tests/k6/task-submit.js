import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ============================================================================
// Custom Metrics
// ============================================================================

const taskSubmitSuccess = new Rate('task_submit_success');
const taskSubmitDuration = new Trend('task_submit_duration');
const tasksSubmitted = new Counter('tasks_submitted_total');
const schedulerQueueDepth = new Gauge('scheduler_queue_depth');

// ============================================================================
// Test Configuration
// ============================================================================

export const options = {
  scenarios: {
    // Scenario 1: Constant load for baseline measurement
    constant_load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '5m',
      startTime: '0s',
      tags: { scenario: 'constant' },
    },
    
    // Scenario 2: Ramping load to find breaking point
    ramping_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },   // Ramp up to 100
        { duration: '5m', target: 100 },   // Stay at 100
        { duration: '2m', target: 200 },   // Ramp up to 200
        { duration: '5m', target: 200 },   // Stay at 200
        { duration: '2m', target: 300 },   // Ramp up to 300
        { duration: '5m', target: 300 },   // Stay at 300
        { duration: '2m', target: 0 },     // Ramp down
      ],
      startTime: '6m',
      tags: { scenario: 'ramping' },
    },
    
    // Scenario 3: Spike test
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 10 },   // Baseline
        { duration: '10s', target: 500 },  // Spike!
        { duration: '2m', target: 500 },   // Hold spike
        { duration: '30s', target: 10 },   // Return to baseline
      ],
      startTime: '30m',
      tags: { scenario: 'spike' },
    },
  },
  
  thresholds: {
    // HTTP request thresholds
    'http_req_duration': ['p(95)<100', 'p(99)<250'],
    'http_req_duration{endpoint:task_submit}': ['p(95)<50'],
    'http_req_duration{endpoint:node_list}': ['p(95)<30'],
    'http_req_failed': ['rate<0.01'],
    
    // Custom metric thresholds
    'task_submit_success': ['rate>0.99'],
    'task_submit_duration': ['p(95)<50', 'p(99)<100'],
  },
};

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token';

// Task type distribution (weighted)
const TASK_TYPES = [
  { type: 'IMAGE_CLASSIFICATION', weight: 40 },
  { type: 'DATA_AGGREGATION', weight: 30 },
  { type: 'MODEL_INFERENCE', weight: 20 },
  { type: 'SENSOR_FUSION', weight: 5 },
  { type: 'VIDEO_PROCESSING', weight: 5 },
];

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const TARGETS = ['EDGE', 'CLOUD'];

// ============================================================================
// Helper Functions
// ============================================================================

function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item.type || item;
  }
  return items[0].type || items[0];
}

function generateTaskPayload() {
  const taskType = weightedRandom(TASK_TYPES);
  const priority = PRIORITIES[Math.floor(Math.random() * PRIORITIES.length)];
  const target = TARGETS[Math.floor(Math.random() * TARGETS.length)];
  
  // Generate task-specific input
  let input = {};
  switch (taskType) {
    case 'IMAGE_CLASSIFICATION':
      input = {
        imageUrl: `https://example.com/images/${__VU}-${__ITER}.jpg`,
        modelId: 'resnet-50',
        confidence: 0.8,
      };
      break;
    case 'DATA_AGGREGATION':
      input = {
        sources: Array(5).fill(null).map((_, i) => `sensor-${i}`),
        aggregationWindow: 60,
        metrics: ['avg', 'max', 'min'],
      };
      break;
    case 'MODEL_INFERENCE':
      input = {
        modelId: 'llama-7b',
        prompt: `Test prompt for VU ${__VU} iteration ${__ITER}`,
        maxTokens: 100,
      };
      break;
    default:
      input = { testId: __VU, iteration: __ITER };
  }
  
  return {
    name: `Load Test ${taskType} ${Date.now()}-${__VU}-${__ITER}`,
    type: taskType,
    priority,
    target,
    input,
    metadata: {
      loadTest: true,
      vu: __VU,
      iteration: __ITER,
    },
  };
}

// ============================================================================
// Test Lifecycle
// ============================================================================

export function setup() {
  console.log('Setting up load test...');
  console.log(`Base URL: ${BASE_URL}`);
  
  // Verify API is accessible
  const healthCheck = http.get(`${BASE_URL}/health`);
  if (healthCheck.status !== 200) {
    throw new Error(`Health check failed: ${healthCheck.status}`);
  }
  
  // Get initial queue depth
  const metricsResponse = http.get(`${BASE_URL}/api/metrics`);
  if (metricsResponse.status === 200) {
    // Parse queue depth from metrics if available
    console.log('Initial metrics collected');
  }
  
  return { startTime: Date.now() };
}

export default function (data) {
  // Generate task payload
  const payload = JSON.stringify(generateTaskPayload());
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
    },
    tags: { endpoint: 'task_submit' },
    timeout: '30s',
  };
  
  // Submit task
  const startTime = Date.now();
  const response = http.post(`${BASE_URL}/api/tasks`, payload, params);
  
  // Record custom metrics
  taskSubmitSuccess.add(response.status === 201);
  taskSubmitDuration.add(response.timings.duration);
  
  if (response.status === 201) {
    tasksSubmitted.add(1);
  }
  
  // Assertions
  check(response, {
    'status is 201': (r) => r.status === 201,
    'has task id': (r) => {
      try {
        const body = r.json();
        return body.id !== undefined || body.data?.id !== undefined;
      } catch {
        return false;
      }
    },
    'response time < 100ms': (r) => r.timings.duration < 100,
    'response time < 50ms (p95 target)': (r) => r.timings.duration < 50,
  });
  
  // Random think time between requests
  sleep(Math.random() * 2 + 0.5);
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Load test completed in ${duration}s`);
}

// ============================================================================
// Handle Summary
// ============================================================================

import { Gauge } from 'k6/metrics';

export function handleSummary(data) {
  const stats = {
    http_reqs: data.metrics.http_reqs?.values?.count || 0,
    http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
    http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
    task_submit_success_rate: data.metrics.task_submit_success?.values?.rate || 0,
    iterations: data.metrics.iterations?.values?.count || 0,
  };
  
  console.log('\n========== LOAD TEST SUMMARY ==========');
  console.log(`Total Requests: ${stats.http_reqs}`);
  console.log(`Total Iterations: ${stats.iterations}`);
  console.log(`p95 Latency: ${stats.http_req_duration_p95.toFixed(2)}ms`);
  console.log(`p99 Latency: ${stats.http_req_duration_p99.toFixed(2)}ms`);
  console.log(`Success Rate: ${(stats.task_submit_success_rate * 100).toFixed(2)}%`);
  console.log('========================================\n');
  
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'results.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data, options) {
  // Simple summary output
  return `Load test completed. See results.json for details.`;
}
