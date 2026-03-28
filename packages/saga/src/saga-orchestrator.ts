import { EventEmitter } from 'eventemitter3';
import { PrismaClient, SagaStatus, StepStatus } from '@prisma/client';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface SagaStepDefinition<TContext = Record<string, unknown>> {
  name: string;
  execute: (context: TContext, stepIndex: number) => Promise<Partial<TContext>>;
  compensate: (context: TContext, stepIndex: number) => Promise<void>;
  timeout?: number;
  maxRetries?: number;
}

export interface SagaDefinition<TContext = Record<string, unknown>> {
  name: string;
  steps: SagaStepDefinition<TContext>[];
  timeout?: number;
  retryDelayMs?: number;
}

export interface SagaConfig {
  maxConcurrentSagas: number;
  defaultTimeout: number;
  retryDelayMs: number;
  recoveryIntervalMs: number;
  stepTimeoutMs: number;
}

export interface SagaInstance {
  id: string;
  sagaType: string;
  correlationId: string;
  status: SagaStatus;
  currentStep: number;
  totalSteps: number;
  context: Record<string, unknown>;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface SagaStep {
  id: string;
  sagaId: string;
  stepName: string;
  stepOrder: number;
  status: StepStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

export const DEFAULT_SAGA_CONFIG: SagaConfig = {
  maxConcurrentSagas: 100,
  defaultTimeout: 300000, // 5 minutes
  retryDelayMs: 1000,
  recoveryIntervalMs: 5000,
  stepTimeoutMs: 60000, // 1 minute per step
};

// ============================================================================
// Saga Orchestrator
// ============================================================================

export class SagaOrchestrator extends EventEmitter {
  private prisma: PrismaClient;
  private config: SagaConfig;
  private sagaDefinitions: Map<string, SagaDefinition<Record<string, unknown>>> = new Map();
  private activeSagas: Set<string> = new Set();
  private recoveryInterval: ReturnType<typeof setInterval> | null = null;
  private isRecovering: boolean = false;

  constructor(prisma: PrismaClient, config: Partial<SagaConfig> = {}) {
    super();
    this.prisma = prisma;
    this.config = { ...DEFAULT_SAGA_CONFIG, ...config };
  }

  /**
   * Register a saga definition
   */
  registerSaga<TContext extends Record<string, unknown>>(
    definition: SagaDefinition<TContext>
  ): void {
    this.sagaDefinitions.set(definition.name, definition as SagaDefinition<Record<string, unknown>>);
    this.emit('saga_registered', { name: definition.name, steps: definition.steps.length });
  }

  /**
   * Start a new saga instance
   */
  async startSaga<TContext extends Record<string, unknown>>(
    sagaType: string,
    correlationId: string,
    initialContext: TContext
  ): Promise<SagaInstance> {
    const definition = this.sagaDefinitions.get(sagaType);
    if (!definition) {
      throw new Error(`Unknown saga type: ${sagaType}`);
    }

    // Create saga instance
    const saga = await this.prisma.sagaInstance.create({
      data: {
        sagaType,
        correlationId,
        status: 'STARTED' as SagaStatus,
        currentStep: 0,
        totalSteps: definition.steps.length,
        context: initialContext as Record<string, unknown>,
      },
      include: { steps: true },
    });

    // Create step records
    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      await this.prisma.sagaStep.create({
        data: {
          sagaId: saga.id,
          stepName: step.name,
          stepOrder: i,
          status: 'PENDING' as StepStatus,
          input: initialContext as Record<string, unknown>,
        },
      });
    }

    this.emit('saga_started', { sagaId: saga.id, sagaType, correlationId });

    // Start executing
    this.executeSaga(saga.id).catch((error) => {
      this.emit('error', { sagaId: saga.id, error, phase: 'execution' });
    });

    return saga as SagaInstance;
  }

  /**
   * Execute a saga to completion
   */
  private async executeSaga(sagaId: string): Promise<void> {
    if (this.activeSagas.has(sagaId)) {
      return; // Already executing
    }

    this.activeSagas.add(sagaId);

    try {
      const saga = await this.prisma.sagaInstance.findUnique({
        where: { id: sagaId },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });

      if (!saga) {
        throw new Error(`Saga ${sagaId} not found`);
      }

      const definition = this.sagaDefinitions.get(saga.sagaType);
      if (!definition) {
        throw new Error(`Saga definition not found: ${saga.sagaType}`);
      }

      // Update status to IN_PROGRESS
      await this.prisma.sagaInstance.update({
        where: { id: sagaId },
        data: { status: 'IN_PROGRESS' as SagaStatus },
      });

      // Execute steps sequentially
      let context = saga.context as Record<string, unknown>;

      for (let i = saga.currentStep; i < definition.steps.length; i++) {
        const stepDef = definition.steps[i];
        const stepRecord = saga.steps[i];

        // Update step to in progress
        await this.prisma.sagaStep.update({
          where: { id: stepRecord.id },
          data: {
            status: 'IN_PROGRESS' as StepStatus,
            startedAt: new Date(),
          },
        });

        try {
          // Execute the step
          const result = await this.executeStepWithTimeout(
            stepDef,
            context,
            i,
            stepDef.timeout || this.config.stepTimeoutMs
          );

          // Merge result into context
          context = { ...context, ...result };

          // Mark step completed
          await this.prisma.sagaStep.update({
            where: { id: stepRecord.id },
            data: {
              status: 'COMPLETED' as StepStatus,
              output: result,
              completedAt: new Date(),
            },
          });

          // Update saga progress
          await this.prisma.sagaInstance.update({
            where: { id: sagaId },
            data: {
              currentStep: i + 1,
              context,
            },
          });

          this.emit('step_completed', { sagaId, stepName: stepDef.name, stepIndex: i });
        } catch (error) {
          // Step failed - start compensation
          await this.handleStepFailure(sagaId, definition, i, context, error as Error);
          return;
        }
      }

      // All steps completed successfully
      await this.prisma.sagaInstance.update({
        where: { id: sagaId },
        data: {
          status: 'COMPLETED' as SagaStatus,
          completedAt: new Date(),
        },
      });

      this.emit('saga_completed', { sagaId, sagaType: saga.sagaType });
    } finally {
      this.activeSagas.delete(sagaId);
    }
  }

  /**
   * Execute a step with timeout
   */
  private async executeStepWithTimeout<TContext>(
    step: SagaStepDefinition<TContext>,
    context: TContext,
    stepIndex: number,
    timeoutMs: number
  ): Promise<Partial<TContext>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Step ${step.name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      step.execute(context, stepIndex)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Handle step failure and start compensation
   */
  private async handleStepFailure(
    sagaId: string,
    definition: SagaDefinition,
    failedStepIndex: number,
    context: Record<string, unknown>,
    error: Error
  ): Promise<void> {
    // Update saga to compensating
    await this.prisma.sagaInstance.update({
      where: { id: sagaId },
      data: {
        status: 'COMPENSATING' as SagaStatus,
        error: error.message,
      },
    });

    // Get all steps
    const saga = await this.prisma.sagaInstance.findUnique({
      where: { id: sagaId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });

    if (!saga) return;

    // Update failed step
    await this.prisma.sagaStep.update({
      where: { id: saga.steps[failedStepIndex].id },
      data: {
        status: 'FAILED' as StepStatus,
        error: error.message,
        completedAt: new Date(),
      },
    });

    this.emit('step_failed', { sagaId, stepIndex: failedStepIndex, error });

    // Run compensating transactions in reverse order
    for (let i = failedStepIndex - 1; i >= 0; i--) {
      const stepDef = definition.steps[i];
      const stepRecord = saga.steps[i];

      if (stepRecord.status === 'COMPLETED') {
        try {
          await stepDef.compensate(context as Record<string, unknown>, i);

          await this.prisma.sagaStep.update({
            where: { id: stepRecord.id },
            data: {
              status: 'COMPENSATED' as StepStatus,
            },
          });

          this.emit('step_compensated', { sagaId, stepName: stepDef.name, stepIndex: i });
        } catch (compensateError) {
          await this.prisma.sagaStep.update({
            where: { id: stepRecord.id },
            data: {
              status: 'FAILED' as StepStatus,
              error: (compensateError as Error).message,
            },
          });

          this.emit('compensation_failed', { sagaId, stepIndex: i, error: compensateError });
        }
      }
    }

    // Mark saga as compensated or failed
    const hasFailedCompensations = await this.prisma.sagaStep.count({
      where: { sagaId, status: 'FAILED' },
    });

    await this.prisma.sagaInstance.update({
      where: { id: sagaId },
      data: {
        status: hasFailedCompensations > 0 ? ('FAILED' as SagaStatus) : ('COMPENSATED' as SagaStatus),
        completedAt: new Date(),
      },
    });

    this.emit('saga_compensated', { sagaId, hasFailedCompensations: hasFailedCompensations > 0 });
  }

  /**
   * Start the recovery process for incomplete sagas
   */
  startRecovery(): void {
    this.recoveryInterval = setInterval(() => {
      this.recoverIncompleteSagas();
    }, this.config.recoveryIntervalMs);
  }

  /**
   * Stop the recovery process
   */
  stopRecovery(): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
  }

  /**
   * Recover sagas that were interrupted
   */
  private async recoverIncompleteSagas(): Promise<void> {
    if (this.isRecovering) return;
    this.isRecovering = true;

    try {
      // Find sagas in STARTED or IN_PROGRESS state
      const incompleteSagas = await this.prisma.sagaInstance.findMany({
        where: {
          status: { in: ['STARTED' as SagaStatus, 'IN_PROGRESS' as SagaStatus] },
        },
        take: 10,
      });

      for (const saga of incompleteSagas) {
        if (this.activeSagas.has(saga.id)) continue;

        this.emit('saga_recovered', { sagaId: saga.id, sagaType: saga.sagaType });
        this.executeSaga(saga.id).catch((error) => {
          this.emit('error', { sagaId: saga.id, error, phase: 'recovery' });
        });
      }
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Get saga status
   */
  async getSagaStatus(sagaId: string): Promise<SagaInstance | null> {
    return this.prisma.sagaInstance.findUnique({
      where: { id: sagaId },
    }) as Promise<SagaInstance | null>;
  }

  /**
   * Get saga with steps
   */
  async getSagaWithSteps(sagaId: string): Promise<(SagaInstance & { steps: SagaStep[] }) | null> {
    return this.prisma.sagaInstance.findUnique({
      where: { id: sagaId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    }) as Promise<(SagaInstance & { steps: SagaStep[] }) | null>;
  }

  /**
   * Get statistics about sagas
   */
  async getStats(): Promise<{
    started: number;
    inProgress: number;
    completed: number;
    compensating: number;
    compensated: number;
    failed: number;
  }> {
    const [started, inProgress, completed, compensating, compensated, failed] = await Promise.all([
      this.prisma.sagaInstance.count({ where: { status: 'STARTED' } }),
      this.prisma.sagaInstance.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.sagaInstance.count({ where: { status: 'COMPLETED' } }),
      this.prisma.sagaInstance.count({ where: { status: 'COMPENSATING' } }),
      this.prisma.sagaInstance.count({ where: { status: 'COMPENSATED' } }),
      this.prisma.sagaInstance.count({ where: { status: 'FAILED' } }),
    ]);

    return { started, inProgress, completed, compensating, compensated, failed };
  }
}
