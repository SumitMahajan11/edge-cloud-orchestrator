import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ============================================================================
// Custom Metrics
// ============================================================================

const nodeListSuccess = new Rate('node_list_success');
const nodeGetSuccess = new Rate('node_get_success');
const nodeListDuration = new Trend('node_list_duration');
const nodeGetDuration = new Trend('node_get_duration');
const nodesOnline = new Counter('nodes_online_total');

// ============================================================================
// Test Configuration
// ============================================================================

export const options = {
  scenarios: {
    // Read-heavy workload (typical dashboard usage)
    read_heavy: {
      executor: 'constant-vus',
      vus: 20,
      duration: '5m',
      exec: 'readNodes',
    },
    
    // Mixed read/write (operator managing nodes)
    mixed_workload: {
      executor: 'per-vu-iterations',
      vus: 5,
      iterations: 100,
      exec: 'mixedOperations',
      startTime: '5m',
    },
  },
  
  thresholds: {
    'http_req_duration': ['p(95)<50'],
    'http_req_duration{endpoint:node_list}': ['p(95)<30'],
    'http_req_duration{endpoint:node_get}': ['p(95)<25'],
    'http_req_failed': ['rate<0.001'],
    'node_list_success': ['rate>0.999'],
    'node_get_success': ['rate>0.999'],
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
// Test Functions
// ============================================================================

export function readNodes() {
  // List all nodes
  const listResponse = http.get(`${BASE_URL}/api/nodes`, {
    headers: HEADERS,
    tags: { endpoint: 'node_list' },
  });
  
  nodeListSuccess.add(listResponse.status === 200);
  nodeListDuration.add(listResponse.timings.duration);
  
  check(listResponse, {
    'list nodes: status 200': (r) => r.status === 200,
    'list nodes: has data': (r) => {
      try {
        const body = r.json();
        return Array.isArray(body.data) || Array.isArray(body);
      } catch {
        return false;
      }
    },
    'list nodes: response < 30ms': (r) => r.timings.duration < 30,
  });
  
  // Count online nodes
  if (listResponse.status === 200) {
    try {
      const nodes = listResponse.json('data') || listResponse.json();
      const onlineCount = nodes.filter(n => n.status === 'ONLINE').length;
      nodesOnline.add(onlineCount);
    } catch {}
  }
  
  sleep(0.5);
  
  // Get individual node details
  if (listResponse.status === 200) {
    try {
      const nodes = listResponse.json('data') || listResponse.json();
      if (nodes.length > 0) {
        const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
        const nodeId = randomNode.id;
        
        const getResponse = http.get(`${BASE_URL}/api/nodes/${nodeId}`, {
          headers: HEADERS,
          tags: { endpoint: 'node_get' },
        });
        
        nodeGetSuccess.add(getResponse.status === 200);
        nodeGetDuration.add(getResponse.timings.duration);
        
        check(getResponse, {
          'get node: status 200': (r) => r.status === 200,
          'get node: has metrics': (r) => {
            try {
              const body = r.json();
              return body.cpuUsage !== undefined || body.data?.cpuUsage !== undefined;
            } catch {
              return false;
            }
          },
        });
      }
    } catch {}
  }
  
  sleep(1);
}

export function mixedOperations() {
  // List nodes first
  const listResponse = http.get(`${BASE_URL}/api/nodes`, {
    headers: HEADERS,
    tags: { endpoint: 'node_list' },
  });
  
  check(listResponse, {
    'list nodes success': (r) => r.status === 200,
  });
  
  sleep(0.5);
  
  // Get node metrics
  if (listResponse.status === 200) {
    try {
      const nodes = listResponse.json('data') || listResponse.json();
      if (nodes.length > 0) {
        const nodeId = nodes[0].id;
        
        // Get metrics for node
        const metricsResponse = http.get(`${BASE_URL}/api/nodes/${nodeId}/metrics`, {
          headers: HEADERS,
          tags: { endpoint: 'node_metrics' },
        });
        
        check(metricsResponse, {
          'get metrics: status 200 or 404': (r) => r.status === 200 || r.status === 404,
        });
      }
    } catch {}
  }
  
  sleep(1);
}

// ============================================================================
// Setup and Teardown
// ============================================================================

export function setup() {
  console.log('Starting node health test...');
  
  const healthCheck = http.get(`${BASE_URL}/health`);
  if (healthCheck.status !== 200) {
    throw new Error(`Health check failed: ${healthCheck.status}`);
  }
  
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Node health test completed in ${duration}s`);
}
