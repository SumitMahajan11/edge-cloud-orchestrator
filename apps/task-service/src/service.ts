import { EventBus, TOPICS } from '@edgecloud/event-bus';
import {
  Task,
  CreateTaskCommand,
  TaskStatus,
  TaskCreatedEvent,
  TaskScheduledEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  TaskCancelledEvent,
  generateCorrelationId,
} from '@edgecloud/shared-kernel';
import { TaskRepository } from './repository';

export class TaskService {
  constructor(
    private repository: TaskRepository,
    private eventBus: EventBus
  ) {}

  async createTask(command: CreateTaskCommand): Promise<Task> {
    // Create task in database
    const task = await this.repository.create(command);

    // Publish TaskCreated event
    const event: TaskCreatedEvent = {
      eventId: '',
      eventType: 'TaskCreated',
      aggregateId: task.id,
      timestamp: new Date(),
      version: 1,
      taskId: task.id,
      name: task.name,
      type: task.type,
      priority: task.priority,
      target: task.target,
      region: task.region,
    };

    await this.eventBus.publish(TOPICS.TASK_EVENTS, event);

    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    return this.repository.findById(id);
  }

  async listTasks(options: {
    status?: TaskStatus;
    limit: number;
    offset: number;
  }): Promise<{ tasks: Task[]; total: number }> {
    const [tasks, total] = await Promise.all([
      this.repository.findAll(options),
      options.status
        ? this.repository.countByStatus(options.status)
        : this.repository.countAll(),
    ]);

    return { tasks, total };
  }

  async scheduleTask(
    taskId: string,
    nodeId: string,
    score: number
  ): Promise<Task | null> {
    const task = await this.repository.updateStatus(taskId, 'SCHEDULED', {
      nodeId,
    });

    if (!task) return null;

    // Publish TaskScheduled event
    const event: TaskScheduledEvent = {
      eventId: '',
      eventType: 'TaskScheduled',
      aggregateId: task.id,
      timestamp: new Date(),
      version: 1,
      taskId: task.id,
      nodeId,
      score,
      scheduledAt: new Date(),
    };

    await this.eventBus.publish(TOPICS.TASK_EVENTS, event);

    return task;
  }

  async startTask(taskId: string): Promise<Task | null> {
    return this.repository.updateStatus(taskId, 'RUNNING');
  }

  async completeTask(
    taskId: string,
    executionTimeMs: number,
    cost: number,
    output?: Record<string, unknown>
  ): Promise<Task | null> {
    const task = await this.repository.updateStatus(taskId, 'COMPLETED', {
      executionTimeMs,
      cost,
    });

    if (!task) return null;

    // Publish TaskCompleted event
    const event: TaskCompletedEvent = {
      eventId: '',
      eventType: 'TaskCompleted',
      aggregateId: task.id,
      timestamp: new Date(),
      version: 1,
      taskId: task.id,
      nodeId: task.nodeId!,
      executionTimeMs,
      cost,
      output,
      completedAt: new Date(),
    };

    await this.eventBus.publish(TOPICS.TASK_EVENTS, event);

    return task;
  }

  async failTask(
    taskId: string,
    error: string,
    retryCount: number,
    willRetry: boolean
  ): Promise<Task | null> {
    const task = await this.repository.findById(taskId);
    if (!task) return null;

    let newStatus: TaskStatus = 'FAILED';
    
    // Check if we should retry
    if (willRetry && retryCount < task.maxRetries) {
      newStatus = 'PENDING'; // Reset to pending for retry
    }

    const updatedTask = await this.repository.updateStatus(taskId, newStatus);

    if (!updatedTask) return null;

    // Publish TaskFailed event
    const event: TaskFailedEvent = {
      eventId: '',
      eventType: 'TaskFailed',
      aggregateId: task.id,
      timestamp: new Date(),
      version: 1,
      taskId: task.id,
      nodeId: task.nodeId!,
      error,
      retryCount,
      willRetry,
      failedAt: new Date(),
    };

    await this.eventBus.publish(TOPICS.TASK_EVENTS, event);

    return updatedTask;
  }

  async cancelTask(taskId: string, reason: string): Promise<Task | null> {
    const task = await this.repository.updateStatus(taskId, 'CANCELLED');

    if (!task) return null;

    // Publish TaskCancelled event
    const event: TaskCancelledEvent = {
      eventId: '',
      eventType: 'TaskCancelled',
      aggregateId: task.id,
      timestamp: new Date(),
      version: 1,
      taskId: task.id,
      reason,
      cancelledAt: new Date(),
    };

    await this.eventBus.publish(TOPICS.TASK_EVENTS, event);

    return task;
  }

  async getTaskStats(): Promise<{
    total: number;
    pending: number;
    scheduled: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  }> {
    const [
      pending,
      scheduled,
      running,
      completed,
      failed,
      cancelled,
    ] = await Promise.all([
      this.repository.countByStatus('PENDING'),
      this.repository.countByStatus('SCHEDULED'),
      this.repository.countByStatus('RUNNING'),
      this.repository.countByStatus('COMPLETED'),
      this.repository.countByStatus('FAILED'),
      this.repository.countByStatus('CANCELLED'),
    ]);

    return {
      total: pending + scheduled + running + completed + failed + cancelled,
      pending,
      scheduled,
      running,
      completed,
      failed,
      cancelled,
    };
  }
}
