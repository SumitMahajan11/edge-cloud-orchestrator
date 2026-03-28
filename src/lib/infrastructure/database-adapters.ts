import { dbLogger as logger } from '../logger'

interface DatabaseAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>
  transaction<T>(fn: (trx: DatabaseAdapter) => Promise<T>): Promise<T>
  isConnected(): boolean
}

interface PostgresConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean
  poolSize?: number
}

interface QueryResult<T = unknown> {
  rows: T[]
  rowCount: number
}

// Check if running in Node.js environment (browser-safe check)
const isNode = typeof globalThis !== 'undefined' && 
  typeof (globalThis as { window?: unknown }).window === 'undefined'

// Type for pg Pool
interface PgPool {
  connect(): Promise<PgClient>
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>
  end(): Promise<void>
}

interface PgClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>
  release(): void
}

// Type for better-sqlite3
interface SqliteDatabase {
  prepare(sql: string): { all: (...params: unknown[]) => unknown[]; run: (...params: unknown[]) => { changes: number } }
  close(): void
}

// PostgreSQL Adapter (Node.js only - uses pg driver)
class PostgresAdapter implements DatabaseAdapter {
  private config: PostgresConfig
  private connected = false
  private pool: unknown = null

  constructor(config: PostgresConfig) {
    this.config = {
      poolSize: 10,
      ...config,
    }
  }

  async connect(): Promise<void> {
    if (!isNode) {
      logger.warn('PostgreSQL adapter not available in browser environment, using fallback')
      this.connected = true
      return
    }

    try {
      // Dynamic import for Node.js only - wrapped in try/catch for environments without pg
      const pgModule = await (async () => {
        try {
          // @ts-expect-error - Dynamic import of optional Node.js module
          return await import('pg')
        } catch {
          return null
        }
      })()
      
      if (!pgModule) {
        logger.warn('pg module not available, using mock connection')
        this.connected = true
        return
      }
      
      const Pool = pgModule.Pool as new (config: Record<string, unknown>) => PgPool
      
      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
        max: this.config.poolSize,
      } as Record<string, unknown>)

      // Test connection
      const client = await (this.pool as { connect: () => Promise<{ release: () => void }> }).connect()
      client.release()
      
      this.connected = true
      logger.info(`Connected to PostgreSQL at ${this.config.host}:${this.config.port}`)
    } catch (error) {
      logger.error('Failed to connect to PostgreSQL', error as Error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await (this.pool as { end: () => Promise<void> }).end()
      this.pool = null
    }
    this.connected = false
    logger.info('Disconnected from PostgreSQL')
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.connected) throw new Error('Not connected')
    
    if (!this.pool) {
      logger.warn('Pool not available, returning empty result')
      return []
    }

    const result = await (this.pool as { query: (sql: string, params?: unknown[]) => Promise<{ rows: T[] }> }).query(sql, params)
    logger.debug(`Query executed: ${sql.substring(0, 50)}...`, { rowCount: result.rows.length })
    return result.rows
  }

  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
    if (!this.connected) throw new Error('Not connected')
    
    if (!this.pool) {
      return { rowsAffected: 0 }
    }

    const result = await (this.pool as { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number }> }).query(sql, params)
    logger.debug(`Execute: ${sql.substring(0, 50)}...`, { rowsAffected: result.rowCount })
    return { rowsAffected: result.rowCount }
  }

  async transaction<T>(fn: (trx: DatabaseAdapter) => Promise<T>): Promise<T> {
    if (!this.pool) {
      return fn(this)
    }

    const client = await (this.pool as { connect: () => Promise<PostgresClient> }).connect()
    try {
      await client.query('BEGIN')
      const result = await fn(this)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  // Task-specific operations
  async saveTask(_task: unknown): Promise<void> {
    await this.execute(
      `INSERT INTO tasks (id, name, type, status, target, priority, submitted_at, duration, cost, node_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       duration = EXCLUDED.duration,
       cost = EXCLUDED.cost`,
      [] // Task params
    )
  }

  async getTasks(limit = 100, offset = 0): Promise<unknown[]> {
    return this.query(
      `SELECT * FROM tasks ORDER BY submitted_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    )
  }

  async getTaskStats(): Promise<{
    total: number
    pending: number
    running: number
    completed: number
    failed: number
  }> {
    const result = await this.query<{
      status: string
      count: string
    }>(`SELECT status, COUNT(*) as count FROM tasks GROUP BY status`)
    
    const stats = { total: 0, pending: 0, running: 0, completed: 0, failed: 0 }
    result.forEach(row => {
      const count = parseInt(row.count, 10)
      stats.total += count
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = count
      }
    })
    return stats
  }
}

interface PostgresClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>
  release: () => void
}

// SQLite Adapter (for local development)
class SQLiteAdapter implements DatabaseAdapter {
  private connected = false
  private dbPath: string
  private db: unknown = null

  constructor(dbPath = ':memory:') {
    this.dbPath = dbPath
  }

  async connect(): Promise<void> {
    if (isNode) {
      try {
        const sqliteModule = await (async () => {
          try {
            // @ts-expect-error - Dynamic import of optional Node.js module
            return await import('better-sqlite3')
          } catch {
            return null
          }
        })()
        if (sqliteModule) {
          const Database = sqliteModule.default as new (path: string) => SqliteDatabase
          this.db = new Database(this.dbPath)
          logger.info(`Opened SQLite database: ${this.dbPath}`)
        } else {
          logger.warn('better-sqlite3 not available, using in-memory fallback')
        }
      } catch {
        logger.warn('better-sqlite3 not available, using in-memory fallback')
      }
    }
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      (this.db as { close: () => void }).close()
      this.db = null
    }
    this.connected = false
    logger.info('Closed SQLite database')
  }

  async query<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
    if (!this.connected) throw new Error('Not connected')
    
    if (this.db) {
      const stmt = (this.db as { prepare: (sql: string) => { all: (...params: unknown[]) => T[] } }).prepare(_sql)
      return stmt.all(...(_params || []))
    }
    
    logger.debug(`SQLite query (mock): ${_sql.substring(0, 50)}...`)
    return []
  }

  async execute(_sql: string, _params?: unknown[]): Promise<{ rowsAffected: number }> {
    if (!this.connected) throw new Error('Not connected')
    
    if (this.db) {
      const stmt = (this.db as { prepare: (sql: string) => { run: (...params: unknown[]) => { changes: number } } }).prepare(_sql)
      const result = stmt.run(...(_params || []))
      return { rowsAffected: result.changes }
    }
    
    logger.debug(`SQLite execute (mock): ${_sql.substring(0, 50)}...`)
    return { rowsAffected: 0 }
  }

  async transaction<T>(fn: (trx: DatabaseAdapter) => Promise<T>): Promise<T> {
    // Fallback implementation for environments without native transaction support
    await this.execute('BEGIN TRANSACTION')
    try {
      const result = await fn(this)
      await this.execute('COMMIT')
      return result
    } catch (error) {
      await this.execute('ROLLBACK')
      throw error
    }
  }

  isConnected(): boolean {
    return this.connected
  }
}

// Database Manager
class DatabaseManager {
  private adapter: DatabaseAdapter | null = null
  private type: 'postgres' | 'sqlite' | 'indexeddb' = 'indexeddb'

  async initialize(type: 'postgres' | 'sqlite', config?: PostgresConfig): Promise<void> {
    this.type = type

    if (type === 'postgres' && config) {
      this.adapter = new PostgresAdapter(config)
    } else if (type === 'sqlite') {
      this.adapter = new SQLiteAdapter()
    } else {
      throw new Error(`Unsupported database type: ${type}`)
    }

    await this.adapter.connect()
    await this.migrate()
  }

  private async migrate(): Promise<void> {
    if (!this.adapter) return

    // Create tables
    await this.adapter.execute(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        target TEXT NOT NULL,
        priority TEXT NOT NULL,
        submitted_at TIMESTAMP NOT NULL,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        duration INTEGER,
        node_id TEXT,
        cost REAL,
        latency_ms INTEGER,
        reason TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        metadata TEXT
      )
    `)

    await this.adapter.execute(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        region TEXT NOT NULL,
        status TEXT NOT NULL,
        url TEXT NOT NULL,
        cpu REAL,
        memory REAL,
        storage REAL,
        latency REAL,
        uptime REAL,
        tasks_running INTEGER,
        max_tasks INTEGER,
        last_heartbeat TIMESTAMP,
        ip TEXT,
        cost_per_hour REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await this.adapter.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        user_id TEXT,
        user_email TEXT,
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT
      )
    `)

    console.log('Database migration completed')
  }

  getAdapter(): DatabaseAdapter {
    if (!this.adapter) throw new Error('Database not initialized')
    return this.adapter
  }

  async close(): Promise<void> {
    if (this.adapter) {
      await this.adapter.disconnect()
      this.adapter = null
    }
  }

  isConnected(): boolean {
    return this.adapter?.isConnected() ?? false
  }

  getType(): string {
    return this.type
  }
}

// Singleton instance
export const databaseManager = new DatabaseManager()

export { PostgresAdapter, SQLiteAdapter, DatabaseManager }
export type { DatabaseAdapter, PostgresConfig, QueryResult }
