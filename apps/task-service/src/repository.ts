import { Pool, QueryResult } from 'pg';
import { Task, CreateTaskCommand, TaskStatus } from '@edgecloud/shared-kernel';

export interface TaskRepository {
  create(command: CreateTaskCommand): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  findAll(options: { status?: TaskStatus; limit: number; offset: number }): Promise<Task[]>;
  updateStatus(id: string, status: TaskStatus, updates?: Partial<Task>): Promise<Task | null>;
  countByStatus(status: TaskStatus): Promise<number>;
  countAll(): Promise<number>;
}

export class PostgresTaskRepository implements TaskRepository {
  constructor(private pool: Pool) {}

  async create(command: CreateTaskCommand): Promise<Task> {
    const query = `
      INSERT INTO tasks (
        id, name, type, status, priority, target, node_id, policy, reason,
        input, metadata, max_retries, retry_count, region, submitted_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, 'PENDING', $3, $4, $5, 'auto', 'Task created',
        $6, $7, $8, 0, $9, NOW(), NOW(), NOW()
      ) RETURNING *
    `;

    const values = [
      command.name,
      command.type,
      command.priority,
      command.target || 'EDGE',
      command.nodeId || null,
      JSON.stringify(command.input || {}),
      JSON.stringify(command.metadata || {}),
      command.maxRetries || 3,
      'us-east', // Default region
    ];

    const result = await this.pool.query(query, values);
    return this.mapRowToTask(result.rows[0]);
  }

  async findById(id: string): Promise<Task | null> {
    const result = await this.pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    return this.mapRowToTask(result.rows[0]);
  }

  async findAll(options: { status?: TaskStatus; limit: number; offset: number }): Promise<Task[]> {
    let query = 'SELECT * FROM tasks';
    const values: any[] = [];

    if (options.status) {
      query += ' WHERE status = $1';
      values.push(options.status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2);
    values.push(options.limit, options.offset);

    const result = await this.pool.query(query, values);
    return result.rows.map((row) => this.mapRowToTask(row));
  }

  async updateStatus(
    id: string,
    status: TaskStatus,
    updates?: Partial<Task>
  ): Promise<Task | null> {
    const setClauses: string[] = ['status = $1', 'updated_at = NOW()'];
    const values: any[] = [status];

    if (updates?.nodeId) {
      setClauses.push(`node_id = $${values.length + 1}`);
      values.push(updates.nodeId);
    }

    if (updates?.executionTimeMs) {
      setClauses.push(`execution_time_ms = $${values.length + 1}`);
      values.push(updates.executionTimeMs);
    }

    if (updates?.cost) {
      setClauses.push(`cost = $${values.length + 1}`);
      values.push(updates.cost);
    }

    // Add timestamp based on status
    switch (status) {
      case 'SCHEDULED':
        setClauses.push('scheduled_at = NOW()');
        break;
      case 'RUNNING':
        setClauses.push('started_at = NOW()');
        break;
      case 'COMPLETED':
        setClauses.push('completed_at = NOW()');
        break;
      case 'FAILED':
        setClauses.push('failed_at = NOW()');
        break;
      case 'CANCELLED':
        setClauses.push('cancelled_at = NOW()');
        break;
    }

    values.push(id);
    const query = `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`;

    const result = await this.pool.query(query, values);
    if (result.rows.length === 0) return null;
    return this.mapRowToTask(result.rows[0]);
  }

  async countByStatus(status: TaskStatus): Promise<number> {
    const result = await this.pool.query('SELECT COUNT(*) FROM tasks WHERE status = $1', [status]);
    return parseInt(result.rows[0].count, 10);
  }

  async countAll(): Promise<number> {
    const result = await this.pool.query('SELECT COUNT(*) FROM tasks');
    return parseInt(result.rows[0].count, 10);
  }

  private mapRowToTask(row: any): Task {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      priority: row.priority,
      target: row.target,
      nodeId: row.node_id,
      policy: row.policy,
      reason: row.reason,
      input: row.input,
      output: row.output,
      metadata: row.metadata,
      maxRetries: row.max_retries,
      retryCount: row.retry_count,
      submittedAt: row.submitted_at,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      failedAt: row.failed_at,
      cancelledAt: row.cancelled_at,
      executionTimeMs: row.execution_time_ms,
      cost: row.cost,
      region: row.region,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
