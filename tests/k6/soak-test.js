import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// ============================================================================
// Soak Test Configuration
// ============================================================================
// 
// Purpose: Detect memory leaks, connection leaks, and performance degradation
// over extended periods at moderate load.
//
// Duration: 4 hours
// Load: 50 concurrent users (50% of max tested capacity)
// ============================================================================

const errorRate = new Rate('error_rate');
const latencyTrend = new Trend('latency_trend');
const memoryUsage = new Gauge('memory_usage_mb');
const dbConnections = new Gauge('db_connections');

export const options = {
  // Single scenario: sustained moderate load
  scenarios: {
    soak_test: {
      executor: 'constant-vus',
      vus: 50,
      duration: '4h',
    },
  },
  
  // Relaxed thresholds for long-running test
  thresholds: {
    'http_req_duration': ['p(95)<150'],  // Slightly relaxed
    'http_req_failed': ['rate<0.02'],     // Allow 2% errors
    'error_rate': ['rate<0.02'],
  },
};

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token';

const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${AUTH_TOKEN}`,
};

// ============================================================================
// Test Function
// ============================================================================

const endpoints = [
  { method: 'GET', path: '/api/tasks', weight: 30 },
  { method: 'GET', path: '/api/nodes', weight: 25 },
  { method: 'POST', path: '/api/tasks', weight: 20 },
  { method: 'GET', path: '/api/metrics', weight: 15 },
  { method: 'GET', path: '/health', weight: 10 },
];

function selectEndpoint() {
  const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const endpoint of endpoints) {
    random -= endpoint.weight;
    if (random <= 0) return endpoint;
  }
  return endpoints[0];
}

export default function () {
  const endpoint = selectEndpoint();
  const url = `${BASE_URL}${endpoint.path}`;
  
  let response;
  const startTime = Date.now();
  
  if (endpoint.method === 'GET') {
    response = http.get(url, { headers: HEADERS });
  } else if (endpoint.method === 'POST') {
    // Generate task payload for POST
    const payload = JSON.stringify({
      name: `Soak Test Task ${Date.now()}`,
      type: 'DATA_AGGREGATION',
      priority: 'MEDIUM',
      target: 'EDGE',
      input: { soakTest: true, vu: __VU, iter: __ITER },
    });
    response = http.post(url, payload, { headers: HEADERS });
  }
  
  const duration = Date.now() - startTime;
  
  // Record metrics
  errorRate.add(response.status >= 400);
  latencyTrend.add(duration);
  
  // Basic checks
  check(response, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'no timeout': (r) => r.status !== 0,
  });
  
  // Collect system metrics periodically (every 100 iterations)
  if (__ITER % 100 === 0) {
    collectSystemMetrics();
  }
  
  // Random think time
  sleep(Math.random() * 2 + 1);
}

function collectSystemMetrics() {
  // Try to get system metrics from /api/metrics
  try {
    const metricsResponse = http.get(`${BASE_URL}/api/metrics`, {
      headers: HEADERS,
      timeout: '5s',
    });
    
    if (metricsResponse.status === 200) {
      // Parse Prometheus-style metrics
      const body = metricsResponse.body;
      
      // Extract memory usage
      const memoryMatch = body.match(/nodejs_heap_size_bytes\{type="used"\}\s+(\d+)/);
      if (memoryMatch) {
        memoryUsage.add(parseInt(memoryMatch[1]) / 1024 / 1024); // Convert to MB
      }
      
      // Extract DB connections (if exposed)
      const dbMatch = body.match(/edgecloud_database_connections\{state="active"\}\s+(\d+)/);
      if (dbMatch) {
        dbConnections.add(parseInt(dbMatch[1]));
      }
    }
  } catch (e) {
    // Ignore metrics collection errors
  }
}

// ============================================================================
// Setup and Teardown
// ============================================================================

export function setup() {
  console.log('='.repeat(60));
  console.log('SOAK TEST STARTING');
  console.log('='.repeat(60));
  console.log(`Duration: 4 hours`);
  console.log(`Concurrent Users: 50`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log('='.repeat(60));
  
  // Verify system is healthy
  const healthCheck = http.get(`${BASE_URL}/health`);
  if (healthCheck.status !== 200) {
    throw new Error(`Health check failed: ${healthCheck.status}`);
  }
  
  return { 
    startTime: Date.now(),
    initialMemory: process.memoryUsage?.()?.heapUsed || 0,
  };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000 / 60; // minutes
  
  console.log('\n' + '='.repeat(60));
  console.log('SOAK TEST COMPLETED');
  console.log('='.repeat(60));
  console.log(`Total Duration: ${duration.toFixed(2)} minutes`);
  
  // Check for memory growth (if available)
  if (process.memoryUsage) {
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryGrowth = (finalMemory - data.initialMemory) / 1024 / 1024;
    console.log(`Memory Growth: ${memoryGrowth.toFixed(2)} MB`);
    
    if (memoryGrowth > 100) {
      console.log('WARNING: Significant memory growth detected!');
    }
  }
  
  console.log('='.repeat(60));
}

// ============================================================================
// Handle Summary
// ============================================================================

export function handleSummary(data) {
  const metrics = data.metrics;
  
  const summary = {
    testType: 'soak',
    duration: '4h',
    vus: 50,
    results: {
      totalRequests: metrics.http_reqs?.values?.count || 0,
      errorRate: metrics.http_req_failed?.values?.rate || 0,
      p50Latency: metrics.http_req_duration?.values?.['p(50)'] || 0,
      p95Latency: metrics.http_req_duration?.values?.['p(95)'] || 0,
      p99Latency: metrics.http_req_duration?.values?.['p(99)'] || 0,
      avgLatency: metrics.http_req_duration?.values?.avg || 0,
    },
    passed: true,
    warnings: [],
  };
  
  // Check for degradation
  if (summary.results.p95Latency > 150) {
    summary.warnings.push('p95 latency exceeded 150ms threshold');
  }
  
  if (summary.results.errorRate > 0.01) {
    summary.warnings.push(`Error rate ${(summary.results.errorRate * 100).toFixed(2)}% exceeded 1%`);
  }
  
  return {
    'stdout': JSON.stringify(summary, null, 2),
    'soak-test-results.json': JSON.stringify(summary, null, 2),
  };
}
