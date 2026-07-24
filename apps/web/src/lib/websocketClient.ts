// WebSocket client for real-time communication with the backend
import { authStorage } from "./auth-storage";
import { refreshAuth } from "./api-client";

type MessageHandler = (data: any) => void;
type ConnectionHandler = () => void;
type ErrorHandler = (error: Event) => void;

interface WebSocketMessage {
  type: string;
  channel?: string;
  data?: any;
  timestamp?: string;
}

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private messageQueue: WebSocketMessage[] = [];
  private pendingSubscriptions: Array<{
    channel: string;
    handler: MessageHandler;
  }> = [];
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private disconnectionHandlers: Set<ConnectionHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private isConnecting = false;
  private token: string | null = null;
  private intentionalDisconnect = false;

  constructor(url: string) {
    this.url = url;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.isConnecting) {
        const checkConnected = () => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            resolve();
          } else {
            setTimeout(checkConnected, 100);
          }
        };
        checkConnected();
        return;
      }

      this.isConnecting = true;

      try {
        // Retrieve fresh token from storage to handle reconnects/rotation
        if (typeof window !== "undefined") {
          const freshToken = authStorage.getToken();
          if (freshToken) {
            this.token = freshToken;
          }
        }

        const wsUrl = this.token ? `${this.url}?token=${this.token}` : this.url;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log("[WebSocket] Connected");
          this.isConnecting = false;
          this.reconnectAttempts = 0;

          // Send queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            if (msg) this.send(msg);
          }

          // Flush pending subscriptions (CRITICAL FIX: prevents race condition)
          this.flushPendingSubscriptions();

          // Start ping interval
          this.startPing();

          this.connectionHandlers.forEach((handler) => handler());
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error("[WebSocket] Failed to parse message:", error);
          }
        };

        this.ws.onerror = (error) => {
          console.error("[WebSocket] Error:", error);
          this.isConnecting = false;
          this.errorHandlers.forEach((handler) => handler(error));
          reject(error);
        };

        this.ws.onclose = (event) => {
          console.log(
            `[WebSocket] Disconnected: code=${event.code}, reason=${event.reason || "None"}`,
          );
          this.isConnecting = false;
          this.stopPing();
          this.disconnectionHandlers.forEach((handler) => handler());
          if (event.code === 4001) {
            console.warn(
              "[WebSocket] Connection unauthorized (4001). Attempting token refresh...",
            );
            refreshAuth().then((success) => {
              if (success) {
                const newToken = authStorage.getToken();
                if (newToken) this.setToken(newToken);
                this.reconnectAttempts = 0;
                this.scheduleReconnect();
              } else {
                // Clear stale token and signal auth layer
                this.token = null;
                this.reconnectAttempts = 0;
                if (typeof window !== "undefined") {
                  window.dispatchEvent(new Event("auth-unauthorized"));
                }
              }
            });
          } else if (!this.intentionalDisconnect) {
            this.scheduleReconnect();
          }

          if (this.intentionalDisconnect) {
            this.intentionalDisconnect = false;
          }
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private handleMessage(message: WebSocketMessage) {
    const { type, channel } = message;
    const data =
      message.data !== undefined ? message.data : (message as any).payload;

    if (type === "snapshot" && channel) {
      this.notifySubscribers(channel, data);
      return;
    }

    if (type === "broadcast" && channel) {
      this.notifySubscribers(channel, data);
      return;
    }

    if (channel) {
      this.notifySubscribers(channel, data || message);
    }

    // Helper to normalize data with its type tag for subscriber routing
    const normalizePayload = (inferredType: string, payloadData: any) => {
      if (payloadData && typeof payloadData === "object") {
        return { type: inferredType, ...payloadData };
      }
      return { type: inferredType, data: payloadData };
    };

    // Handle generic message types for backward compatibility or direct events
    switch (type) {
      case "node:status":
      case "node:status_changed":
        this.notifySubscribers("nodes", normalizePayload("node.status", data));
        break;
      case "node:heartbeat":
        this.notifySubscribers(
          "nodes",
          normalizePayload("node.heartbeat", data),
        );
        break;
      case "task:created":
        this.notifySubscribers("tasks", normalizePayload("task.created", data));
        break;
      case "task:cancelled":
        this.notifySubscribers(
          "tasks",
          normalizePayload("task.cancelled", data),
        );
        break;
      case "task:started":
        this.notifySubscribers("tasks", normalizePayload("task.running", data));
        break;
      case "task:completed":
        this.notifySubscribers(
          "tasks",
          normalizePayload("task.completed", data),
        );
        break;
      case "task:failed":
        this.notifySubscribers("tasks", normalizePayload("task.failed", data));
        break;
      case "scheduler:decision":
        this.notifySubscribers(
          "scheduler",
          normalizePayload("scheduler.decision", data),
        );
        break;
      case "ml:retrain:status":
        this.notifySubscribers(
          "ml",
          normalizePayload("ml.retrain_status", data),
        );
        break;
      case "policy:update":
        this.notifySubscribers(
          "scheduler",
          normalizePayload("scheduler.policy_updated", data),
        );
        break;
      default:
        // Try to infer channel from type prefix if possible
        if (type.startsWith("task:")) {
          const infType = type.replace(":", ".");
          this.notifySubscribers("tasks", normalizePayload(infType, data));
        } else if (type.startsWith("node:")) {
          const infType = type.replace(":", ".");
          this.notifySubscribers("nodes", normalizePayload(infType, data));
        } else if (type.startsWith("scheduler:")) {
          const infType = type.replace(":", ".");
          this.notifySubscribers("scheduler", normalizePayload(infType, data));
        } else if (type.startsWith("ml:")) {
          const infType = type.replace(":", ".");
          this.notifySubscribers("ml", normalizePayload(infType, data));
        }
        break;
    }
  }

  private notifySubscribers(channel: string, data: any) {
    const handlers = this.subscriptions.get(channel);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  /**
   * Flush pending subscriptions after connection
   * CRITICAL FIX: Prevents race condition where subscribe() called before connect() completes
   */
  private flushPendingSubscriptions(): void {
    console.log(
      `[WebSocket] Flushing ${this.pendingSubscriptions.length} pending subscriptions`,
    );

    for (const { channel, handler } of this.pendingSubscriptions) {
      // Add to subscriptions map if not already present
      if (!this.subscriptions.has(channel)) {
        this.subscriptions.set(channel, new Set());
      }

      // Add handler to the set
      this.subscriptions.get(channel)!.add(handler);

      // Send subscribe message to server
      this.send({ type: "subscribe", channel });
    }

    // Clear pending queue
    this.pendingSubscriptions = [];
  }

  private send(message: WebSocketMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, 30000); // Ping every 30 seconds
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    this.reconnectAttempts++;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const delay = Math.min(
      30000,
      1000 * Math.pow(2, this.reconnectAttempts - 1),
    );

    console.log(
      `[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        console.error("[WebSocket] Reconnect failed:", err);
        // scheduleReconnect will be called again by onclose if this fails
      });
    }, delay);
  }

  // Public API

  /**
   * Subscribe to a channel
   * CRITICAL: If not connected, subscription will be queued and flushed on connect
   */
  subscribe(channel: string, handler: MessageHandler): () => void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());

      // If not connected, queue the subscription to prevent race condition
      if (!this.isConnected) {
        console.log(
          `[WebSocket] Queueing subscription to "${channel}" (not connected yet)`,
        );
        this.pendingSubscriptions.push({ channel, handler });

        // Return unsubscribe function
        return () => {
          const idx = this.pendingSubscriptions.findIndex(
            (sub) => sub.channel === channel && sub.handler === handler,
          );
          if (idx !== -1) {
            this.pendingSubscriptions.splice(idx, 1);
          }
        };
      }

      // Connected - send immediately
      this.send({ type: "subscribe", channel });
    }

    this.subscriptions.get(channel)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.subscriptions.get(channel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscriptions.delete(channel);
          this.send({ type: "unsubscribe", channel });
        }
      }
    };
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectionHandlers.add(handler);
    return () => this.disconnectionHandlers.delete(handler);
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  disconnect() {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.reconnectAttempts = 0;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Configuration
const config = {
  wsUrl: (process.env.NEXT_PUBLIC_WS_URL as string) || "ws://localhost:3090/ws",
};

export const wsClient = new WebSocketClient(config.wsUrl);

// React hook for WebSocket
import { useEffect, useState, useCallback } from "react";

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(wsClient.isConnected);
  const [error, setError] = useState<Event | null>(null);

  useEffect(() => {
    const unsubConnect = wsClient.onConnect(() => setIsConnected(true));
    const unsubDisconnect = wsClient.onDisconnect(() => setIsConnected(false));
    const unsubError = wsClient.onError((e) => setError(e));

    // Don't auto-connect — connection should be triggered after authentication
    // Call wsClient.connect() explicitly when authenticated

    return () => {
      unsubConnect();
      unsubDisconnect();
      unsubError();
    };
  }, []);

  const connect = useCallback(() => wsClient.connect(), []);
  const disconnect = useCallback(() => wsClient.disconnect(), []);

  return { isConnected, error, connect, disconnect };
}

// Hook for subscribing to a channel
export function useWebSocketChannel<T = any>(
  channel: string,
  handler: (data: T) => void,
) {
  useEffect(() => {
    const unsubscribe = wsClient.subscribe(channel, handler);
    return unsubscribe;
  }, [channel, handler]);
}
