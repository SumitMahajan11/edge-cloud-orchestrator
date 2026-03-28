import { describe, it, expect, beforeEach } from 'vitest';
import { CheckpointManager, InMemoryCheckpointStore } from '../src/checkpoint';

describe('CheckpointManager', () => {
  let manager: CheckpointManager;
  let store: InMemoryCheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
    manager = new CheckpointManager(store);
  });

  describe('save and load', () => {
    it('should save a checkpoint', async () => {
      await manager.save('task-1', { step: 1, data: 'test' });
      
      const checkpoint = await manager.load('task-1');
      
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.state).toEqual({ step: 1, data: 'test' });
    });

    it('should return null for non-existent checkpoint', async () => {
      const checkpoint = await manager.load('non-existent');
      
      expect(checkpoint).toBeNull();
    });

    it('should save multiple checkpoints for same task', async () => {
      await manager.save('task-1', { step: 1 });
      await manager.save('task-1', { step: 2 });
      
      const checkpoints = await manager.list('task-1');
      
      expect(checkpoints).toHaveLength(2);
    });

    it('should increment sequence numbers', async () => {
      const cp1 = await manager.save('task-1', { step: 1 });
      const cp2 = await manager.save('task-1', { step: 2 });
      
      expect(cp1.metadata.sequenceNumber).toBe(1);
      expect(cp2.metadata.sequenceNumber).toBe(2);
    });
  });

  describe('list', () => {
    it('should list all checkpoints for a task', async () => {
      await manager.save('task-1', { step: 1 });
      await manager.save('task-1', { step: 2 });
      await manager.save('task-2', { step: 1 });
      
      const checkpoints1 = await manager.list('task-1');
      const checkpoints2 = await manager.list('task-2');
      
      expect(checkpoints1).toHaveLength(2);
      expect(checkpoints2).toHaveLength(1);
    });

    it('should return empty array for task with no checkpoints', async () => {
      const checkpoints = await manager.list('no-checkpoints');
      
      expect(checkpoints).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should delete a specific checkpoint', async () => {
      await manager.save('task-1', { step: 1 });
      const cp2 = await manager.save('task-1', { step: 2 });
      
      await manager.delete('task-1', cp2.id);
      
      const checkpoints = await manager.list('task-1');
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].state).toEqual({ step: 1 });
    });

    it('should delete all checkpoints for a task', async () => {
      await manager.save('task-1', { step: 1 });
      await manager.save('task-1', { step: 2 });
      
      await manager.delete('task-1');
      
      const checkpoints = await manager.list('task-1');
      expect(checkpoints).toHaveLength(0);
    });
  });

  describe('getLatest', () => {
    it('should return the most recent checkpoint', async () => {
      await manager.save('task-1', { step: 1 });
      await manager.save('task-1', { step: 2 });
      await manager.save('task-1', { step: 3 });
      
      const latest = await manager.getLatest('task-1');
      
      expect(latest?.state).toEqual({ step: 3 });
    });

    it('should return null if no checkpoints exist', async () => {
      const latest = await manager.getLatest('no-checkpoints');
      
      expect(latest).toBeNull();
    });
  });
});

describe('InMemoryCheckpointStore', () => {
  let store: InMemoryCheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
  });

  it('should persist checkpoints in memory', async () => {
    const checkpoint = {
      id: 'cp-1',
      taskId: 'task-1',
      state: { data: 'test' },
      metadata: {
        createdAt: new Date(),
        sequenceNumber: 1,
        version: '1.0',
      },
    };
    
    await store.save(checkpoint);
    const loaded = await store.load('task-1');
    
    expect(loaded).toEqual(checkpoint);
  });

  it('should load specific checkpoint by id', async () => {
    await store.save({
      id: 'cp-1',
      taskId: 'task-1',
      state: { step: 1 },
      metadata: { createdAt: new Date(), sequenceNumber: 1, version: '1.0' },
    });
    await store.save({
      id: 'cp-2',
      taskId: 'task-1',
      state: { step: 2 },
      metadata: { createdAt: new Date(), sequenceNumber: 2, version: '1.0' },
    });
    
    const loaded = await store.load('task-1', 'cp-2');
    
    expect(loaded?.state).toEqual({ step: 2 });
  });
});
