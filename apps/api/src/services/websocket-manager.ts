import { IncomingMessage } from 'http';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import type { Logger } from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket } from 'ws';

// JWT_SECRET must be set - validated in index.ts
const JWT_SECRET = process.env.JWT_SECRET!;

// WebSocket authentication timeout
const AUTH_TIMEOUT = 10000; // 10 seconds to authenticate

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds - close if no response
const REDIS_PUBSUB_CHANNEL = 'ws:broadcast';

interface Client {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>;
  isAuthenticated: boolean;
  userId?: string;
  connectedAt: Date;
  lastPing: Date;
  isAlive: boolean;
}

interface Message {
  type: string;
  payload: unknown;
  timestamp: string;
}

interface ClusterMessage {
  instanceId: string;
  channel: string;
  payload: unknown;
  excludeSender?: string;
}

export class WebSocketManager {
  private clients: Map<string, Client> = new Map();
  private logger: Logger;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private redis?: Redis;
  private redisSubscriber?: Redis;
  private instanceId: string;

  constructor(logger: Logger, redis?: Redis) {
    this.logger = logger;
    this.redis = redis;
    this.instanceId = `ws-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    if (redis) {
      this.setupRedisClustering();
    }

    this.startHeartbeatCheck();
  }

  /**
   * Setup Redis Pub/Sub for cross-instance messaging
   */
  private async setupRedisClustering(): Promise<void> {
    if (!this.redis) {
      return;
    }

    // Create a dedicated subscriber connection
    this.redisSubscriber = this.redis.duplicate();

    await this.redisSubscriber.subscribe(REDIS_PUBSUB_CHANNEL);

    this.redisSubscriber.on('message', (channel: string, message: string) => {
      if (channel !== REDIS_PUBSUB_CHANNEL) {
        return;
      }

      try {
        const clusterMsg: ClusterMessage = JSON.parse(message);

        // Don't process messages from this instance
        if (clusterMsg.instanceId === this.instanceId) {
          return;
        }

        // Don't broadcast to excluded client
        if (clusterMsg.excludeSender) {
          this.broadcastLocally(
            clusterMsg.channel,
            clusterMsg.payload,
            clusterMsg.excludeSender,
          );
        } else {
          this.broadcastLocally(clusterMsg.channel, clusterMsg.payload);
        }
      } catch (error) {
        this.logger.error({ error }, 'Failed to parse cluster message');
      }
    });

    this.logger.info(
      { instanceId: this.instanceId },
      'WebSocket clustering enabled',
    );
  }

  private startHeartbeatCheck() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const staleClients: string[] = [];

      for (const [clientId, client] of this.clients.entries()) {
        // Check if client is still alive
        if (!client.isAlive) {
          staleClients.push(clientId);
          continue;
        }

        // Check for timeout
        const timeSinceLastPing = now - client.lastPing.getTime();
        if (timeSinceLastPing > HEARTBEAT_TIMEOUT) {
          this.logger.warn(
            { clientId, timeSinceLastPing },
            'Client heartbeat timeout',
          );
          staleClients.push(clientId);
          continue;
        }

        // Send ping and mark as not alive (expecting pong)
        client.isAlive = false;
        try {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.ping();
          }
        } catch (error) {
          // Socket may be closing
          staleClients.push(clientId);
        }
      }

      // Terminate stale connections
      for (const clientId of staleClients) {
        const client = this.clients.get(clientId);
        if (client) {
          this.logger.info(
            { clientId },
            'Terminating stale WebSocket connection',
          );
          try {
            client.ws.close(1001, 'Heartbeat timeout');
          } catch (error) {
            // Socket may already be closed
          }
          this.clients.delete(clientId);
        }
      }

      if (staleClients.length > 0) {
        this.logger.info(
          { count: staleClients.length, remaining: this.clients.size },
          'Cleaned up stale connections',
        );
      }
    }, HEARTBEAT_INTERVAL);
  }

  handleConnection(ws: WebSocket, _req: IncomingMessage) {
    const clientId = uuidv4();
    const client: Client = {
      id: clientId,
      ws,
      subscriptions: new Set(),
      isAuthenticated: false,
      connectedAt: new Date(),
      lastPing: new Date(),
      isAlive: true,
    };

    this.clients.set(clientId, client);
    this.logger.info(
      { clientId, totalClients: this.clients.size },
      'WebSocket client connected',
    );

    // Send welcome message with auth requirement
    this.sendToClient(client, 'connected', {
      clientId,
      message:
        'Please authenticate within 10 seconds using { type: "authenticate", payload: { token: "your-jwt" } }',
    });

    // Set authentication timeout
    const authTimeout = setTimeout(() => {
      if (!client.isAuthenticated) {
        this.logger.warn(
          { clientId },
          'WebSocket client failed to authenticate in time',
        );
        try {
          // Send error message before closing
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { message: 'Authentication timeout' },
                timestamp: new Date().toISOString(),
              }),
            );
            // Use code 1008 (policy violation) for auth failure
            ws.close(1008);
          }
        } catch (error) {
          // Socket may already be closed
        }
        this.clients.delete(clientId);
      }
    }, AUTH_TIMEOUT);

    // Handle pong responses
    ws.on('pong', () => {
      client.isAlive = true;
      client.lastPing = new Date();
    });

    ws.on('message', (data: Buffer) => {
      // Mark as alive on any message
      client.isAlive = true;
      client.lastPing = new Date();

      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(client, message, authTimeout);
      } catch (error) {
        this.logger.warn(
          { clientId, error },
          'Failed to parse WebSocket message',
        );
        this.sendToClient(client, 'error', {
          message: 'Invalid message format',
        });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      this.clients.delete(clientId);
      this.logger.info(
        { clientId, totalClients: this.clients.size },
        'WebSocket client disconnected',
      );
    });

    ws.on('error', (error) => {
      this.logger.error({ clientId, error }, 'WebSocket error');
      this.clients.delete(clientId);
    });
  }

  private handleMessage(
    client: Client,
    message: { type: string; payload?: unknown },
    authTimeout: ReturnType<typeof setTimeout>,
  ) {
    // Require authentication for all messages except 'authenticate'
    if (message.type !== 'authenticate' && !client.isAuthenticated) {
      this.sendToClient(client, 'error', {
        message: 'Authentication required',
      });
      return;
    }

    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(client, message.payload as { channels: string[] });
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(
          client,
          message.payload as { channels: string[] },
        );
        break;
      case 'authenticate':
        this.handleAuthenticate(
          client,
          message.payload as { token: string },
          authTimeout,
        );
        break;
      case 'ping':
        this.sendToClient(client, 'pong', {
          timestamp: new Date().toISOString(),
        });
        break;
      default:
        this.logger.warn(
          { clientId: client.id, type: message.type },
          'Unknown WebSocket message type',
        );
    }
  }

  private handleSubscribe(client: Client, payload: { channels: string[] }) {
    if (!payload?.channels || !Array.isArray(payload.channels)) {
      return this.sendToClient(client, 'error', {
        message: 'Invalid subscribe payload',
      });
    }

    for (const channel of payload.channels) {
      client.subscriptions.add(channel);
    }

    this.sendToClient(client, 'subscribed', { channels: payload.channels });
    this.logger.debug(
      { clientId: client.id, channels: payload.channels },
      'Client subscribed to channels',
    );
  }

  private handleUnsubscribe(client: Client, payload: { channels: string[] }) {
    if (!payload?.channels || !Array.isArray(payload.channels)) {
      return this.sendToClient(client, 'error', {
        message: 'Invalid unsubscribe payload',
      });
    }

    for (const channel of payload.channels) {
      client.subscriptions.delete(channel);
    }

    this.sendToClient(client, 'unsubscribed', { channels: payload.channels });
  }

  private async handleAuthenticate(
    client: Client,
    payload: { token: string },
    authTimeout: ReturnType<typeof setTimeout>,
  ) {
    try {
      if (!payload.token) {
        this.sendToClient(client, 'error', { message: 'Token required' });
        client.ws.close(4001, 'Authentication required');
        return;
      }

      const decoded = jwt.verify(payload.token, JWT_SECRET) as {
        userId: string;
        role?: string;
      };
      client.isAuthenticated = true;
      client.userId = decoded.userId;

      // Clear auth timeout on successful authentication
      clearTimeout(authTimeout);

      this.sendToClient(client, 'authenticated', {
        success: true,
        userId: decoded.userId,
        role: decoded.role,
      });

      this.logger.info(
        { clientId: client.id, userId: decoded.userId },
        'WebSocket client authenticated',
      );
    } catch (error) {
      this.logger.warn(
        { clientId: client.id, error: (error as Error).message },
        'WebSocket authentication failed',
      );
      this.sendToClient(client, 'error', { message: 'Authentication failed' });
      client.ws.close(4001, 'Invalid token');
    }
  }

  private sendToClient(client: Client, type: string, payload: unknown) {
    if (client.ws.readyState === WebSocket.OPEN) {
      const message: Message = {
        type,
        payload,
        timestamp: new Date().toISOString(),
      };
      client.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast to local clients only
   */
  broadcastLocally(
    channel: string,
    payload: unknown,
    excludeClientId?: string,
  ) {
    const message: Message = {
      type: channel,
      payload,
      timestamp: new Date().toISOString(),
    };

    const messageStr = JSON.stringify(message);
    let sent = 0;

    for (const client of this.clients.values()) {
      if (excludeClientId && client.id === excludeClientId) {
        continue;
      }

      if (client.subscriptions.has(channel) || client.subscriptions.has('*')) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(messageStr);
          sent++;
        }
      }
    }

    this.logger.debug({ channel, clients: sent }, 'Local broadcast');
  }

  /**
   * Broadcast to all instances via Redis Pub/Sub
   */
  broadcast(channel: string, payload: unknown, excludeClientId?: string) {
    // First, broadcast locally
    this.broadcastLocally(channel, payload, excludeClientId);

    // Then, broadcast to other instances via Redis
    if (this.redis) {
      const clusterMsg: ClusterMessage = {
        instanceId: this.instanceId,
        channel,
        payload,
        excludeSender: excludeClientId,
      };

      this.redis
        .publish(REDIS_PUBSUB_CHANNEL, JSON.stringify(clusterMsg))
        .catch((error) => {
          this.logger.error({ error }, 'Failed to publish cluster message');
        });
    }
  }

  broadcastToUser(userId: string, type: string, payload: unknown) {
    for (const client of this.clients.values()) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(client, type, payload);
      }
    }
  }

  getStats() {
    return {
      totalClients: this.clients.size,
      authenticatedClients: Array.from(this.clients.values()).filter(
        (c) => c.isAuthenticated,
      ).length,
      subscriptions: Array.from(this.clients.values()).reduce(
        (acc, c) => {
          for (const sub of c.subscriptions) {
            acc[sub] = (acc[sub] || 0) + 1;
          }
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  close() {
    // Stop heartbeat check
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all connections
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.logger.info('WebSocket manager closed');
  }
}
