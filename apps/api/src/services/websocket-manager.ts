import { IncomingMessage } from 'http';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import type { Logger } from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket } from 'ws';
import { env } from '../config/env';
import type { TenantId } from '../types/fastify.js';

// JWT_SECRET must be set - validated in index.ts
const getJwtSecret = () => env.JWT_SECRET;

// WebSocket authentication timeout
// const AUTH_TIMEOUT = 10000; // 10 seconds to authenticate

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds - close if no response
const REDIS_PUBSUB_CHANNEL = 'ws:broadcast';

interface Client {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>;
  isAuthenticated: boolean;
  userId?: string | undefined;
  connectedAt: Date;
  lastPing: Date;
  isAlive: boolean;
  tenantId?: string | undefined;
}

interface DisconnectedClient {
  id: string;
  subscriptions: Set<string>;
  userId?: string | undefined;
  tenantId?: string | undefined;
  disconnectedAt: Date;
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
  excludeSender?: string | undefined;
}

export class WebSocketManager {
  private clients: Map<string, Client> = new Map();
  private disconnectedClients: Map<string, DisconnectedClient> = new Map();
  private logger: Logger;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private redis: Redis | undefined;
  private redisSubscriber: Redis | undefined;
  private instanceId: string;

  constructor(logger: Logger, redis?: Redis) {
    this.logger = logger;
    this.redis = redis;
    this.instanceId = `ws-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    if (redis) {
      void this.setupRedisClustering();
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
    await this.redisSubscriber.psubscribe('*:*:*');

    const messageHandler = (channel: string, message: string) => {
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
        this.logger.error(
          { error, channel },
          'Failed to parse cluster message',
        );
      }
    };

    this.redisSubscriber.on('message', (channel: string, message: string) => {
      messageHandler(channel, message);
    });

    this.redisSubscriber.on(
      'pmessage',
      (_pattern: string, channel: string, message: string) => {
        messageHandler(channel, message);
      },
    );

    this.logger.info(
      { instanceId: this.instanceId },
      'WebSocket clustering enabled',
    );
  }

  private startHeartbeatCheck(): void {
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

  handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = uuidv4();

    // Extract token from Authorization header or ?token= query parameter
    const authHeader = req.headers.authorization;
    const url = new URL(
      req.url || '',
      `http://${req.headers.host || 'localhost'}`,
    );
    const queryToken = url.searchParams.get('token');

    let token = queryToken;
    if (!token && authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    if (!token) {
      this.logger.warn(
        { clientId },
        'WebSocket connection rejected: No token provided',
      );
      ws.close(4001, 'Unauthorized');
      return;
    }

    try {
      // Verify JWT using the same secret as the REST auth plugin
      const decoded = jwt.verify(token, getJwtSecret()) as {
        id: string;
        email: string;
        role: string;
        tenantId?: string;
      };

      this.logger.info(
        {
          clientId,
          userId: decoded.id,
          role: decoded.role,
          tenantId: decoded.tenantId,
          hasTenantId: !!decoded.tenantId,
        },
        'Decoded WebSocket connection token claims',
      );

      // Reject non-admin connections without tenantId
      if (
        !decoded.tenantId &&
        decoded.role !== 'SUPER_ADMIN' &&
        decoded.role !== 'ADMIN'
      ) {
        this.logger.warn(
          { clientId },
          'WebSocket connection rejected: Missing tenant context',
        );
        ws.close(4001, 'Unauthorized: Missing Tenant Context');
        return;
      }

      const subscriptions = new Set<string>();
      if (decoded.role === 'SUPER_ADMIN' || decoded.role === 'ADMIN') {
        subscriptions.add('*');
      } else if (decoded.tenantId) {
        subscriptions.add(`task:created:${decoded.tenantId}`);
        subscriptions.add(`node:heartbeat:${decoded.tenantId}`);
      }

      const client: Client = {
        id: clientId,
        ws,
        subscriptions,
        isAuthenticated: true,
        userId: decoded.id,
        connectedAt: new Date(),
        lastPing: new Date(),
        isAlive: true,
        tenantId: decoded.tenantId,
      };

      this.clients.set(clientId, client);
      this.logger.info(
        { clientId, userId: decoded.id, totalClients: this.clients.size },
        'WebSocket client connected and authenticated',
      );

      // Send welcome message
      this.sendToClient(client, 'connected', {
        clientId,
        userId: decoded.id,
      });

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
          this.handleMessage(client, message);
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
        // Cache the disconnected client session state for 2 minutes
        this.disconnectedClients.set(clientId, {
          id: clientId,
          subscriptions: client.subscriptions,
          userId: client.userId,
          tenantId: client.tenantId,
          disconnectedAt: new Date(),
        });

        setTimeout(() => {
          this.disconnectedClients.delete(clientId);
        }, 120000);

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
    } catch (error) {
      this.logger.warn(
        { clientId, error: (error as Error).message },
        'WebSocket connection rejected: Invalid token',
      );
      ws.close(4001, 'Unauthorized');
    }
  }

  private handleMessage(
    client: Client,
    message: { type: string; payload?: unknown },
  ): void {
    // Require authentication for all messages
    if (!client.isAuthenticated) {
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
      case 'ping':
        this.sendToClient(client, 'pong', {
          timestamp: new Date().toISOString(),
        });
        break;
      case 'reconnect':
        this.handleReconnect(
          client,
          message.payload as { previousConnectionId: string },
        );
        break;
      default:
        this.logger.warn(
          { clientId: client.id, type: message.type },
          'Unknown WebSocket message type',
        );
    }
  }

  private handleReconnect(
    client: Client,
    payload: { previousConnectionId: string },
  ): void {
    if (!payload?.previousConnectionId) {
      return this.sendToClient(client, 'error', {
        message: 'Invalid reconnect payload',
      });
    }

    const previousId = payload.previousConnectionId;
    const prevClient = this.disconnectedClients.get(previousId);

    if (prevClient) {
      // Restore subscriptions
      for (const sub of prevClient.subscriptions) {
        client.subscriptions.add(sub);
      }

      // Remove from cache
      this.disconnectedClients.delete(previousId);

      this.logger.info(
        {
          clientId: client.id,
          previousConnectionId: previousId,
          restoredSubscriptions: Array.from(client.subscriptions),
        },
        'WebSocket session resumed successfully',
      );

      this.sendToClient(client, 'reconnected', {
        previousConnectionId: previousId,
        subscriptionsRestored: Array.from(client.subscriptions),
      });
    } else {
      this.logger.warn(
        { clientId: client.id, previousConnectionId: previousId },
        'WebSocket session resumption failed: Session not found',
      );
      this.sendToClient(client, 'error', {
        message: 'Session expired or not found',
      });
    }
  }

  private handleSubscribe(
    client: Client,
    payload: { channels: string[] },
  ): void {
    if (!payload?.channels || !Array.isArray(payload.channels)) {
      return this.sendToClient(client, 'error', {
        message: 'Invalid subscribe payload',
      });
    }

    const approvedChannels: string[] = [];
    for (const channel of payload.channels) {
      if (client.tenantId && !channel.endsWith(`:${client.tenantId}`)) {
        this.logger.warn(
          { clientId: client.id, channel, tenantId: client.tenantId },
          'Tenant isolation violation: subscription denied',
        );
        continue;
      }
      client.subscriptions.add(channel);
      approvedChannels.push(channel);

      // Trigger initial snapshot for node channels
      if (channel.startsWith('node:nodes:')) {
        const parsedTenantId = channel.split(':').pop();
        if (parsedTenantId) {
          void (async () => {
            try {
              const { prisma } = await import('../index.js');
              if (prisma) {
                const nodes = await prisma.edgeNode.findMany({
                  where: { tenantId: parsedTenantId },
                });
                this.sendToClient(client, 'snapshot', {
                  channel,
                  data: nodes,
                });
                this.logger.info(
                  { clientId: client.id, channel },
                  'Sent node snapshot',
                );
              }
            } catch (err) {
              this.logger.error(
                { err, channel },
                'Failed to fetch node snapshot for subscription',
              );
            }
          })();
        }
      }
    }

    this.sendToClient(client, 'subscribed', { channels: approvedChannels });
    this.logger.debug(
      { clientId: client.id, channels: approvedChannels },
      'Client subscribed to channels',
    );
  }

  private handleUnsubscribe(
    client: Client,
    payload: { channels: string[] },
  ): void {
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

  private sendToClient(client: Client, type: string, payload: unknown): void {
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
   * Broadcast to local clients only.
   *
   * Tenant-scoping rules for wildcard '*' subscribers:
   * - If `broadcastTenantId` is provided, a client subscribed to '*' only
   *   receives the message if `client.tenantId` matches it, OR if the client
   *   has no tenantId (SUPER_ADMIN — privileged cross-tenant view).
   * - If `broadcastTenantId` is omitted, all '*' subscribers receive the event
   *   (intentionally global events such as ml:retrain:status, policy:update).
   */
  broadcastLocally(
    channel: string,
    payload: unknown,
    excludeClientId?: string,
    broadcastTenantId?: string,
  ): void {
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

      const isExactSubscriber = client.subscriptions.has(channel);
      const isWildcardSubscriber = client.subscriptions.has('*');

      if (isExactSubscriber) {
        // Exact channel match — always deliver
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(messageStr);
          sent++;
        }
      } else if (isWildcardSubscriber && broadcastTenantId) {
        // Wildcard subscriber receiving a tenant-scoped event:
        // deliver only if this client belongs to the same tenant,
        // OR if the client has no tenantId (SUPER_ADMIN — cross-tenant access).
        const clientCanReceive =
          !client.tenantId || client.tenantId === broadcastTenantId;
        if (clientCanReceive && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(messageStr);
          sent++;
        }
      } else if (isWildcardSubscriber && !broadcastTenantId) {
        // Global (un-scoped) event — deliver to all wildcard subscribers
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(messageStr);
          sent++;
        }
      }
    }

    this.logger.debug({ channel, clients: sent }, 'Local broadcast');
  }

  /**
   * Broadcast a message to all connected clients, optionally scoped to a tenant.
   *
   * @param channel  - The event type / channel name (e.g. 'task:started').
   * @param payload  - Arbitrary event payload.
   * @param tenantId - When provided the message is published on a tenant-scoped
   *                   Redis channel (`{channel}:{tenantId}`) and only delivered
   *                   to clients that are subscribed to that scoped channel or
   *                   to the global '*' wildcard AND belong to the same tenant
   *                   (SUPER_ADMIN clients without a tenantId see all events).
   *                   Omit for system-wide events that are intentionally
   *                   cross-tenant (e.g. ml:retrain:status, policy:update).
   * @param excludeClientId - Optional WebSocket client ID to skip during local delivery.
   */
  broadcast(
    channel: string,
    payload: unknown,
    tenantId?: string,
    excludeClientId?: string,
  ): void {
    const redisChannel = tenantId
      ? `${channel}:${tenantId}`
      : REDIS_PUBSUB_CHANNEL;
    const targetChannel = tenantId ? `${channel}:${tenantId}` : channel;

    // First, broadcast locally to connected clients on this instance
    this.broadcastLocally(targetChannel, payload, excludeClientId, tenantId);

    // Then fan-out to other instances via Redis Pub/Sub
    if (this.redis) {
      let publishPayload: any = payload;
      if (tenantId && typeof payload === 'object' && payload !== null) {
        publishPayload = { ...payload, tenantId };
      }

      const clusterMsg = {
        instanceId: this.instanceId,
        channel: targetChannel,
        payload: publishPayload,
        excludeSender: excludeClientId,
      };

      this.redis
        .publish(redisChannel, JSON.stringify(clusterMsg))
        .catch((error) => {
          this.logger.error({ error }, 'Failed to publish cluster message');
        });
    }
  }


  broadcastToUser(userId: string, type: string, payload: unknown): void {
    for (const client of this.clients.values()) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(client, type, payload);
      }
    }
  }

  broadcastToTenant(tenantId: TenantId, type: string, payload: unknown): void {
    for (const client of this.clients.values()) {
      if (
        client.tenantId === tenantId &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        this.sendToClient(client, type, payload);
      }
    }
  }

  getStats(): any {
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

  close(): void {
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
