import { Prisma, PrismaClient } from "@prisma/client";
import { EventEmitter } from "eventemitter3";
import Redis from "ioredis";
import { trace, SpanKind } from "@opentelemetry/api";
import { Gauge, Counter } from "prom-client";

// Prometheus metrics
const activeSagasGauge = new Gauge({
  name: "active_sagas_total",
  help: "Total number of active sagas",
});

const sagaCompensationsCounter = new Counter({
  name: "saga_compensations_total",
  help: "Total number of saga compensations triggered",
  labelNames: ["reason"],
});

const tracer = trace.getTracer("edge-cloud-saga");

// Type definitions for saga status (since Prisma types may not be generated)
type SagaStatus =
  | "STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "COMPENSATING";
type StepStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "COMPENSATED";

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
  tenantId: string;
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
  tenantId: string;
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
  private sagaDefinitions: Map<
    string,
    SagaDefinition<Record<string, unknown>>
  > = new Map();
  private activeSagas: Set<string> = new Set();
  private recoveryInterval: ReturnType<typeof setInterval> | null = null;
  private isRecovering: boolean = false;
  private redis: Redis | null = null;

  constructor(
    prisma: PrismaClient,
    config: Partial<SagaConfig> = {},
    redis?: Redis,
  ) {
    super();
    this.prisma = prisma;
    this.config = { ...DEFAULT_SAGA_CONFIG, ...config };
    this.redis = redis || null;
  }

  /**
   * Acquire distributed lock for saga
   */
  private async acquireLock(
    sagaId: string,
    ttlMs: number = 30000,
  ): Promise<boolean> {
    console.log(`[Orchestrator] Acquiring lock for saga ${sagaId}`);
    if (!this.redis) {
      return true;
    } // Skip if Redis not configured

    const lockKey = `saga:lock:${sagaId}`;
    const token = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const acquired = await this.redis.set(lockKey, token, "PX", ttlMs, "NX");

    if (acquired === "OK") {
      await this.redis.set(`saga:lock-token:${sagaId}`, token, "EX", 60);
      return true;
    }

    return false;
  }

  /**
   * Release distributed lock
   */
  private async releaseLock(sagaId: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    const lockKey = `saga:lock:${sagaId}`;
    const tokenKey = `saga:lock-token:${sagaId}`;

    const [currentToken, storedToken] = await Promise.all([
      this.redis.get(lockKey),
      this.redis.get(tokenKey),
    ]);

    if (currentToken === storedToken) {
      await this.redis.del(lockKey, tokenKey);
    }
  }

  /**
   * Start auto-extending lock for long-running operations
   */
  private startLockExtension(
    sagaId: string,
    intervalMs: number = 10000,
  ): ReturnType<typeof setInterval> | null {
    if (!this.redis) {
      return null;
    }

    const extend = async () => {
      const lockKey = `saga:lock:${sagaId}`;
      const tokenKey = `saga:lock-token:${sagaId}`;
      const token = await this.redis?.get(tokenKey);

      if (token) {
        await this.redis?.pexpire(lockKey, 30000);
      }
    };

    return setInterval(extend, intervalMs);
  }

  /**
   * Check if step was already executed (idempotency)
   */
  private async wasStepExecuted(
    sagaId: string,
    stepName: string,
    idempotencyKey: string,
  ): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    const key = `saga:${sagaId}:step:${stepName}`;
    const stored = await this.redis.get(key);
    return stored === idempotencyKey;
  }

  /**
   * Register a saga definition
   */
  registerSaga<TContext extends Record<string, unknown>>(
    definition: SagaDefinition<TContext>,
  ): void {
    this.sagaDefinitions.set(
      definition.name,
      definition as SagaDefinition<Record<string, unknown>>,
    );
    this.emit("saga_registered", {
      name: definition.name,
      steps: definition.steps.length,
    });
  }

  /**
   * Start a new saga instance
   */
  async startSaga<TContext extends Record<string, unknown>>(
    sagaType: string,
    correlationId: string,
    initialContext: TContext,
    tenantId: string,
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
        status: "STARTED" as SagaStatus,
        currentStep: 0,
        totalSteps: definition.steps.length,
        context: initialContext as unknown as Prisma.InputJsonValue,
        tenantId,
      },
      include: { steps: true },
    });

    // Create step records
    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      await this.prisma.sagaStep.create({
        data: {
          sagaId: saga.id,
          stepName: step!.name,
          stepOrder: i,
          status: "PENDING" as StepStatus,
          input: initialContext as unknown as Prisma.InputJsonValue,
          tenantId,
        },
      });
    }

    this.emit("saga_started", { sagaId: saga.id, sagaType, correlationId });

    // Store saga state in Redis with 10-minute TTL as a safety net
    if (this.redis) {
      await this.redis.set(
        `saga:state:${saga.id}`,
        JSON.stringify({
          id: saga.id,
          type: sagaType,
          correlationId,
          status: "STARTED",
          startedAt: saga.startedAt,
        }),
        "EX",
        600, // 10 minutes
      );
    }

    // Start executing
    this.executeSaga(saga.id).catch((error: any) => {
      console.error(`[Orchestrator] Error executing saga ${saga.id}:`, error);
      this.emit("error", { sagaId: saga.id, error, phase: "execution" });
    });

    return saga as SagaInstance;
  }

  /**
   * Execute a saga to completion
   */
  private async executeSaga(sagaId: string): Promise<void> {
    console.log(`[Orchestrator] Executing saga ${sagaId}`);
    if (this.activeSagas.has(sagaId)) {
      return; // Already executing
    }

    // Acquire distributed lock
    const acquired = await this.acquireLock(sagaId);
    if (!acquired) {
      this.emit("saga_locked", { sagaId });
      return; // Another instance is handling this saga
    }

    this.activeSagas.add(sagaId);
    const lockExtension = this.startLockExtension(sagaId);

    try {
      const saga = await this.prisma.sagaInstance.findUnique({
        where: { id: sagaId },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      });

      if (!saga) {
        throw new Error(`Saga ${sagaId} not found`);
      }

      const definition = this.sagaDefinitions.get(saga.sagaType);
      if (!definition) {
        throw new Error(`Saga definition not found: ${saga.sagaType}`);
      }

      // Check global saga timeout
      const sagaTimeout = definition.timeout || this.config.defaultTimeout;
      const elapsed = Date.now() - saga.startedAt.getTime();
      const isTimedOut = elapsed > sagaTimeout;

      if (saga.status === "COMPENSATING" || isTimedOut) {
        const error = isTimedOut
          ? new Error("Global saga timeout exceeded")
          : new Error(saga.error || "Resuming compensation");
        await this.handleStepFailure(
          sagaId,
          definition,
          saga.currentStep,
          this.parseContext(saga.context),
          error,
        );
        return;
      }

      // Wrapper for saga execution logic to support optional tracing
      const executeBody = async (span?: any) => {
        try {
          activeSagasGauge.inc();

          // Update status to IN_PROGRESS
          await this.prisma.sagaInstance.update({
            where: { id: sagaId },
            data: { status: "IN_PROGRESS" as SagaStatus },
          });

          // Update Redis state
          if (this.redis) {
            await this.redis.set(
              `saga:state:${sagaId}`,
              JSON.stringify({ ...saga, status: "IN_PROGRESS" }),
              "EX",
              600,
            );
          }

          // Execute steps sequentially with idempotency
          let context = this.parseContext(saga.context);

          for (let i = saga.currentStep; i < definition.steps.length; i++) {
            const stepDef = definition.steps[i]!;
            const stepRecord = saga.steps[i]!;

            // Re-check global saga timeout between steps
            const currentElapsed = Date.now() - saga.startedAt.getTime();
            if (currentElapsed > sagaTimeout) {
              throw new Error(
                `Global saga timeout exceeded after step ${i - 1}`,
              );
            }

            // Generate idempotency key
            const idempotencyKey = `${sagaId}:${stepDef!.name}:${i}`;

            // Check if step was already executed (idempotency check)
            if (
              await this.wasStepExecuted(sagaId, stepDef!.name, idempotencyKey)
            ) {
              this.emit("step_skipped", {
                sagaId,
                stepName: stepDef!.name,
                reason: "already_executed",
              });
              continue;
            }

            // Execute step with optional tracing
            const executeStep = async (stepSpan?: any) => {
              try {
                // Update step to in progress
                await this.prisma.sagaStep.update({
                  where: { id: stepRecord!.id },
                  data: {
                    status: "IN_PROGRESS" as StepStatus,
                    startedAt: new Date(),
                  },
                });

                this.emit("step_started", {
                  sagaId,
                  stepName: stepDef!.name,
                  stepIndex: i,
                });

                // Execute step with timeout
                const stepTimeout =
                  stepDef!.timeout || this.config.stepTimeoutMs;
                const result = await this.executeStepWithTimeout(
                  stepDef!,
                  context,
                  i,
                  stepTimeout,
                );

                // Update context
                context = { ...context, ...result };

                // Update step to completed
                await this.prisma.sagaStep.update({
                  where: { id: stepRecord!.id },
                  data: {
                    status: "COMPLETED" as StepStatus,
                    completedAt: new Date(),
                    output: result as any,
                  },
                });

                // Update saga current step
                await this.prisma.sagaInstance.update({
                  where: { id: sagaId },
                  data: {
                    currentStep: i + 1,
                    context: context as any,
                  },
                });

                this.emit("step_completed", {
                  sagaId,
                  stepName: stepDef!.name,
                  stepIndex: i,
                  result,
                });
              } catch (error: any) {
                if (stepSpan) {
                  stepSpan.recordException(error);
                  stepSpan.setStatus({ code: 2, message: error.message });
                }
                throw error;
              }
            };

            if (typeof tracer.startActiveSpan === "function") {
              await tracer.startActiveSpan(
                `saga_step:${stepDef!.name}`,
                {
                  attributes: {
                    "saga.id": sagaId,
                    "step.name": stepDef!.name,
                    "step.index": i,
                  },
                },
                executeStep,
              );
            } else {
              await executeStep();
            }
          }

          // Update status to COMPLETED
          await this.prisma.sagaInstance.update({
            where: { id: sagaId },
            data: {
              status: "COMPLETED" as SagaStatus,
              completedAt: new Date(),
            },
          });

          // Cleanup Redis state
          if (this.redis) {
            await this.redis.del(`saga:state:${sagaId}`);
          }

          this.emit("saga_completed", {
            sagaId,
            sagaType: saga.sagaType,
            correlationId: saga.correlationId,
            context,
          });
        } catch (error: any) {
          if (span) {
            span.recordException(error);
            span.setStatus({ code: 2, message: error.message });
          }
          throw error;
        } finally {
          activeSagasGauge.dec();
        }
      };

      if (typeof tracer.startActiveSpan === "function") {
        return await tracer.startActiveSpan(
          `saga:${saga.sagaType}`,
          {
            kind: SpanKind.INTERNAL,
            attributes: {
              "saga.id": sagaId,
              "saga.type": saga.sagaType,
              "saga.correlation_id": saga.correlationId,
            },
          },
          executeBody,
        );
      } else {
        return await executeBody();
      }
    } catch (error: any) {
      console.error(`[Orchestrator] Error executing saga ${sagaId}:`, error);
      this.emit("error", { sagaId: sagaId, error, phase: "execution" });

      // Handle compensation on failure
      const saga = await this.prisma.sagaInstance.findUnique({
        where: { id: sagaId },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      });

      if (saga) {
        const definition = this.sagaDefinitions.get(saga.sagaType);
        if (definition) {
          await this.handleStepFailure(
            sagaId,
            definition,
            saga.currentStep,
            this.parseContext(saga.context),
            error,
          );
        }
      }
    } finally {
      this.activeSagas.delete(sagaId);
      if (lockExtension) {
        clearInterval(lockExtension);
      }
      await this.releaseLock(sagaId);
    }
  }

  /**
   * Execute a step with timeout
   */
  private async executeStepWithTimeout<TContext>(
    step: SagaStepDefinition<TContext>,
    context: TContext,
    stepIndex: number,
    timeoutMs: number,
  ): Promise<Partial<TContext>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Step ${step.name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      step
        .execute(context, stepIndex)
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

  private async handleStepFailure(
    sagaId: string,
    definition: SagaDefinition<any>,
    failedStepIndex: number,
    context: any,
    error: Error,
  ): Promise<void> {
    const parsedContext = this.parseContext(context);
    // Update failed step record if it exists
    try {
      await this.prisma.sagaStep.updateMany({
        where: { sagaId, stepOrder: failedStepIndex },
        data: {
          status: "FAILED" as StepStatus,
          error: error.message,
        },
      });
    } catch (err) {
      console.warn(
        `[Orchestrator] Failed to update failed step record: ${err}`,
      );
    }

    // Update saga status
    await this.prisma.sagaInstance.update({
      where: { id: sagaId },
      data: {
        status: "COMPENSATING" as SagaStatus,
        error: error.message,
      },
    });

    // Fetch latest state with steps for compensation
    const saga = await this.prisma.sagaInstance.findUnique({
      where: { id: sagaId },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });

    if (!saga) {
      this.emit("error", {
        sagaId,
        error: new Error("Saga not found during compensation"),
      });
      return;
    }

    this.emit("step_failed", { sagaId, stepIndex: failedStepIndex, error });

    const reason = error.message.toLowerCase().includes("timeout")
      ? "timeout"
      : "failure";
    sagaCompensationsCounter.inc({ reason });

    const lastCompletedStep = failedStepIndex;

    const compensateBody = async (span?: any) => {
      try {
        for (let i = lastCompletedStep; i >= 0; i--) {
          const stepDef = definition.steps[i];
          const stepRecord = saga.steps.find((s) => s.stepOrder === i);

          if (
            !stepRecord ||
            (stepRecord.status !== "COMPLETED" &&
              stepRecord.status !== "FAILED" &&
              stepRecord.status !== "IN_PROGRESS")
          ) {
            continue;
          }

          const compensateStep = async (stepSpan?: any) => {
            try {
              await stepDef!.compensate(parsedContext, i);

              await this.prisma.sagaStep.update({
                where: { id: stepRecord!.id },
                data: { status: "COMPENSATED" as StepStatus },
              });

              this.emit("step_compensated", {
                sagaId,
                stepName: stepDef!.name,
                stepIndex: i,
              });
            } catch (compError: any) {
              if (stepSpan && typeof stepSpan.recordException === "function") {
                stepSpan.recordException(compError);
                stepSpan.setStatus({ code: 2, message: compError.message });
              }
              console.error(
                `[Orchestrator] Compensation failed for step ${stepDef!.name}:`,
                compError,
              );
              this.emit("compensation_failed", {
                sagaId,
                stepIndex: i,
                error: compError,
              });
            }
          };

          if (typeof tracer.startActiveSpan === "function") {
            await tracer.startActiveSpan(
              `saga_compensate:${stepDef!.name}`,
              {
                attributes: {
                  "saga.id": sagaId,
                  "step.name": stepDef!.name,
                  "step.index": i,
                },
              },
              compensateStep,
            );
          } else {
            await compensateStep();
          }
        }

        // Finalize saga status
        await this.prisma.sagaInstance.update({
          where: { id: sagaId },
          data: {
            status: "FAILED" as SagaStatus,
            completedAt: new Date(),
          },
        });

        this.emit("saga_failed", { sagaId, error });
      } catch (err: any) {
        if (span && typeof span.recordException === "function") {
          span.recordException(err);
        }
        console.error(
          `[Orchestrator] Critical error in compensation loop for saga ${sagaId}:`,
          err,
        );
        this.emit("error", { sagaId, error: err });
      } finally {
        if (span && typeof span.end === "function") {
          span.end();
        }
        this.activeSagas.delete(sagaId);
        activeSagasGauge.dec();
        await this.releaseLock(sagaId);
      }
    };

    if (typeof tracer.startActiveSpan === "function") {
      await tracer.startActiveSpan(
        `saga_compensation:${saga.sagaType}`,
        {
          attributes: {
            "saga.id": sagaId,
            "saga.type": saga.sagaType,
          },
        },
        compensateBody,
      );
    } else {
      await compensateBody();
    }
  }

  /**
   * Start the recovery process for incomplete sagas
   */
  startRecovery(): void {
    this.recoveryInterval = setInterval(() => {
      void this.recoverIncompleteSagas();
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
    if (this.isRecovering) {
      return;
    }
    this.isRecovering = true;

    try {
      // Find sagas in STARTED, IN_PROGRESS, or COMPENSATING state
      const incompleteSagas = await this.prisma.sagaInstance.findMany({
        where: {
          status: {
            in: [
              "STARTED" as SagaStatus,
              "IN_PROGRESS" as SagaStatus,
              "COMPENSATING" as SagaStatus,
            ],
          },
        },
        take: 10,
      });

      for (const saga of incompleteSagas) {
        if (this.activeSagas.has(saga.id)) {
          continue;
        }

        this.emit("saga_recovered", {
          sagaId: saga.id,
          sagaType: saga.sagaType,
        });
        this.executeSaga(saga.id).catch((error) => {
          this.emit("error", { sagaId: saga.id, error, phase: "recovery" });
        });
      }
    } catch (err) {
      console.warn(
        `[SagaOrchestrator] Failed to recover incomplete sagas (DB cold start pending): ${err}`,
      );
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
  async getSagaWithSteps(
    sagaId: string,
  ): Promise<(SagaInstance & { steps: SagaStep[] }) | null> {
    return this.prisma.sagaInstance.findUnique({
      where: { id: sagaId },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
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
    const [started, inProgress, completed, compensating, compensated, failed] =
      await Promise.all([
        this.prisma.sagaInstance.count({ where: { status: "STARTED" } }),
        this.prisma.sagaInstance.count({ where: { status: "IN_PROGRESS" } }),
        this.prisma.sagaInstance.count({ where: { status: "COMPLETED" } }),
        this.prisma.sagaInstance.count({ where: { status: "COMPENSATING" } }),
        this.prisma.sagaInstance.count({ where: { status: "COMPENSATED" } }),
        this.prisma.sagaInstance.count({ where: { status: "FAILED" } }),
      ]);

    return {
      started,
      inProgress,
      completed,
      compensating,
      compensated,
      failed,
    };
  }

  private parseContext(context: any): Record<string, any> {
    if (typeof context === "string") {
      try {
        return JSON.parse(context);
      } catch (err) {
        return {};
      }
    }
    return context || {};
  }

  /**
   * Stop the orchestrator, stopping recovery and removing all listeners
   */
  stop(): void {
    this.stopRecovery();
    this.removeAllListeners();
  }
}
