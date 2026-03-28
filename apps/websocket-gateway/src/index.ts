import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket, { SocketStream } from '@fastify/websocket';
import { EventEmitter } from 'eventemitter3';
import { EventBus, TOPICS } from '@edgecloud/event-bus';
import type { WebSocket } from 'ws';

const app = Fastify({ logger: true });

// Register plugins
app.register(cors, { origin: true });
app.register(websocket);

// Configuration
const PORT = parseInt(process.env.PORT || '3004');
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL || '30000');
const RECONNECT_BACKOFF_BASE = parseInt(process.env.RECONNECT_BACKOFF_BASE || '1000');
const RECONNECT_BACKOFF_MAX = parseInt(process.env.RECONNECT_BACKOFF_MAX || '30000');

// Connection manager with auto-reconnect support
class ConnectionManager extends EventEmitter {
  private connections: Map<string, ManagedConnection> = new Map();
  private heartbeatInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.heartbeatInterval = setInterval(() => this.sendHeartbeats(), HEARTBEAT_INTERVAL);
  }

  addConnection(socketStream: SocketStream, metadata: ConnectionMetadata): string {
    const socket = socketStream.socket;
    const connectionId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const connection: ManagedConnection = {
      id: connectionId,
      socket,
      metadata,
      lastActivity: Date.now(),
      reconnectAttempts: 0,
      subscriptions: new Set(),
      isAlive: true,
    };

    this.connections.set(connectionId, connection);
    this.emit('connection:added', { connectionId, metadata });

    // Set up message handler
    socket.on('message', (data) => this.handleMessage(connectionId, data));

    // Set up close handler
    socket.on('close', () => {
      this.connections.delete(connectionId);
      this.emit('connection:closed', { connectionId, metadata });
    });

    // Set up error handler
    socket.on('error', (error) => {
      this.emit('connection:error', { connectionId, error });
    });

    // Send connection acknowledgment with reconnect config
    this.send(connectionId, {
      type: 'connected',
      connectionId,
      config: {
        heartbeatInterval: HEARTBEAT_INTERVAL,
        reconnectBackoffBase: RECONNECT_BACKOFF_BASE,
        reconnectBackoffMax: RECONNECT_BACKOFF_MAX,
      },
    });

    return connectionId;
  }

  private handleMessage(connectionId: string, data: any): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.lastActivity = Date.now();
    connection.isAlive = true;

    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(connectionId, message.channels);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(connectionId, message.channels);
          break;
        case 'ping':
          this.send(connectionId, { type: 'pong', timestamp: Date.now() });
          break;
        case 'reconnect':
          this.handleReconnect(connectionId, message.previousConnectionId);
          break;
        default:
          this.emit('message', { connectionId, message });
      }
    } catch (error) {
      this.send(connectionId, { type: 'error', message: 'Invalid message format' });
    }
  }

  private handleSubscribe(connectionId: string, channels: string[]): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    channels.forEach(channel => connection.subscriptions.add(channel));
    this.send(connectionId, { type: 'subscribed', channels });
  }

  private handleUnsubscribe(connectionId: string, channels: string[]): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    channels.forEach(channel => connection.subscriptions.delete(channel));
    this.send(connectionId, { type: 'unsubscribed', channels });
  }

  private handleReconnect(connectionId: string, previousId: string): void {
    const previousConnection = this.connections.get(previousId);
    const newConnection = this.connections.get(connectionId);
    
    if (previousConnection && newConnection) {
      // Restore subscriptions from previous connection
      previousConnection.subscriptions.forEach(sub => 
        newConnection.subscriptions.add(sub)
      );
      
      // Send missed messages (if any were buffered)
      this.send(connectionId, {
        type: 'reconnected',
        previousConnectionId: previousId,
        subscriptionsRestored: Array.from(newConnection.subscriptions),
      });
    }
  }

  broadcast(channel: string, message: any): void {
    const payload = { type: 'broadcast', channel, data: message, timestamp: Date.now() };
    
    for (const [id, connection] of this.connections) {
      if (connection.subscriptions.has(channel)) {
        this.send(id, payload);
      }
    }
  }

  send(connectionId: string, message: any): void {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.socket.readyState !== 1) return;

    try {
      connection.socket.send(JSON.stringify(message));
    } catch (error) {
      this.emit('send:error', { connectionId, error });
    }
  }

  private sendHeartbeats(): void {
    for (const [id, connection] of this.connections) {
      if (!connection.isAlive) {
        // Connection didn't respond to last ping, close it
        connection.socket.close(4000, 'Heartbeat timeout');
        this.connections.delete(id);
        continue;
      }

      connection.isAlive = false;
      this.send(id, { type: 'ping', timestamp: Date.now() });
    }
  }

  getStats(): ConnectionStats {
    return {
      totalConnections: this.connections.size,
      byRegion: this.groupBy('region'),
      byType: this.groupBy('type'),
    };
  }

  private groupBy(field: keyof ConnectionMetadata): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const conn of this.connections.values()) {
      const key = String(conn.metadata[field] || 'unknown');
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }
}

interface ManagedConnection {
  id: string;
  socket: WebSocket;
  metadata: ConnectionMetadata;
  lastActivity: number;
  reconnectAttempts: number;
  subscriptions: Set<string>;
  isAlive: boolean;
}

interface ConnectionMetadata {
  userId?: string;
  region?: string;
  type: 'dashboard' | 'agent' | 'cli';
  version?: string;
}

interface ConnectionStats {
  totalConnections: number;
  byRegion: Record<string, number>;
  byType: Record<string, number>;
}

// Initialize connection manager
const connectionManager = new ConnectionManager();

// Initialize event bus
const eventBus = new EventBus({
  clientId: 'websocket-gateway',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

// Subscribe to Kafka events and broadcast to WebSocket clients
async function setupEventSubscriptions(): Promise<void> {
  // Task events
  await eventBus.subscribe(TOPICS.TASK_EVENTS, 'ws-gateway-tasks', async (event) => {
    connectionManager.broadcast('tasks', event);
  });

  // Node events
  await eventBus.subscribe(TOPICS.NODE_EVENTS, 'ws-gateway-nodes', async (event) => {
    connectionManager.broadcast('nodes', event);
  });

  // Metrics events
  await eventBus.subscribe(TOPICS.METRICS, 'ws-gateway-metrics', async (event) => {
    connectionManager.broadcast('metrics', event);
  });

  // Scheduler events
  await eventBus.subscribe(TOPICS.SCHEDULER_DECISIONS, 'ws-gateway-scheduler', async (event) => {
    connectionManager.broadcast('scheduler', event);
  });
}

// WebSocket endpoint
app.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (connection, req) => {
    const query = req.query as Record<string, string>;
    
    const metadata: ConnectionMetadata = {
      userId: query.userId,
      region: query.region || process.env.REGION || 'unknown',
      type: (query.type as ConnectionMetadata['type']) || 'dashboard',
      version: query.version,
    };

    const connectionId = connectionManager.addConnection(connection.socket, metadata);

    // Send initial state
    connection.socket.send(JSON.stringify({
      type: 'welcome',
      connectionId,
      serverTime: Date.now(),
      availableChannels: ['tasks', 'nodes', 'metrics', 'scheduler', 'alerts'],
    }));
  });
});

// SSE fallback endpoint for clients that can't use WebSocket
app.get('/sse', async (request, reply) => {
  const query = request.query as Record<string, string>;
  
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  const sseId = `sse-${Date.now()}`;
  
  // Send initial connection message
  reply.raw.write(`event: connected\ndata: ${JSON.stringify({ sseId, timestamp: Date.now() })}\n\n`);

  // Create a handler for events
  const eventHandler = (data: any) => {
    try {
      reply.raw.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      // Connection closed
      connectionManager.removeListener('broadcast', eventHandler);
    }
  };

  // Subscribe to events
  connectionManager.on('broadcast', eventHandler);

  // Keep alive
  const keepAlive = setInterval(() => {
    try {
      reply.raw.write(': keepalive\n\n');
    } catch (error) {
      clearInterval(keepAlive);
      connectionManager.removeListener('broadcast', eventHandler);
    }
  }, 15000);

  // Handle client disconnect
  request.raw.on('close', () => {
    clearInterval(keepAlive);
    connectionManager.removeListener('broadcast', eventHandler);
  });

  return reply;
});

// REST endpoints for stats
app.get('/health', async () => {
  return { status: 'healthy', timestamp: new Date().toISOString() };
});

app.get('/stats', async () => {
  return connectionManager.getStats();
});

// Start server
const start = async () => {
  try {
    await setupEventSubscriptions();
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`WebSocket Gateway running on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
