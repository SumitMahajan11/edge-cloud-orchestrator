import { useState, useCallback, useEffect } from 'react'
import type { WebhookConfig, WebhookDelivery, WebhookEventType } from '../types/webhook'
import { webhookManager } from '../lib/webhook'
import { toast } from 'sonner'

export function useWebhooks() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadWebhooks = useCallback(async () => {
    try {
      const data = await webhookManager.getWebhooks()
      setWebhooks(data)
    } catch (error) {
      toast.error('Failed to load webhooks')
      console.error(error)
    }
  }, [])

  const loadDeliveries = useCallback(async () => {
    try {
      const data = await webhookManager.getDeliveries(100)
      setDeliveries(data)
    } catch (error) {
      console.error('Failed to load deliveries:', error)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      await Promise.all([loadWebhooks(), loadDeliveries()])
      setIsLoading(false)
    }
    load()
  }, [loadWebhooks, loadDeliveries])

  // Refresh deliveries periodically
  useEffect(() => {
    const interval = setInterval(loadDeliveries, 5000)
    return () => clearInterval(interval)
  }, [loadDeliveries])

  const createWebhook = useCallback(async (
    config: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<boolean> => {
    try {
      await webhookManager.createWebhook(config)
      await loadWebhooks()
      toast.success('Webhook created successfully')
      return true
    } catch (error) {
      toast.error('Failed to create webhook')
      console.error(error)
      return false
    }
  }, [loadWebhooks])

  const updateWebhook = useCallback(async (
    id: string,
    updates: Partial<WebhookConfig>
  ): Promise<boolean> => {
    try {
      await webhookManager.updateWebhook(id, updates)
      await loadWebhooks()
      toast.success('Webhook updated successfully')
      return true
    } catch (error) {
      toast.error('Failed to update webhook')
      console.error(error)
      return false
    }
  }, [loadWebhooks])

  const deleteWebhook = useCallback(async (id: string): Promise<boolean> => {
    try {
      await webhookManager.deleteWebhook(id)
      await loadWebhooks()
      toast.success('Webhook deleted successfully')
      return true
    } catch (error) {
      toast.error('Failed to delete webhook')
      console.error(error)
      return false
    }
  }, [loadWebhooks])

  const toggleWebhook = useCallback(async (id: string, enabled: boolean): Promise<void> => {
    await updateWebhook(id, { enabled })
  }, [updateWebhook])

  const retryDelivery = useCallback(async (deliveryId: string): Promise<void> => {
    try {
      await webhookManager.retryDelivery(deliveryId)
      await loadDeliveries()
      toast.success('Delivery queued for retry')
    } catch (error) {
      toast.error('Failed to retry delivery')
      console.error(error)
    }
  }, [loadDeliveries])

  const testWebhook = useCallback(async (webhookId: string): Promise<void> => {
    try {
      const webhook = await webhookManager.getWebhook(webhookId)
      if (!webhook) {
        toast.error('Webhook not found')
        return
      }

      await webhookManager.triggerEvent('metrics.updated', {
        nodesOnline: 5,
        totalNodes: 8,
        tasksCompleted: 100,
        tasksFailed: 2,
        avgLatency: 45.5,
        totalCost: 12.34,
        healthScore: 95,
      })

      toast.success('Test event sent')
      
      // Refresh deliveries after a short delay
      setTimeout(loadDeliveries, 1000)
    } catch (error) {
      toast.error('Failed to send test event')
      console.error(error)
    }
  }, [loadDeliveries])

  const stats = {
    total: webhooks.length,
    enabled: webhooks.filter(w => w.enabled).length,
    recentDeliveries: deliveries.filter(d => 
      d.createdAt > new Date(Date.now() - 24 * 60 * 60 * 1000)
    ).length,
    failedDeliveries: deliveries.filter(d => d.status === 'failed').length,
  }

  return {
    webhooks,
    deliveries,
    isLoading,
    stats,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    toggleWebhook,
    retryDelivery,
    testWebhook,
    refresh: loadWebhooks,
  }
}

// Hook to trigger webhook events from components
export function useWebhookTrigger() {
  const triggerEvent = useCallback(async (event: WebhookEventType, data: unknown) => {
    try {
      await webhookManager.triggerEvent(event, data)
    } catch (error) {
      console.error('Failed to trigger webhook event:', error)
    }
  }, [])

  return { triggerEvent }
}
