import { SagaOrchestrator, SagaDefinition } from '../saga-orchestrator';

// Mock Redis client
class MockRedis {
  public store = new Map<string, string>();
  
  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }
  
  async set(key: string, value: string, ...args: any[]): Promise<string | null> {
    if (args.includes('NX') && this.store.has(key)) {
      return null;
    }
    this.store.set(key, value);
    return 'OK';
  }
  
  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        deleted++;
      }
    }
    return deleted;
  }
  
  async pexpire(key: string, ttl: number): Promise<number> {
    return this.store.has(key) ? 1 : 0;
  }
}

// Mock Prisma client
class MockPrisma {
  instances = new Map<string, any>();
  steps = new Map<string, any>();

  sagaInstance = {
    create: async ({ data }: any) => {
      const id = data.id || `saga-${Math.random().toString(36).substring(7)}`;
      const instance = {
        id,
        ...data,
        startedAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        error: null,
      };
      this.instances.set(id, instance);
      return instance;
    },
    update: async ({ where, data }: any) => {
      const inst = this.instances.get(where.id);
      if (!inst) throw new Error(`SagaInstance ${where.id} not found`);
      const updated = { ...inst, ...data, updatedAt: new Date() };
      this.instances.set(where.id, updated);
      return updated;
    },
    findUnique: async ({ where, include }: any) => {
      const inst = this.instances.get(where.id);
      if (!inst) return null;
      if (include?.steps) {
        const stepList = Array.from(this.steps.values())
          .filter((s: any) => s.sagaId === where.id)
          .sort((a: any, b: any) => a.stepOrder - b.stepOrder);
        return { ...inst, steps: stepList };
      }
      return inst;
    },
    findMany: async ({ where }: any = {}) => {
      let list = Array.from(this.instances.values());
      if (where?.status?.in) {
        list = list.filter((inst: any) => where.status.in.includes(inst.status));
      }
      return list;
    },
    count: async ({ where }: any = {}) => {
      let list = Array.from(this.instances.values());
      if (where?.status) {
        list = list.filter((inst: any) => inst.status === where.status);
      }
      return list.length;
    }
  };

  sagaStep = {
    create: async ({ data }: any) => {
      const id = `step-${Math.random().toString(36).substring(7)}`;
      const step = {
        id,
        attempts: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        output: null,
        ...data,
      };
      this.steps.set(id, step);
      return step;
    },
    update: async ({ where, data }: any) => {
      const step = this.steps.get(where.id);
      if (!step) throw new Error(`SagaStep ${where.id} not found`);
      const updated = { ...step, ...data };
      this.steps.set(where.id, updated);
      return updated;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const [id, step] of this.steps.entries()) {
        if (step.sagaId === where.sagaId && step.stepOrder === where.stepOrder) {
          this.steps.set(id, { ...step, ...data });
          count++;
        }
      }
      return { count };
    },
    findMany: async ({ where }: any) => {
      return Array.from(this.steps.values()).filter((s: any) => s.sagaId === where.sagaId);
    }
  };
}

describe('SagaOrchestrator', () => {
  let prisma: MockPrisma;
  let redis: MockRedis;
  let orchestrator: SagaOrchestrator;
  let mockLogger: any;

  beforeEach(() => {
    prisma = new MockPrisma();
    redis = new MockRedis();
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    orchestrator = new SagaOrchestrator(prisma as any, { recoveryIntervalMs: 100 }, redis as any, mockLogger);
    vi.useFakeTimers();
  });

  afterEach(() => {
    orchestrator.stopRecovery();
    vi.useRealTimers();
  });

  describe('Saga Registration', () => {
    it('should register a saga definition and emit registered event', () => {
      const registeredSpy = vi.fn();
      orchestrator.on('saga_registered', registeredSpy);

      const sagaDef: SagaDefinition<any> = {
        name: 'test-saga',
        steps: [
          {
            name: 'step1',
            execute: async () => ({}),
            compensate: async () => {},
          }
        ]
      };

      orchestrator.registerSaga(sagaDef);
      expect(registeredSpy).toHaveBeenCalledWith({ name: 'test-saga', steps: 1 });
    });
  });

  describe('Saga Execution Flow', () => {
    it('should execute a successful saga to completion', async () => {
      const step1Exec = vi.fn().mockResolvedValue({ step1Result: 'success' });
      const step2Exec = vi.fn().mockResolvedValue({ step2Result: 'success' });

      const sagaDef: SagaDefinition<any> = {
        name: 'success-saga',
        steps: [
          {
            name: 'step1',
            execute: step1Exec,
            compensate: async () => {},
          },
          {
            name: 'step2',
            execute: step2Exec,
            compensate: async () => {},
          }
        ]
      };

      orchestrator.registerSaga(sagaDef);

      const startedSpy = vi.fn();
      const completedSpy = vi.fn();
      orchestrator.on('saga_started', startedSpy);
      orchestrator.on('saga_completed', completedSpy);

      const instance = await orchestrator.startSaga('success-saga', 'corr-1', { inputVal: 42 }, 'tenant-1');
      expect(instance.status).toBe('STARTED');
      expect(startedSpy).toHaveBeenCalled();

      // Run pending timers and microtasks
      await vi.runOnlyPendingTimersAsync();

      const finalStatus = await orchestrator.getSagaStatus(instance.id);
      expect(finalStatus?.status).toBe('COMPLETED');
      expect(step1Exec).toHaveBeenCalled();
      expect(step2Exec).toHaveBeenCalled();
      expect(completedSpy).toHaveBeenCalled();
    });

    it('should handle step failures and trigger compensation', async () => {
      const step1Compensate = vi.fn().mockResolvedValue(undefined);
      
      const sagaDef: SagaDefinition<any> = {
        name: 'failure-saga',
        steps: [
          {
            name: 'step1',
            execute: async () => ({ step1Done: true }),
            compensate: step1Compensate,
          },
          {
            name: 'step2',
            execute: async () => {
              throw new Error('Step 2 failed');
            },
            compensate: async () => {},
          }
        ]
      };

      orchestrator.registerSaga(sagaDef);

      const stepFailedSpy = vi.fn();
      const sagaFailedSpy = vi.fn();
      orchestrator.on('step_failed', stepFailedSpy);
      orchestrator.on('saga_failed', sagaFailedSpy);

      const instance = await orchestrator.startSaga('failure-saga', 'corr-2', { val: 1 }, 'tenant-1');

      await vi.runOnlyPendingTimersAsync();

      const finalStatus = await orchestrator.getSagaStatus(instance.id);
      expect(finalStatus?.status).toBe('FAILED');
      expect(step1Compensate).toHaveBeenCalled();
      expect(stepFailedSpy).toHaveBeenCalled();
      expect(sagaFailedSpy).toHaveBeenCalled();
    });
  });

  describe('Locking & Idempotency', () => {
    it('should acquire a distributed lock and extend it during execution', async () => {
      const setSpy = vi.spyOn(redis, 'set');
      
      const sagaDef: SagaDefinition<any> = {
        name: 'lock-saga',
        steps: [
          {
            name: 'step1',
            execute: async () => {
              // Trigger a lock extension interval tick
              await vi.advanceTimersByTimeAsync(15000);
              return {};
            },
            compensate: async () => {},
          }
        ]
      };

      orchestrator.registerSaga(sagaDef);
      await orchestrator.startSaga('lock-saga', 'corr-lock', {}, 'tenant-1');
      await vi.runOnlyPendingTimersAsync();

      // Verify lock NX key was set
      expect(setSpy).toHaveBeenCalledWith(expect.stringContaining('saga:lock:'), expect.any(String), 'PX', 30000, 'NX');
    });

    it('should support idempotency check and skip already executed steps', async () => {
      const stepDef: SagaDefinition<any> = {
        name: 'idem-saga',
        steps: [
          {
            name: 'step1',
            execute: vi.fn().mockResolvedValue({}),
            compensate: async () => {},
          }
        ]
      };

      orchestrator.registerSaga(stepDef);

      const dummySagaId = 'saga-idem-123';
      
      // Seed the database mock
      prisma.instances.set(dummySagaId, {
        id: dummySagaId,
        sagaType: 'idem-saga',
        correlationId: 'corr-idem',
        status: 'STARTED',
        currentStep: 0,
        totalSteps: 1,
        context: {},
        tenantId: 'tenant-1',
        startedAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.steps.set('step-idem-1', {
        id: 'step-idem-1',
        sagaId: dummySagaId,
        stepName: 'step1',
        stepOrder: 0,
        status: 'PENDING',
        input: {},
        tenantId: 'tenant-1',
      });

      // Pre-set step as executed in redis
      redis.store.set(`saga:${dummySagaId}:step:step1`, `${dummySagaId}:step1:0`);

      // Mock the sagaInstance create to return this specific pre-seeded ID
      vi.spyOn(prisma.sagaInstance, 'create').mockResolvedValueOnce(prisma.instances.get(dummySagaId));

      const skippedSpy = vi.fn();
      orchestrator.on('step_skipped', skippedSpy);

      await orchestrator.startSaga('idem-saga', 'corr-idem', {}, 'tenant-1');
      await vi.runOnlyPendingTimersAsync();

      expect(skippedSpy).toHaveBeenCalledWith({ sagaId: dummySagaId, stepName: 'step1', reason: 'already_executed' });
      expect(stepDef.steps[0]!.execute).not.toHaveBeenCalled();
    });
  });

  describe('Timeouts', () => {
    it('should trigger step-level timeout if step execution is slow', async () => {
      const sagaDef: SagaDefinition<any> = {
        name: 'step-timeout-saga',
        steps: [
          {
            name: 'slow-step',
            timeout: 50,
            execute: async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return {};
            },
            compensate: async () => {},
          }
        ]
      };

      orchestrator.registerSaga(sagaDef);
      const instance = await orchestrator.startSaga('step-timeout-saga', 'corr-timeout-1', {}, 'tenant-1');
      
      // Advance by 50ms to trigger the step timeout promise rejection
      await vi.advanceTimersByTimeAsync(50);
      await vi.runOnlyPendingTimersAsync();

      const finalStatus = await orchestrator.getSagaStatus(instance.id);
      expect(finalStatus?.status).toBe('FAILED');
      expect(finalStatus?.error).toContain('timed out after 50ms');
    });

    it('should fail with global timeout if execution duration exceeds definition timeout', async () => {
      const sagaDef: SagaDefinition<any> = {
        name: 'global-timeout-saga',
        timeout: 200,
        steps: [
          {
            name: 'step1',
            execute: async () => {
              // Advance time beyond global timeout
              await vi.advanceTimersByTimeAsync(300);
              return {};
            },
            compensate: async () => {},
          },
          {
            name: 'step2',
            execute: async () => ({}),
            compensate: async () => {},
          }
        ]
      };

      orchestrator.registerSaga(sagaDef);
      const instance = await orchestrator.startSaga('global-timeout-saga', 'corr-timeout-2', {}, 'tenant-1');
      
      await vi.runOnlyPendingTimersAsync();

      const finalStatus = await orchestrator.getSagaStatus(instance.id);
      expect(finalStatus?.status).toBe('FAILED');
      expect(finalStatus?.error).toContain('Global saga timeout exceeded');
    });
  });

  describe('Recovery of Incomplete Sagas', () => {
    it('should pick up incomplete sagas and run them when recovery process is triggered', async () => {
      const step1Exec = vi.fn().mockResolvedValue({});
      const sagaDef: SagaDefinition<any> = {
        name: 'recovery-saga',
        steps: [
          {
            name: 'step1',
            execute: step1Exec,
            compensate: async () => {},
          }
        ]
      };

      orchestrator.registerSaga(sagaDef);

      // Pre-seed an incomplete saga in database
      const sagaId = 'saga-interrupted-id';
      prisma.instances.set(sagaId, {
        id: sagaId,
        sagaType: 'recovery-saga',
        correlationId: 'corr-rec',
        status: 'STARTED',
        currentStep: 0,
        totalSteps: 1,
        context: {},
        tenantId: 'tenant-1',
        startedAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.steps.set('step-rec-1', {
        id: 'step-rec-1',
        sagaId,
        stepName: 'step1',
        stepOrder: 0,
        status: 'PENDING',
        input: {},
        tenantId: 'tenant-1',
      });

      // Trigger recovery process directly to avoid timer loops
      await (orchestrator as any).recoverIncompleteSagas();
      await vi.runOnlyPendingTimersAsync();

      const finalStatus = await orchestrator.getSagaStatus(sagaId);
      expect(finalStatus?.status).toBe('COMPLETED');
      expect(step1Exec).toHaveBeenCalled();
    });
  });

  describe('Compensation Failure and Retries', () => {
    it('should keep saga in COMPENSATING state if compensation fails, and retry it during recovery', async () => {
      let failCompensation = true;
      const step1Compensate = vi.fn().mockImplementation(async () => {
        if (failCompensation) {
          throw new Error('Transient compensation failure');
        }
      });

      const sagaDef: SagaDefinition<any> = {
        name: 'comp-fail-saga',
        steps: [
          {
            name: 'step1',
            execute: async () => ({}),
            compensate: step1Compensate,
          },
          {
            name: 'step2',
            execute: async () => {
              throw new Error('Trigger fail');
            },
            compensate: async () => {},
          }
        ]
      };

      orchestrator.registerSaga(sagaDef);

      const compFailedSpy = vi.fn();
      orchestrator.on('compensation_failed', compFailedSpy);

      const instance = await orchestrator.startSaga('comp-fail-saga', 'corr-comp-retry', {}, 'tenant-1');
      await vi.runOnlyPendingTimersAsync();

      // Saga should stay in COMPENSATING state because step1 compensation failed
      const statusAfterFailure = await orchestrator.getSagaStatus(instance.id);
      expect(statusAfterFailure?.status).toBe('COMPENSATING');
      expect(compFailedSpy).toHaveBeenCalled();

      // Now set compensation to succeed, and trigger recovery
      failCompensation = false;
      await (orchestrator as any).recoverIncompleteSagas();
      await vi.runOnlyPendingTimersAsync();

      // Saga should now be finalized to FAILED because compensation succeeded
      const statusAfterRecovery = await orchestrator.getSagaStatus(instance.id);
      expect(statusAfterRecovery?.status).toBe('FAILED');
      expect(step1Compensate).toHaveBeenCalledTimes(2);
    });
  });

  describe('Stats & Misc', () => {
    it('should retrieve statistics correctly', async () => {
      prisma.instances.set('s1', { status: 'STARTED' });
      prisma.instances.set('s2', { status: 'IN_PROGRESS' });
      prisma.instances.set('s3', { status: 'COMPLETED' });
      prisma.instances.set('s4', { status: 'COMPENSATING' });
      prisma.instances.set('s5', { status: 'COMPENSATED' });
      prisma.instances.set('s6', { status: 'FAILED' });

      const stats = await orchestrator.getStats();
      expect(stats.started).toBe(1);
      expect(stats.inProgress).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.compensating).toBe(1);
      expect(stats.compensated).toBe(1);
      expect(stats.failed).toBe(1);
    });

    it('should fetch saga with steps', async () => {
      prisma.instances.set('saga-id', { id: 'saga-id' });
      prisma.steps.set('step-id', { sagaId: 'saga-id', stepOrder: 0 });

      const sagaWithSteps = await orchestrator.getSagaWithSteps('saga-id');
      expect(sagaWithSteps?.steps.length).toBe(1);
    });
  });
});
