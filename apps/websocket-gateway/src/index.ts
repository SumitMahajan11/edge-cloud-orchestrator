import { 
  initTelemetry,
  createLogger,
  fastifyLoggingPlugin,
  SecretManager, 
  SecretManagerFactory, 
  validateRequiredSecrets,
  REDIS_CHANNELS,
  extractTraceContext,
  getRequestHeaders,
  GracefulShutdown,
  HealthCheck
} from '@edgecloud/shared-kernel';
initTelemetry('websocket-gateway');

const logger = createLogger('websocket-gateway');

import Fastify from 'fastify';
import websocket, { SocketStream } from '@fastify/websocket';
import cors from '@fastify/cors';
import { EventEmitter } from 'eventemitter3';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import axios from 'axios';
import type { WebSocket } from 'ws';

let secretManager: SecretManager;
let JWT_SECRET: string;
let PORT: number;
let HEARTBEAT_INTERVAL: number;
let RECONNECT_BACKOFF_BASE: number;
let RECONNECT_BACKOFF_MAX: number;
let NODE_SERVICE_URL: string;
let serviceToken: string;
let redis: Redis;
let redisSub: Redis;

const app = Fastify({ logger: false });

// Connection manager with auto-reconnect support
class ConnectionManager extends EventEmitter {
  private connections: Map<string, ManagedConnection> = new Map();
  private heartbeatInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.heartbeatInterval = setInterval(() => this.sendHeartbeats(), HEARTBEAT_INTERVAL);
  }

  addConnection(socketStream: SocketStream, metadata: ConnectionMetadata): string {
    const {socket} = socketStream;
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

    socket.on('message', (data) => this.handleMessage(connectionId, data));
    socket.on('close', () => {
      this.connections.delete(connectionId);
      this.emit('connection:closed', { connectionId, metadata });
    });
    socket.on('error', (error) => {
      this.emit('connection:error', { connectionId, error });
    });

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
        case 'subscribe': this.handleSubscribe(connectionId, message.channels); break;
        case 'unsubscribe': this.handleUnsubscribe(connectionId, message.channels); break;
        case 'ping': this.send(connectionId, { type: 'pong', timestamp: Date.now() }); break;
        case 'reconnect': this.handleReconnect(connectionId, message.previousConnectionId); break;
        default: this.emit('message', { connectionId, message });
      }
    } catch (error) {
      this.send(connectionId, { type: 'error', message: 'Invalid format' });
    }
  }

  private async handleSubscribe(connectionId: string, channels: string[]): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    for (const ch of channels) {
      connection.subscriptions.add(ch);
      if (ch === 'nodes') {
        // Fetch snapshot for nodes on subscription
        try {
          const response = await axios.get(`${NODE_SERVICE_URL}/nodes`, {
            headers: { 
              ...getRequestHeaders(),
              'Authorization': `Bearer ${serviceToken}` 
            }
          });
          this.send(connectionId, { 
            type: 'snapshot', 
            channel: 'nodes', 
            data: response.data 
          });
          logger.info({ connectionId }, 'Sent node snapshot to client');
        } catch (err) {
          logger.error({ err }, 'Failed to fetch node snapshot');
        }
      }
    }
    this.send(connectionId, { type: 'subscribed', channels });
  }

  private handleUnsubscribe(connectionId: string, channels: string[]): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    channels.forEach(ch => connection.subscriptions.delete(ch));
    this.send(connectionId, { type: 'unsubscribed', channels });
  }

  private handleReconnect(connectionId: string, previousId: string): void {
    const previousConnection = this.connections.get(previousId);
    const newConnection = this.connections.get(connectionId);
    if (previousConnection && newConnection) {
      previousConnection.subscriptions.forEach(sub => newConnection.subscriptions.add(sub));
      this.send(connectionId, { type: 'reconnected', previousConnectionId: previousId, subscriptionsRestored: Array.from(newConnection.subscriptions) });
    }
  }

  broadcast(channel: string, message: any): void {
    const allowedRoles = CHANNEL_PERMISSIONS[channel] || [];
    const payload = { type: 'broadcast', channel, data: message, timestamp: Date.now() };
    for (const [id, conn] of this.connections) {
      if (!allowedRoles.includes(conn.metadata.role)) continue;
      if (message.region && conn.metadata.region && message.region !== conn.metadata.region) continue;
      if (conn.subscriptions.has(channel)) this.send(id, payload);
    }
  }

  send(connectionId: string, message: any): void {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.socket.readyState !== 1) return;
    try { connection.socket.send(JSON.stringify(message)); } catch (e) { this.emit('send:error', { connectionId, error: e }); }
  }

  private sendHeartbeats(): void {
    for (const [id, conn] of this.connections) {
      if (!conn.isAlive) {
        conn.socket.close(4000, 'Timeout');
        this.connections.delete(id);
        continue;
      }
      conn.isAlive = false;
      this.send(id, { type: 'ping', timestamp: Date.now() });
    }
  }

  getStats(): any {
    return { totalConnections: this.connections.size };
  }

  closeAll(): void {
    for (const conn of this.connections.values()) {
      try { conn.socket.close(1001, 'Shutdown'); } catch (e) {}
    }
    this.connections.clear();
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
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  region?: string;
  type: 'dashboard' | 'agent' | 'cli';
  version?: string;
}

const CHANNEL_PERMISSIONS: Record<string, string[]> = {
  'tasks': ['ADMIN', 'OPERATOR', 'VIEWER'],
  'nodes': ['ADMIN', 'OPERATOR', 'VIEWER'],
  'metrics': ['ADMIN', 'OPERATOR'],
  'scheduler': ['ADMIN'],
  'alerts': ['ADMIN', 'OPERATOR'],
  'admin': ['ADMIN'],
};

function validateWebSocketToken(req: any): any {
  const token = (req.query).token || req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return { valid: false, error: 'No token' };
  try {
    const decoded = jwt.verify(token, JWT_SECRET!) as any;
    return { valid: true, userId: decoded.userId, role: decoded.role || 'VIEWER' };
  } catch (err) {
    return { valid: false, error: 'Invalid' };
  }
}

async function start() {
  secretManager = SecretManagerFactory.create();
  await validateRequiredSecrets(secretManager, ['JWT_SECRET'], 'websocket-gateway');

  JWT_SECRET = (await secretManager.getSecret('JWT_SECRET'))!;
  serviceToken = await secretManager.getSecret('SERVICE_TOKEN') || 'internal-default';
  PORT = parseInt(await secretManager.getSecret('PORT') || '3004', 10);
  HEARTBEAT_INTERVAL = parseInt(await secretManager.getSecret('HEARTBEAT_INTERVAL') || '30000', 10);
  RECONNECT_BACKOFF_BASE = parseInt(await secretManager.getSecret('RECONNECT_BACKOFF_BASE') || '1000', 10);
  RECONNECT_BACKOFF_MAX = parseInt(await secretManager.getSecret('RECONNECT_BACKOFF_MAX') || '30000', 10);
  NODE_SERVICE_URL = await secretManager.getSecret('NODE_SERVICE_URL') || 'http://localhost:3001';

  const redisHost = await secretManager.getSecret('REDIS_HOST') || 'localhost';
  const redisPort = parseInt(await secretManager.getSecret('REDIS_PORT') || '6379');
  redis = new Redis({ host: redisHost, port: redisPort });
  redisSub = new Redis({ host: redisHost, port: redisPort });

  redisSub.subscribe(REDIS_CHANNELS.NODE_HEARTBEAT);
  redisSub.on('message', async (channel, message) => {
    if (channel === REDIS_CHANNELS.NODE_HEARTBEAT) {
      try {
        const envelope = JSON.parse(message);
        const otelMetadata = envelope._otel || {};
        const requestId = otelMetadata.requestId || '';
        const data = envelope.payload || envelope;

        const extractedContext = extractTraceContext(otelMetadata);
        const tracer = (await import('@opentelemetry/api')).trace.getTracer('websocket-gateway');
        const { runWithRequestId } = await import('@edgecloud/shared-kernel');

        await tracer.startActiveSpan('WSGateway.broadcast', {
          kind: (await import('@opentelemetry/api')).SpanKind.SERVER,
          attributes: { 'messaging.system': 'redis', 'messaging.destination': channel }
        }, extractedContext, async (span) => {
          await runWithRequestId(requestId, async () => {
            try {
              connectionManager.broadcast('nodes', {
                ...data,
                _traceId: span.spanContext().traceId,
                _requestId: requestId
              });
              span.setStatus({ code: (await import('@opentelemetry/api')).SpanStatusCode.OK });
            } catch (err: any) {
              span.recordException(err);
              span.setStatus({ code: (await import('@opentelemetry/api')).SpanStatusCode.ERROR });
            } finally {
              span.end();
            }
          });
        });
      } catch (err) {
        logger.error({ err }, 'Failed to parse Redis heartbeat message');
      }
    }
  });

  const corsOrigins = (await secretManager.getSecret('CORS_ORIGINS') || 'http://localhost:5173,http://localhost:3000').split(',');
  app.register(cors, { origin: corsOrigins, credentials: true });

  // Register unified logging
  await app.register(fastifyLoggingPlugin, { logger, serviceName: 'websocket-gateway' });

  app.register(websocket);

  // We still use Kafka for non-realtime business events if needed, but not for high-frequency heartbeats
  // await eventBus.subscribe(TOPICS.TASK_EVENTS, 'ws-gateway', async (ev) => connectionManager.broadcast('tasks', ev));

  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (connection, req) => {
      const validation = validateWebSocketToken(req);
      if (!validation.valid) { connection.socket.close(4001, validation.error); return; }
      const metadata: ConnectionMetadata = {
        userId: validation.userId,
        role: validation.role || 'VIEWER',
        region: (req.query as any).region || 'unknown',
        type: (req.query as any).type || 'dashboard',
      };
      connectionManager.addConnection(connection, metadata);
    });
  });

  app.get('/health', async () => HealthCheck.getLiveness());
  app.get('/health/live', async () => HealthCheck.getLiveness());
  app.get('/health/ready', async () => HealthCheck.getReadiness({
    redis: async () => {
      try { return (await redis.ping()) === 'PONG'; } catch { return false; }
    }
  }));
  app.get('/health/startup', async () => HealthCheck.getStartup());

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    
    // Initialize shutdown manager
    GracefulShutdown.init();
    GracefulShutdown.registerHandler('ws-clients', async () => {
      logger.info('Notifying WebSocket clients of server restart...');
      connectionManager.broadcast('admin', { type: 'server-restarting', message: 'WebSocket Gateway is restarting for maintenance.' });
      // Give clients a moment to receive the message
      await new Promise(resolve => setTimeout(resolve, 1000));
      connectionManager.closeAll();
    });
    GracefulShutdown.registerHandler('redis', async () => {
      if (redis) redis.disconnect();
      if (redisSub) redisSub.disconnect();
    });
    GracefulShutdown.registerHandler('app', async () => {
      await app.close();
    });

    HealthCheck.setReady(true);
    
    logger.info(`WebSocket Gateway running on port ${PORT} using ${secretManager.constructor.name}`);
  } catch (err) {
    logger.error({ err }, 'Failed to start WebSocket Gateway');
    process.exit(1);
  }
}

// Start the application
start();
