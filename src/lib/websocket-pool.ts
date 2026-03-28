type WebSocketState = 'connecting' | 'open' | 'closing' | 'closed'

interface WebSocketConnection {
  id: string
  url: string
  socket: WebSocket | null
  state: WebSocketState
  lastUsed: number
  messageQueue: string[]
  reconnectAttempts: number
  subscriptions: Set<string>
}

interface PoolConfig {
  maxConnections?: number
  maxConnectionsPerHost?: number
  reconnectInterval?: number
  maxReconnectAttempts?: number
  connectionTimeout?: number
  idleTimeout?: number
}

interface MessageHandler {
  (data: unknown): void
}

const DEFAULT_CONFIG: Required<PoolConfig> = {
  maxConnections: 50,
  maxConnectionsPerHost: 10,
  reconnectInterval: 3000,
  maxReconnectAttempts: 5,
  connectionTimeout: 10000,
  idleTimeout: 300000, // 5 minutes
}

class WebSocketPool {
  private connections: Map<string, WebSocketConnection> = new Map()
  private handlers: Map<string, Set<MessageHandler>> = new Map()
  private config: Required<PoolConfig>
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: PoolConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.startCleanup()
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections()
    }, 60000) // Cleanup every minute
  }

  private cleanupIdleConnections(): void {
    const now = Date.now()
    const idleThreshold = this.config.idleTimeout

    for (const [id, conn] of this.connections) {
      if (conn.state === 'open' && now - conn.lastUsed > idleThreshold) {
        if (conn.subscriptions.size === 0) {
          this.closeConnection(id)
        }
      }
    }
  }

  async acquire(url: string, subscription?: string): Promise<string> {
    // Check existing connections to same host
    const hostConnections = Array.from(this.connections.values()).filter(
      c => c.url === url && c.state === 'open'
    )

    // Reuse existing connection if available
    if (hostConnections.length > 0) {
      const conn = hostConnections[0]
      if (subscription) {
        conn.subscriptions.add(subscription)
      }
      conn.lastUsed = Date.now()
      return conn.id
    }

    // Check connection limits
    if (this.connections.size >= this.config.maxConnections) {
      throw new Error('Maximum WebSocket connections reached')
    }

    const hostCount = hostConnections.length
    if (hostCount >= this.config.maxConnectionsPerHost) {
      throw new Error(`Maximum connections per host (${this.config.maxConnectionsPerHost}) reached`)
    }

    // Create new connection
    return this.createConnection(url, subscription)
  }

  private async createConnection(url: string, subscription?: string): Promise<string> {
    const id = `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const conn: WebSocketConnection = {
      id,
      url,
      socket: null,
      state: 'connecting',
      lastUsed: Date.now(),
      messageQueue: [],
      reconnectAttempts: 0,
      subscriptions: subscription ? new Set([subscription]) : new Set(),
    }

    this.connections.set(id, conn)
    await this.connect(conn)

    return id
  }

  private async connect(conn: WebSocketConnection): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'))
      }, this.config.connectionTimeout)

      try {
        const socket = new WebSocket(conn.url)
        conn.socket = socket

        socket.onopen = () => {
          clearTimeout(timeout)
          conn.state = 'open'
          conn.reconnectAttempts = 0
          this.flushMessageQueue(conn)
          resolve()
        }

        socket.onmessage = (event) => {
          this.handleMessage(conn, event.data)
        }

        socket.onclose = () => {
          conn.state = 'closed'
          this.handleDisconnect(conn)
        }

        socket.onerror = (error) => {
          clearTimeout(timeout)
          conn.state = 'closed'
          reject(error)
        }
      } catch (error) {
        clearTimeout(timeout)
        reject(error)
      }
    })
  }

  private handleMessage(conn: WebSocketConnection, data: string): void {
    conn.lastUsed = Date.now()

    try {
      const parsed = JSON.parse(data)

      // Notify subscription handlers
      conn.subscriptions.forEach(sub => {
        const handlers = this.handlers.get(sub)
        if (handlers) {
          handlers.forEach(handler => {
            try {
              handler(parsed)
            } catch (error) {
              console.error('Message handler error:', error)
            }
          })
        }
      })
    } catch {
      // Handle non-JSON messages
      console.log('Received non-JSON message:', data)
    }
  }

  private handleDisconnect(conn: WebSocketConnection): void {
    if (conn.reconnectAttempts < this.config.maxReconnectAttempts) {
      conn.reconnectAttempts++
      setTimeout(() => {
        if (conn.subscriptions.size > 0) {
          this.connect(conn).catch(() => {
            // Reconnection failed, will retry
          })
        }
      }, this.config.reconnectInterval * conn.reconnectAttempts)
    } else {
      this.connections.delete(conn.id)
    }
  }

  private flushMessageQueue(conn: WebSocketConnection): void {
    while (conn.messageQueue.length > 0 && conn.state === 'open') {
      const message = conn.messageQueue.shift()
      if (message) {
        conn.socket?.send(message)
      }
    }
  }

  send(connectionId: string, data: unknown): boolean {
    const conn = this.connections.get(connectionId)
    if (!conn) return false

    const message = typeof data === 'string' ? data : JSON.stringify(data)

    if (conn.state === 'open') {
      conn.socket?.send(message)
      conn.lastUsed = Date.now()
      return true
    } else {
      conn.messageQueue.push(message)
      return false
    }
  }

  subscribe(connectionId: string, topic: string, handler: MessageHandler): () => void {
    const conn = this.connections.get(connectionId)
    if (conn) {
      conn.subscriptions.add(topic)
    }

    // Register handler
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Set())
    }
    this.handlers.get(topic)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.unsubscribe(connectionId, topic, handler)
    }
  }

  private unsubscribe(connectionId: string, topic: string, handler: MessageHandler): void {
    const conn = this.connections.get(connectionId)
    if (conn) {
      conn.subscriptions.delete(topic)
    }

    const handlers = this.handlers.get(topic)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.handlers.delete(topic)
      }
    }
  }

  closeConnection(id: string): void {
    const conn = this.connections.get(id)
    if (!conn) return

    conn.state = 'closing'
    conn.socket?.close()
    this.connections.delete(id)

    // Clean up handlers
    conn.subscriptions.forEach(topic => {
      this.handlers.delete(topic)
    })
  }

  release(id: string): void {
    // Mark connection as idle but keep for reuse
    const conn = this.connections.get(id)
    if (conn) {
      conn.lastUsed = Date.now()
    }
  }

  getStats(): {
    total: number
    open: number
    connecting: number
    closing: number
    closed: number
    queuedMessages: number
  } {
    const stats = {
      total: this.connections.size,
      open: 0,
      connecting: 0,
      closing: 0,
      closed: 0,
      queuedMessages: 0,
    }

    for (const conn of this.connections.values()) {
      stats[conn.state]++
      stats.queuedMessages += conn.messageQueue.length
    }

    return stats
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    for (const id of this.connections.keys()) {
      this.closeConnection(id)
    }

    this.handlers.clear()
  }
}

// Singleton instance
export const websocketPool = new WebSocketPool()

export { WebSocketPool }
export type { WebSocketConnection, WebSocketState, PoolConfig, MessageHandler }
