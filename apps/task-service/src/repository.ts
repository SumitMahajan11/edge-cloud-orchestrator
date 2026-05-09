import { CreateTaskCommand, Task, TaskStatus } from '@edgecloud/shared-kernel';
import { Pool, QueryResult } from 'pg';

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
        id, name, type, status, priority, target, "nodeId", policy, reason,
        input, metadata, "maxRetries", "submittedAt"
      ) VALUES (
        gen_random_uuid(), $1, $2, 'PENDING', $3, $4, $5, 'auto', 'Task created',
        $6, $7, $8, NOW()
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
    ];

    const result = await this.pool.query(query, values);
    return this.mapRowToTask(result.rows[0]);
  }

  async findById(id: string): Promise<Task | null> {
    const result = await this.pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (result.rows.length === 0) {return null;}
    return this.mapRowToTask(result.rows[0]);
  }

  async findAll(options: { status?: TaskStatus; limit: number; offset: number }): Promise<Task[]> {
    let query = 'SELECT * FROM tasks';
    const values: any[] = [];

    if (options.status) {
      query += ' WHERE status = $1';
      values.push(options.status);
    }

    query += ` ORDER BY "submittedAt" DESC LIMIT $${  values.length + 1  } OFFSET $${  values.length + 2}`;
    values.push(options.limit, options.offset);

    const result = await this.pool.query(query, values);
    return result.rows.map((row) => this.mapRowToTask(row));
  }

  async updateStatus(
    id: string,
    status: TaskStatus,
    updates?: Partial<Task>
  ): Promise<Task | null> {
    const setClauses: string[] = ['status = $1'];
    const values: any[] = [status];

    if (updates?.nodeId) {
      setClauses.push(`"nodeId" = $${values.length + 1}`);
      values.push(updates.nodeId);
    }

    // Add timestamp based on status (note: these are not in the default Prisma schema yet, 
    // but repository uses them. I should probably add them to the schema later.
    // For now, I'll only use what's in the schema or what's essential.)

    values.push(id);
    const query = `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`;

    const result = await this.pool.query(query, values);
    if (result.rows.length === 0) {return null;}
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
      nodeId: row.nodeId,
      policy: row.policy,
      reason: row.reason,
      input: row.input,
      output: row.output,
      metadata: row.metadata,
      maxRetries: row.maxRetries,
      retryCount: row.retryCount || 0,
      submittedAt: row.submittedAt,
      scheduledAt: row.scheduledAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      failedAt: row.failedAt,
      cancelledAt: row.cancelledAt,
      executionTimeMs: row.executionTimeMs,
      cost: row.cost,
      region: row.region || 'us-east',
      createdAt: row.createdAt || row.submittedAt,
      updatedAt: row.updatedAt || row.submittedAt,
    };
  }
}
