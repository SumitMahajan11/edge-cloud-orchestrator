import { EventEmitter } from 'eventemitter3';

export interface Checkpoint {
  id: string;
  taskId: string;
  state: any;
  metadata: {
    createdAt: Date;
    sequenceNumber: number;
    version: string;
  };
}

export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<void>;
  load(taskId: string, checkpointId?: string): Promise<Checkpoint | null>;
  list(taskId: string): Promise<Checkpoint[]>;
  delete(taskId: string, checkpointId?: string): Promise<void>;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private checkpoints: Map<string, Checkpoint[]> = new Map();

  async save(checkpoint: Checkpoint): Promise<void> {
    const taskCheckpoints = this.checkpoints.get(checkpoint.taskId) || [];
    taskCheckpoints.push(checkpoint);
    this.checkpoints.set(checkpoint.taskId, taskCheckpoints);
  }

  async load(taskId: string, checkpointId?: string): Promise<Checkpoint | null> {
    const taskCheckpoints = this.checkpoints.get(taskId) || [];
    
    if (checkpointId) {
      return taskCheckpoints.find(c => c.id === checkpointId) || null;
    }
    
    // Return latest checkpoint
    return taskCheckpoints.length > 0 
      ? taskCheckpoints[taskCheckpoints.length - 1] 
      : null;
  }

  async list(taskId: string): Promise<Checkpoint[]> {
    return [...(this.checkpoints.get(taskId) || [])];
  }

  async delete(taskId: string, checkpointId?: string): Promise<void> {
    if (checkpointId) {
      const taskCheckpoints = this.checkpoints.get(taskId) || [];
      const filtered = taskCheckpoints.filter(c => c.id !== checkpointId);
      this.checkpoints.set(taskId, filtered);
    } else {
      this.checkpoints.delete(taskId);
    }
  }
}

export class CheckpointManager extends EventEmitter {
  private store: CheckpointStore;
  private sequenceNumbers: Map<string, number> = new Map();

  constructor(store?: CheckpointStore) {
    super();
    this.store = store || new InMemoryCheckpointStore();
  }

  async createCheckpoint(taskId: string, state: any): Promise<Checkpoint> {
    const sequenceNumber = (this.sequenceNumbers.get(taskId) || 0) + 1;
    this.sequenceNumbers.set(taskId, sequenceNumber);

    const checkpoint: Checkpoint = {
      id: `cp-${taskId}-${Date.now()}-${sequenceNumber}`,
      taskId,
      state: this.serializeState(state),
      metadata: {
        createdAt: new Date(),
        sequenceNumber,
        version: '1.0',
      },
    };

    await this.store.save(checkpoint);
    
    this.emit('checkpointCreated', { taskId, checkpointId: checkpoint.id });
    
    return checkpoint;
  }

  async restoreFromCheckpoint(taskId: string, checkpointId?: string): Promise<any | null> {
    const checkpoint = await this.store.load(taskId, checkpointId);
    
    if (!checkpoint) {
      return null;
    }

    this.emit('checkpointRestored', { 
      taskId, 
      checkpointId: checkpoint.id,
      sequenceNumber: checkpoint.metadata.sequenceNumber 
    });

    return this.deserializeState(checkpoint.state);
  }

  async getCheckpoints(taskId: string): Promise<Checkpoint[]> {
    return this.store.list(taskId);
  }

  async deleteCheckpoint(taskId: string, checkpointId?: string): Promise<void> {
    await this.store.delete(taskId, checkpointId);
    this.emit('checkpointDeleted', { taskId, checkpointId });
  }

  async withCheckpoint<T>(
    taskId: string,
    fn: () => Promise<T>,
    getState: () => any,
    onRestore?: (state: any) => void
  ): Promise<T> {
    // Try to restore from checkpoint first
    const restoredState = await this.restoreFromCheckpoint(taskId);
    if (restoredState && onRestore) {
      onRestore(restoredState);
    }

    try {
      const result = await fn();
      
      // Create checkpoint on success
      await this.createCheckpoint(taskId, getState());
      
      return result;
    } catch (error) {
      // Create checkpoint on failure for potential retry
      await this.createCheckpoint(taskId, getState());
      throw error;
    }
  }

  private serializeState(state: any): any {
    // Deep clone to avoid reference issues
    return JSON.parse(JSON.stringify(state));
  }

  private deserializeState(state: any): any {
    return state;
  }
}

// Automatic checkpointing for long-running operations
export class AutomaticCheckpointing extends EventEmitter {
  private checkpointManager: CheckpointManager;
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(checkpointManager: CheckpointManager) {
    super();
    this.checkpointManager = checkpointManager;
  }

  start(
    taskId: string,
    getState: () => any,
    intervalMs: number = 30000
  ): void {
    if (this.intervals.has(taskId)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const state = getState();
        await this.checkpointManager.createCheckpoint(taskId, state);
        this.emit('autoCheckpoint', { taskId, timestamp: new Date() });
      } catch (error) {
        this.emit('autoCheckpointError', { taskId, error });
      }
    }, intervalMs);

    this.intervals.set(taskId, interval);
  }

  stop(taskId: string): void {
    const interval = this.intervals.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(taskId);
    }
  }

  stopAll(): void {
    for (const [taskId, interval] of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }
}
