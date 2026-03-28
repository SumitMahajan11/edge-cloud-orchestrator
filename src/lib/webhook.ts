import type { 
  WebhookConfig, 
  WebhookDelivery, 
  WebhookEventType, 
  WebhookPayload 
} from '../types/webhook'
import { webhooksApi } from './realApi'

const MAX_RETRIES = 3
const RETRY_DELAYS = [1000, 5000, 15000] // 1s, 5s, 15s

// Simple ID generator
const generateId = () => crypto.randomUUID()

class WebhookManager {
  private isProcessing = false
  private cache: WebhookConfig[] = []
  private deliveryCache: WebhookDelivery[] = []

  async createWebhook(config: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<WebhookConfig> {
    const response = await webhooksApi.create({
      name: config.name,
      url: config.url,
      events: config.events,
      secret: config.secret,
      enabled: config.enabled,
    })
    
    if (response.error || !response.data) {
      throw new Error(response.error || 'Failed to create webhook')
    }
    
    const webhook: WebhookConfig = {
      id: response.data.id,
      name: response.data.name,
      url: response.data.url,
      events: response.data.events as WebhookEventType[],
      secret: response.data.secret,
      enabled: response.data.enabled ?? true,
      createdAt: new Date(response.data.createdAt),
      updatedAt: new Date(response.data.createdAt),
      retryCount: config.retryCount || 3,
      timeoutMs: config.timeoutMs || 30000,
    }
    
    this.cache.push(webhook)
    return webhook
  }

  async updateWebhook(id: string, updates: Partial<WebhookConfig>): Promise<void> {
    const response = await webhooksApi.update(id, {
      name: updates.name,
      url: updates.url,
      events: updates.events,
      secret: updates.secret,
      enabled: updates.enabled,
    })
    
    if (response.error) {
      throw new Error(response.error)
    }
    
    // Update cache
    const index = this.cache.findIndex(w => w.id === id)
    if (index !== -1 && response.data) {
      this.cache[index] = {
        ...this.cache[index],
        ...updates,
        updatedAt: new Date(),
      }
    }
  }

  async deleteWebhook(id: string): Promise<void> {
    const response = await webhooksApi.delete(id)
    if (response.error) {
      throw new Error(response.error)
    }
    this.cache = this.cache.filter(w => w.id !== id)
  }

  async getWebhooks(): Promise<WebhookConfig[]> {
    const response = await webhooksApi.list()
    if (response.error || !response.data) {
      return this.cache // Return cached data on error
    }
    
    this.cache = response.data.map((w: any) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      events: w.events as WebhookEventType[],
      secret: w.secret,
      enabled: w.enabled ?? true,
      createdAt: new Date(w.createdAt),
      updatedAt: new Date(w.updatedAt || w.createdAt),
      retryCount: w.retryCount || 3,
      timeoutMs: w.timeoutMs || 30000,
    }))
    
    return this.cache
  }

  async getWebhook(id: string): Promise<WebhookConfig | undefined> {
    // Check cache first
    const cached = this.cache.find(w => w.id === id)
    if (cached) return cached
    
    // Refresh cache
    await this.getWebhooks()
    return this.cache.find(w => w.id === id)
  }

  async triggerEvent(event: WebhookEventType, data: unknown): Promise<void> {
    const webhooks = await this.getWebhooks()
    const enabledWebhooks = webhooks.filter(w => w.enabled && w.events.includes(event))

    for (const webhook of enabledWebhooks) {
      const payload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        data,
      }

      const delivery: WebhookDelivery = {
        id: generateId(),
        webhookId: webhook.id,
        webhookName: webhook.name,
        event,
        payload,
        status: 'pending',
        attemptCount: 0,
        createdAt: new Date(),
      }

      await this.queueDelivery(delivery)
    }
  }

  private async queueDelivery(delivery: WebhookDelivery): Promise<void> {
    this.deliveryCache.unshift(delivery)
    if (this.deliveryCache.length > 100) {
      this.deliveryCache = this.deliveryCache.slice(0, 100)
    }
    this.processQueue()
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return
    this.isProcessing = true

    try {
      const pending = this.deliveryCache.filter(d => d.status === 'pending')
      const retrying = this.deliveryCache.filter(d => d.status === 'retrying')
      
      const now = new Date()
      const dueForRetry = retrying.filter(d => !d.nextRetryAt || d.nextRetryAt <= now)

      const allDeliveries = [...pending, ...dueForRetry]

      for (const delivery of allDeliveries) {
        await this.executeDelivery(delivery)
      }
    } finally {
      this.isProcessing = false
      
      // Schedule next check if there are retrying deliveries
      const retrying = this.deliveryCache.filter(d => d.status === 'retrying')
      if (retrying.length > 0) {
        setTimeout(() => this.processQueue(), 1000)
      }
    }
  }

  private async executeDelivery(delivery: WebhookDelivery): Promise<void> {
    const webhook = await this.getWebhook(delivery.webhookId)
    if (!webhook || !webhook.enabled) {
      delivery.status = 'failed'
      delivery.errorMessage = 'Webhook disabled or deleted'
      delivery.completedAt = new Date()
      return
    }

    delivery.attemptCount++
    delivery.status = 'retrying'

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-ID': delivery.webhookId,
        'X-Webhook-Event': delivery.event,
        'X-Webhook-Attempt': delivery.attemptCount.toString(),
        ...webhook.headers,
      }

      // Add HMAC signature if secret is configured
      if (webhook.secret) {
        const signature = await this.generateSignature(
          JSON.stringify(delivery.payload),
          webhook.secret
        )
        headers['X-Webhook-Signature'] = signature
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), webhook.timeoutMs)

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(delivery.payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseBody = await response.text()

      if (response.ok) {
        delivery.status = 'success'
        delivery.responseStatus = response.status
        delivery.responseBody = responseBody
        delivery.completedAt = new Date()
      } else {
        throw new Error(`HTTP ${response.status}: ${responseBody}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      delivery.errorMessage = errorMessage

      if (delivery.attemptCount < Math.min(webhook.retryCount, MAX_RETRIES)) {
        delivery.status = 'retrying'
        const delay = RETRY_DELAYS[delivery.attemptCount - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1]
        delivery.nextRetryAt = new Date(Date.now() + delay)
      } else {
        delivery.status = 'failed'
        delivery.completedAt = new Date()
      }
    }
  }

  private async generateSignature(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
  }

  async getDeliveries(limit = 100): Promise<WebhookDelivery[]> {
    // Try to get from API first
    try {
      const response = await webhooksApi.getDeliveries('all', limit)
      if (response.data) {
        this.deliveryCache = response.data.map((d: any) => ({
          id: d.id,
          webhookId: d.webhookId,
          webhookName: d.webhookName || 'Unknown',
          event: d.event as WebhookEventType,
          payload: d.payload,
          status: d.status,
          attemptCount: d.attemptCount || 1,
          createdAt: new Date(d.createdAt),
          completedAt: d.completedAt ? new Date(d.completedAt) : undefined,
          responseStatus: d.responseStatus,
          responseBody: d.responseBody,
          errorMessage: d.errorMessage,
        }))
        return this.deliveryCache
      }
    } catch {
      // Fall back to local cache
    }
    return this.deliveryCache.slice(0, limit)
  }

  async retryDelivery(deliveryId: string): Promise<void> {
    const delivery = this.deliveryCache.find(d => d.id === deliveryId)
    if (!delivery) throw new Error('Delivery not found')

    if (delivery.status === 'failed') {
      delivery.status = 'pending'
      delivery.attemptCount = 0
      delivery.errorMessage = undefined
      delivery.completedAt = undefined
      delivery.nextRetryAt = undefined
      this.processQueue()
    }
  }

  async clearOldDeliveries(olderThanDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
    const oldDeliveries = this.deliveryCache.filter(d => 
      d.completedAt && d.completedAt < cutoff
    )

    this.deliveryCache = this.deliveryCache.filter(d => 
      !d.completedAt || d.completedAt >= cutoff
    )

    return oldDeliveries.length
  }
}

export const webhookManager = new WebhookManager()
