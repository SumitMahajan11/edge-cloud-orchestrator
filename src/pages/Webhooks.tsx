import { useState } from 'react'
import { useWebhooks } from '../hooks/useWebhooks'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { 
  Plus, 
  Webhook, 
  Trash2, 
  Edit2, 
  Play, 
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import type { WebhookConfig, WebhookEventType } from '../types/webhook'

const EVENT_OPTIONS: { value: WebhookEventType; label: string }[] = [
  { value: 'task.scheduled', label: 'Task Scheduled' },
  { value: 'task.completed', label: 'Task Completed' },
  { value: 'task.failed', label: 'Task Failed' },
  { value: 'node.online', label: 'Node Online' },
  { value: 'node.offline', label: 'Node Offline' },
  { value: 'node.heartbeat', label: 'Node Heartbeat' },
  { value: 'alert.triggered', label: 'Alert Triggered' },
  { value: 'alert.resolved', label: 'Alert Resolved' },
  { value: 'metrics.updated', label: 'Metrics Updated' },
  { value: 'policy.changed', label: 'Policy Changed' },
]

export function Webhooks() {
  const { 
    webhooks, 
    deliveries, 
    isLoading, 
    stats,
    createWebhook, 
    updateWebhook, 
    deleteWebhook, 
    toggleWebhook,
    retryDelivery,
    testWebhook 
  } = useWebhooks()
  
  const [showForm, setShowForm] = useState(false)
  const [editingWebhook, setEditingWebhook] = useState<WebhookConfig | null>(null)
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    events: [] as WebhookEventType[],
    secret: '',
    enabled: true,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const config = {
      ...formData,
      secret: formData.secret || undefined,
      retryCount: 3,
      timeoutMs: 30000,
    }

    if (editingWebhook) {
      await updateWebhook(editingWebhook.id, config)
      setEditingWebhook(null)
    } else {
      await createWebhook(config)
    }

    setFormData({ name: '', url: '', events: [], secret: '', enabled: true })
    setShowForm(false)
  }

  const handleEdit = (webhook: WebhookConfig) => {
    setEditingWebhook(webhook)
    setFormData({
      name: webhook.name,
      url: webhook.url,
      events: webhook.events,
      secret: webhook.secret || '',
      enabled: webhook.enabled,
    })
    setShowForm(true)
  }

  const toggleEvent = (event: WebhookEventType) => {
    setFormData(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event]
    }))
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-success" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />
      case 'retrying':
        return <RotateCcw className="h-4 w-4 text-warning animate-spin" />
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Webhooks</h1>
          <p className="text-muted-foreground">
            Configure webhooks to receive real-time event notifications
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Webhook
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-sm text-muted-foreground">Total Webhooks</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-2xl font-bold text-success">{stats.enabled}</div>
          <div className="text-sm text-muted-foreground">Active</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-2xl font-bold">{stats.recentDeliveries}</div>
          <div className="text-sm text-muted-foreground">24h Deliveries</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-2xl font-bold text-destructive">{stats.failedDeliveries}</div>
          <div className="text-sm text-muted-foreground">Failed</div>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">
            {editingWebhook ? 'Edit Webhook' : 'New Webhook'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  placeholder="My Webhook"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">URL</label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  placeholder="https://api.example.com/webhook"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Events</label>
              <div className="flex flex-wrap gap-2">
                {EVENT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleEvent(option.value)}
                    className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                      formData.events.includes(option.value)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-input hover:border-primary'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Secret (optional, for HMAC signature)
              </label>
              <input
                type="password"
                value={formData.secret}
                onChange={(e) => setFormData({ ...formData, secret: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                placeholder="whsec_..."
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="rounded border-input"
              />
              <label htmlFor="enabled" className="text-sm">Enabled</label>
            </div>

            <div className="flex gap-2">
              <Button type="submit">
                {editingWebhook ? 'Update' : 'Create'} Webhook
              </Button>
              <Button 
                type="button" 
                variant="outline"
                onClick={() => {
                  setShowForm(false)
                  setEditingWebhook(null)
                  setFormData({ name: '', url: '', events: [], secret: '', enabled: true })
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Webhooks List */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Configured Webhooks</h2>
        {webhooks.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg">
            <Webhook className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No webhooks configured yet</p>
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => setShowForm(true)}
            >
              Add your first webhook
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map((webhook) => (
              <div 
                key={webhook.id}
                className="flex items-center justify-between p-4 rounded-lg border border-border bg-card"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{webhook.name}</span>
                    <Badge variant={webhook.enabled ? 'default' : 'secondary'}>
                      {webhook.enabled ? 'Active' : 'Disabled'}
                    </Badge>
                    {webhook.secret && (
                      <Badge variant="outline">Signed</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{webhook.url}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {webhook.events.map((event) => (
                      <span 
                        key={event}
                        className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground"
                      >
                        {event}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => testWebhook(webhook.id)}
                    className="gap-1"
                  >
                    <Play className="h-4 w-4" />
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleWebhook(webhook.id, !webhook.enabled)}
                  >
                    {webhook.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(webhook)}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteWebhook(webhook.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delivery History */}
      {deliveries.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Recent Deliveries</h2>
          <div className="space-y-2">
            {deliveries.slice(0, 20).map((delivery) => (
              <div 
                key={delivery.id}
                className="border border-border rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => setExpandedDelivery(
                    expandedDelivery === delivery.id ? null : delivery.id
                  )}
                  className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(delivery.status)}
                    <span className="font-medium">{delivery.event}</span>
                    <span className="text-sm text-muted-foreground">
                      {delivery.webhookName}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {delivery.attemptCount} attempt{delivery.attemptCount !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {new Date(delivery.createdAt).toLocaleString()}
                    </span>
                    {delivery.status === 'failed' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          retryDelivery(delivery.id)
                        }}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                    {expandedDelivery === delivery.id ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </button>
                
                {expandedDelivery === delivery.id && (
                  <div className="px-3 pb-3 border-t border-border bg-secondary/20">
                    <div className="mt-3 space-y-2">
                      <div>
                        <span className="text-xs font-medium text-muted-foreground">Payload:</span>
                        <pre className="mt-1 text-xs bg-background p-2 rounded overflow-auto max-h-40">
                          {JSON.stringify(delivery.payload, null, 2)}
                        </pre>
                      </div>
                      {delivery.responseStatus && (
                        <div>
                          <span className="text-xs font-medium text-muted-foreground">
                            Response ({delivery.responseStatus}):
                          </span>
                          <pre className="mt-1 text-xs bg-background p-2 rounded overflow-auto max-h-40">
                            {delivery.responseBody}
                          </pre>
                        </div>
                      )}
                      {delivery.errorMessage && (
                        <div className="flex items-start gap-2 text-destructive">
                          <AlertCircle className="h-4 w-4 mt-0.5" />
                          <span className="text-sm">{delivery.errorMessage}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
