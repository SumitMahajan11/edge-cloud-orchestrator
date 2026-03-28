// WebSocket client for real-time communication with the backend

type MessageHandler = (data: any) => void
type ConnectionHandler = () => void
type ErrorHandler = (error: Event) => void

interface WebSocketMessage {
  type: string
  channel?: string
  data?: any
  timestamp?: string
}

class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private messageQueue: WebSocketMessage[] = []
  private subscriptions: Map<string, Set<MessageHandler>> = new Map()
  private connectionHandlers: Set<ConnectionHandler> = new Set()
  private disconnectionHandlers: Set<ConnectionHandler> = new Set()
  private errorHandlers: Set<ErrorHandler> = new Set()
  private isConnecting = false
  private token: string | null = null

  constructor(url: string) {
    this.url = url
  }

  setToken(token: string | null) {
    this.token = token
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      if (this.isConnecting) {
        const checkConnected = () => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            resolve()
          } else {
            setTimeout(checkConnected, 100)
          }
        }
        checkConnected()
        return
      }

      this.isConnecting = true

      try {
        const wsUrl = this.token 
          ? `${this.url}?token=${this.token}`
          : this.url
        
        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = () => {
          console.log('[WebSocket] Connected')
          this.isConnecting = false
          this.reconnectAttempts = 0
          
          // Send queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift()
            if (msg) this.send(msg)
          }

          // Resubscribe to channels
          this.subscriptions.forEach((_, channel) => {
            this.send({ type: 'subscribe', channel })
          })

          // Start ping interval
          this.startPing()
          
          this.connectionHandlers.forEach(handler => handler())
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data)
            this.handleMessage(message)
          } catch (error) {
            console.error('[WebSocket] Failed to parse message:', error)
          }
        }

        this.ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error)
          this.isConnecting = false
          this.errorHandlers.forEach(handler => handler(error))
          reject(error)
        }

        this.ws.onclose = () => {
          console.log('[WebSocket] Disconnected')
          this.isConnecting = false
          this.stopPing()
          this.disconnectionHandlers.forEach(handler => handler())
          this.scheduleReconnect()
        }
      } catch (error) {
        this.isConnecting = false
        reject(error)
      }
    })
  }

  private handleMessage(message: WebSocketMessage) {
    const { type, channel, data } = message

    if (channel) {
      const handlers = this.subscriptions.get(channel)
      if (handlers) {
        handlers.forEach(handler => handler(data || message))
      }
    }

    // Handle specific message types
    switch (type) {
      case 'node:status':
        this.notifySubscribers('nodes', data)
        break
      case 'task:update':
        this.notifySubscribers('tasks', data)
        break
      case 'metrics:update':
        this.notifySubscribers('metrics', data)
        break
      case 'alert':
        this.notifySubscribers('alerts', data)
        break
      case 'workflow:progress':
        this.notifySubscribers('workflows', data)
        break
      case 'fl:round':
        this.notifySubscribers('federated-learning', data)
        break
    }
  }

  private notifySubscribers(channel: string, data: any) {
    const handlers = this.subscriptions.get(channel)
    if (handlers) {
      handlers.forEach(handler => handler(data))
    }
  }

  private send(message: WebSocketMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      this.messageQueue.push(message)
    }
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' })
    }, 30000) // Ping every 30 seconds
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached')
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    
    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
    
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(console.error)
    }, delay)
  }

  // Public API

  subscribe(channel: string, handler: MessageHandler): () => void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set())
      this.send({ type: 'subscribe', channel })
    }
    
    this.subscriptions.get(channel)!.add(handler)

    // Return unsubscribe function
    return () => {
      const handlers = this.subscriptions.get(channel)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          this.subscriptions.delete(channel)
          this.send({ type: 'unsubscribe', channel })
        }
      }
    }
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler)
    return () => this.connectionHandlers.delete(handler)
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectionHandlers.add(handler)
    return () => this.disconnectionHandlers.delete(handler)
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopPing()
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

// Singleton instance
import { config } from './realApi'

export const wsClient = new WebSocketClient(config.wsUrl)

// React hook for WebSocket
import { useEffect, useState, useCallback } from 'react'

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(wsClient.isConnected)
  const [error, setError] = useState<Event | null>(null)

  useEffect(() => {
    const unsubConnect = wsClient.onConnect(() => setIsConnected(true))
    const unsubDisconnect = wsClient.onDisconnect(() => setIsConnected(false))
    const unsubError = wsClient.onError((e) => setError(e))

    // Auto-connect if not connected
    if (!wsClient.isConnected) {
      wsClient.connect().catch(console.error)
    }

    return () => {
      unsubConnect()
      unsubDisconnect()
      unsubError()
    }
  }, [])

  const connect = useCallback(() => wsClient.connect(), [])
  const disconnect = useCallback(() => wsClient.disconnect(), [])

  return { isConnected, error, connect, disconnect }
}

// Hook for subscribing to a channel
export function useWebSocketChannel<T = any>(channel: string, handler: (data: T) => void) {
  useEffect(() => {
    const unsubscribe = wsClient.subscribe(channel, handler)
    return unsubscribe
  }, [channel, handler])
}
