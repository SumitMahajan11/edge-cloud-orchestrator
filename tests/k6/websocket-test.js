import { check } from 'k6';
import { WebSocket } from 'k6/experimental/websockets';
import { Counter, Trend, Rate } from 'k6/metrics';

// ============================================================================
// Custom Metrics
// ============================================================================

const wsConnections = new Counter('ws_connections_total');
const wsMessagesReceived = new Counter('ws_messages_received');
const wsMessagesSent = new Counter('ws_messages_sent');
const wsLatency = new Trend('ws_message_latency');
const wsErrors = new Counter('ws_errors_total');
const wsConnectionDuration = new Trend('ws_connection_duration');

// ============================================================================
// Test Configuration
// ============================================================================

export const options = {
  scenarios: {
    // Multiple concurrent WebSocket connections
    concurrent_connections: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },   // Ramp up
        { duration: '2m', target: 50 },    // Stay
        { duration: '30s', target: 100 },  // Increase
        { duration: '2m', target: 100 },   // Stay
        { duration: '30s', target: 0 },    // Ramp down
      ],
    },
  },
  
  thresholds: {
    'ws_message_latency': ['p(95)<50'],
    'ws_errors_total': ['count<10'],
  },
};

// ============================================================================
// Configuration
// ============================================================================

const WS_URL = __ENV.WS_URL || 'ws://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token';

// ============================================================================
// Test Function
// ============================================================================

export default function () {
  const connectionStart = Date.now();
  
  // Connect with authentication
  const url = `${WS_URL}/ws?token=${AUTH_TOKEN}`;
  const ws = new WebSocket(url);
  
  let messageCount = 0;
  let lastPingTime = 0;
  const subscriptionChannels = ['tasks', 'nodes', 'metrics'];
  
  // Connection opened
  ws.addEventListener('open', () => {
    wsConnections.add(1);
    console.log(`VU ${__VU}: WebSocket connected`);
    
    // Subscribe to channels
    subscriptionChannels.forEach(channel => {
      const subscribeMsg = JSON.stringify({
        type: 'subscribe',
        channel: channel,
      });
      ws.send(subscribeMsg);
      wsMessagesSent.add(1);
    });
    
    // Start ping interval
    lastPingTime = Date.now();
    ws.send(JSON.stringify({ type: 'ping', timestamp: lastPingTime }));
  });
  
  // Message received
  ws.addEventListener('message', (event) => {
    wsMessagesReceived.add(1);
    messageCount++;
    
    try {
      const data = JSON.parse(event.data);
      
      // Check message structure
      check(data, {
        'message has type': (d) => d.type !== undefined,
      });
      
      // Handle different message types
      switch (data.type) {
        case 'pong':
          // Calculate round-trip latency
          if (data.timestamp) {
            const latency = Date.now() - data.timestamp;
            wsLatency.add(latency);
          }
          break;
          
        case 'task_update':
          check(data, {
            'task_update has taskId': (d) => d.taskId !== undefined,
            'task_update has status': (d) => d.status !== undefined,
          });
          break;
          
        case 'node_update':
          check(data, {
            'node_update has nodeId': (d) => d.nodeId !== undefined,
          });
          break;
          
        case 'metrics':
          check(data, {
            'metrics has data': (d) => d.data !== undefined,
          });
          break;
      }
    } catch (e) {
      console.log(`VU ${__VU}: Failed to parse message: ${e}`);
    }
  });
  
  // Error handling
  ws.addEventListener('error', (event) => {
    wsErrors.add(1);
    console.log(`VU ${__VU}: WebSocket error: ${event.error}`);
  });
  
  // Connection closed
  ws.addEventListener('close', () => {
    const duration = Date.now() - connectionStart;
    wsConnectionDuration.add(duration);
    console.log(`VU ${__VU}: WebSocket closed after ${duration}ms, received ${messageCount} messages`);
  });
  
  // Periodic ping to measure latency
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) { // OPEN
      lastPingTime = Date.now();
      ws.send(JSON.stringify({ 
        type: 'ping', 
        timestamp: lastPingTime,
        vu: __VU,
      }));
      wsMessagesSent.add(1);
    }
  }, 5000);
  
  // Keep connection alive for test duration
  // k6 will close connections when test ends
  setTimeout(() => {
    clearInterval(pingInterval);
    ws.close();
  }, 300000); // 5 minutes max per connection
}

// ============================================================================
// Setup and Teardown
// ============================================================================

export function setup() {
  console.log('Starting WebSocket load test...');
  console.log(`WebSocket URL: ${WS_URL}`);
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`WebSocket test completed in ${duration}s`);
}
