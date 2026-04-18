import axios from 'axios';
import WebSocket from 'ws';

const NODE_ID = 'node-007';
const NODE_SERVICE_URL = 'http://localhost:3001';
const WS_GATEWAY_URL = 'ws://localhost:3004/ws';
const JWT_TOKEN = 'your-test-jwt-token'; // Replace with a valid token if needed

async function testHeartbeat() {
  console.log('Starting Heartbeat E2E Test...');

  // 1. Connect to WebSocket
  const ws = new WebSocket(`${WS_GATEWAY_URL}?token=${JWT_TOKEN}`);

  ws.on('open', () => {
    console.log('[WS] Connected to gateway');
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['nodes'] }));
  });

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('[WS] Received:', message.type, message.channel || '');

    if (message.type === 'snapshot' && message.channel === 'nodes') {
      console.log('[WS] Successfully received node snapshot');
    }

    if (message.type === 'broadcast' && message.channel === 'nodes') {
      const node = message.data.node || message.data;
      if (node.id === NODE_ID) {
        console.log('[WS] SUCCESS: Received heartbeat update for', NODE_ID);
        process.exit(0);
      }
    }
  });

  // 2. Wait 2 seconds for connection, then send heartbeat
  setTimeout(async () => {
    console.log('[Agent] Sending heartbeat for', NODE_ID);
    try {
      await axios.post(`${NODE_SERVICE_URL}/nodes/${NODE_ID}/heartbeat`, {
        cpuUsage: Math.random() * 100,
        memoryUsage: Math.random() * 100,
        latency: 25,
        tasksRunning: 2
      }, {
        headers: { 'X-Correlation-ID': 'test-corr-id' }
      });
      console.log('[Agent] Heartbeat sent');
    } catch (err) {
      console.error('[Agent] Failed to send heartbeat:', err.message);
    }
  }, 2000);

  // Timeout after 10 seconds
  setTimeout(() => {
    console.error('Test timed out');
    process.exit(1);
  }, 10000);
}

testHeartbeat();
