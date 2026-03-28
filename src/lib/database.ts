import type { EdgeNode, Task, LogEntry, AuditLog } from '../types'
import type { WebhookConfig, WebhookDelivery } from '../types/webhook'

const DB_NAME = 'EdgeCloudOrchestratorDB'
const DB_VERSION = 1

interface DatabaseSchema {
  nodes: EdgeNode
  tasks: Task
  logs: LogEntry
  auditLogs: AuditLog
  webhooks: WebhookConfig
  webhookDeliveries: WebhookDelivery
}

class Database {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise
    if (this.db) return

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Nodes store
        if (!db.objectStoreNames.contains('nodes')) {
          const nodeStore = db.createObjectStore('nodes', { keyPath: 'id' })
          nodeStore.createIndex('status', 'status', { unique: false })
          nodeStore.createIndex('region', 'region', { unique: false })
        }

        // Tasks store
        if (!db.objectStoreNames.contains('tasks')) {
          const taskStore = db.createObjectStore('tasks', { keyPath: 'id' })
          taskStore.createIndex('status', 'status', { unique: false })
          taskStore.createIndex('nodeId', 'nodeId', { unique: false })
          taskStore.createIndex('submittedAt', 'submittedAt', { unique: false })
        }

        // Logs store
        if (!db.objectStoreNames.contains('logs')) {
          const logStore = db.createObjectStore('logs', { keyPath: 'id' })
          logStore.createIndex('timestamp', 'timestamp', { unique: false })
          logStore.createIndex('level', 'level', { unique: false })
        }

        // Audit logs store
        if (!db.objectStoreNames.contains('auditLogs')) {
          const auditStore = db.createObjectStore('auditLogs', { keyPath: 'id' })
          auditStore.createIndex('timestamp', 'timestamp', { unique: false })
          auditStore.createIndex('userId', 'userId', { unique: false })
          auditStore.createIndex('action', 'action', { unique: false })
        }

        // Webhooks store
        if (!db.objectStoreNames.contains('webhooks')) {
          const webhookStore = db.createObjectStore('webhooks', { keyPath: 'id' })
          webhookStore.createIndex('enabled', 'enabled', { unique: false })
        }

        // Webhook deliveries store
        if (!db.objectStoreNames.contains('webhookDeliveries')) {
          const deliveryStore = db.createObjectStore('webhookDeliveries', { keyPath: 'id' })
          deliveryStore.createIndex('webhookId', 'webhookId', { unique: false })
          deliveryStore.createIndex('status', 'status', { unique: false })
          deliveryStore.createIndex('event', 'event', { unique: false })
          deliveryStore.createIndex('createdAt', 'createdAt', { unique: false })
        }
      }
    })

    return this.initPromise
  }

  private getStore<T extends keyof DatabaseSchema>(
    storeName: T,
    mode: IDBTransactionMode = 'readonly'
  ): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(storeName, mode)
    return transaction.objectStore(storeName)
  }

  // Generic CRUD operations
  async add<T extends keyof DatabaseSchema>(
    storeName: T,
    data: DatabaseSchema[T]
  ): Promise<void> {
    await this.init()
    return new Promise((resolve, reject) => {
      const store = this.getStore(storeName, 'readwrite')
      const request = store.add(data)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async put<T extends keyof DatabaseSchema>(
    storeName: T,
    data: DatabaseSchema[T]
  ): Promise<void> {
    await this.init()
    return new Promise((resolve, reject) => {
      const store = this.getStore(storeName, 'readwrite')
      const request = store.put(data)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async get<T extends keyof DatabaseSchema>(
    storeName: T,
    id: string
  ): Promise<DatabaseSchema[T] | undefined> {
    await this.init()
    return new Promise((resolve, reject) => {
      const store = this.getStore(storeName)
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getAll<T extends keyof DatabaseSchema>(
    storeName: T
  ): Promise<DatabaseSchema[T][]> {
    await this.init()
    return new Promise((resolve, reject) => {
      const store = this.getStore(storeName)
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async delete<T extends keyof DatabaseSchema>(
    storeName: T,
    id: string
  ): Promise<void> {
    await this.init()
    return new Promise((resolve, reject) => {
      const store = this.getStore(storeName, 'readwrite')
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async clear<T extends keyof DatabaseSchema>(storeName: T): Promise<void> {
    await this.init()
    return new Promise((resolve, reject) => {
      const store = this.getStore(storeName, 'readwrite')
      const request = store.clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Query with index
  async query<T extends keyof DatabaseSchema>(
    storeName: T,
    indexName: string,
    value: string | number
  ): Promise<DatabaseSchema[T][]> {
    await this.init()
    return new Promise((resolve, reject) => {
      const store = this.getStore(storeName)
      const index = store.index(indexName)
      const request = index.getAll(value)
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  // Get recent items with limit
  async getRecent<T extends keyof DatabaseSchema>(
    storeName: T,
    limit: number,
    indexName = 'timestamp'
  ): Promise<DatabaseSchema[T][]> {
    await this.init()
    return new Promise((resolve, reject) => {
      const store = this.getStore(storeName)
      const index = store.index(indexName)
      const request = index.openCursor(null, 'prev')
      const results: DatabaseSchema[T][] = []

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor && results.length < limit) {
          results.push(cursor.value)
          cursor.continue()
        } else {
          resolve(results)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  // Close connection
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initPromise = null
    }
  }
}

export const db = new Database()

// Audit logging
export async function logAudit(
  userId: string,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  const auditLog: AuditLog = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    userId,
    action,
    details,
    ipAddress: '127.0.0.1', // In real app, get from request
    userAgent: navigator.userAgent,
  }

  try {
    await db.add('auditLogs', auditLog)
  } catch (error) {
    console.error('Failed to log audit:', error)
  }
}

// Export data
export async function exportData(): Promise<{
  nodes: EdgeNode[]
  tasks: Task[]
  logs: LogEntry[]
  exportedAt: string
}> {
  const [nodes, tasks, logs] = await Promise.all([
    db.getAll('nodes'),
    db.getAll('tasks'),
    db.getAll('logs'),
  ])

  return {
    nodes,
    tasks,
    logs,
    exportedAt: new Date().toISOString(),
  }
}

// Import data
export async function importData(data: {
  nodes?: EdgeNode[]
  tasks?: Task[]
  logs?: LogEntry[]
}): Promise<void> {
  const promises: Promise<void>[] = []

  if (data.nodes) {
    promises.push(...data.nodes.map(n => db.put('nodes', n)))
  }
  if (data.tasks) {
    promises.push(...data.tasks.map(t => db.put('tasks', t)))
  }
  if (data.logs) {
    promises.push(...data.logs.map(l => db.put('logs', l)))
  }

  await Promise.all(promises)
}
