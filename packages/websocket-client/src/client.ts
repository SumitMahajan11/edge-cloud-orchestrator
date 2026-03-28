/**
 * WebSocket Client with Auto-Reconnect and SSE Fallback
 * 
 * Usage:
 *   const client = new ResilientWebSocketClient('ws://localhost:3004/ws');
 *   client.on('message', (data) => console.log(data));
 *   client.subscribe(['tasks', 'nodes']);
 */

import { EventEmitter } from 'eventemitter3';

export interface WebSocketClientConfig {
  url: string;
  sseFallbackUrl?: string;
  reconnectBackoffBase?: number;
  reconnectBackoffMax?: number;
  heartbeatInterval?: number;
  maxReconnectAttempts?: number;
}

export type ConnectionType = 'websocket' | 'sse';

export class ResilientWebSocketClient extends EventEmitter {
  private config: Required<WebSocketClientConfig>;
  private ws: WebSocket | null = null;
  private eventSource: EventSource | null = null;
  private connectionType: ConnectionType = 'websocket';
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private subscriptions: Set<string> = new Set();
  private isConnecting = false;
  private isIntentionallyClosed = false;
  private connectionId: string | null = null;

  constructor(config: WebSocketClientConfig) {
    super();
    this.config = {
      url: config.url,
      sseFallbackUrl: config.sseFallbackUrl || config.url.replace('/ws', '/sse'),
      reconnectBackoffBase: config.reconnectBackoffBase || 1000,
      reconnectBackoffMax: config.reconnectBackoffMax || 30000,
      heartbeatInterval: config.heartbeatInterval || 30000,
      maxReconnectAttempts: config.maxReconnectAttempts || 10,
    };
  }

  async connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    this.isIntentionallyClosed = false;

    try {
      await this.connectWebSocket();
    } catch (error) {
      this.emit('websocket-failed', { error });
      
      // Fallback to SSE
      if (this.config.sseFallbackUrl) {
        this.emit('fallback-to-sse', {});
        this.connectSSE();
      }
    } finally {
      this.isConnecting = false;
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);
        this.connectionType = 'websocket';

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.emit('connected', { type: 'websocket' });
          
          // Restore subscriptions
          if (this.subscriptions.size > 0) {
            this.send({ type: 'subscribe', channels: Array.from(this.subscriptions) });
          }
          
          this.startHeartbeat();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            this.emit('error', { error, raw: event.data });
          }
        };

        this.ws.onclose = (event) => {
          this.stopHeartbeat();
          this.emit('disconnected', { code: event.code, reason: event.reason });
          
          if (!this.isIntentionallyClosed) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          this.emit('error', { type: 'websocket', error });
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private connectSSE(): void {
    try {
      const url = new URL(this.config.sseFallbackUrl);
      this.subscriptions.forEach(channel => url.searchParams.append('channels', channel));
      
      this.eventSource = new EventSource(url.toString());
      this.connectionType = 'sse';

      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
        this.emit('connected', { type: 'sse' });
      };

      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          this.emit('error', { error, raw: event.data });
        }
      };

      this.eventSource.onerror = (error) => {
        this.emit('error', { type: 'sse', error });
        
        if (this.eventSource?.readyState === EventSource.CLOSED) {
          this.emit('disconnected', { type: 'sse' });
          
          if (!this.isIntentionallyClosed) {
            this.scheduleReconnect();
          }
        }
      };
    } catch (error) {
      this.emit('error', { type: 'sse', error });
    }
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'connected':
        this.connectionId = message.connectionId;
        break;
      case 'ping':
        this.send({ type: 'pong', timestamp: Date.now() });
        break;
      case 'pong':
        // Heartbeat response
        break;
      case 'broadcast':
        this.emit('message', message.data);
        this.emit(`channel:${message.channel}`, message.data);
        break;
      default:
        this.emit('message', message);
    }
  }

  subscribe(channels: string[]): void {
    channels.forEach(channel => this.subscriptions.add(channel));
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe', channels });
    }
  }

  unsubscribe(channels: string[]): void {
    channels.forEach(channel => this.subscriptions.delete(channel));
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'unsubscribe', channels });
    }
  }

  private send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimeout = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimeout) {
      clearInterval(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.emit('reconnect-failed', { attempts: this.reconnectAttempts });
      return;
    }

    const delay = Math.min(
      this.config.reconnectBackoffBase * Math.pow(2, this.reconnectAttempts),
      this.config.reconnectBackoffMax
    );

    this.reconnectAttempts++;
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.emit('disconnected', { intentional: true });
  }

  getConnectionType(): ConnectionType {
    return this.connectionType;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN || 
           this.eventSource?.readyState === EventSource.OPEN;
  }
}

// Export for use in frontend
if (typeof window !== 'undefined') {
  (window as any).ResilientWebSocketClient = ResilientWebSocketClient;
}
