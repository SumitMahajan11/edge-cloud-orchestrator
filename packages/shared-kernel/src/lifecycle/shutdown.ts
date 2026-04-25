import { logger } from '../logger';

type ShutdownHandler = () => Promise<void>;

interface RegisteredHandler {
  name: string;
  fn: ShutdownHandler;
  timeoutMs: number;
}

export class GracefulShutdown {
  private static handlers: RegisteredHandler[] = [];
  private static isShuttingDown = false;
  private static totalTimeoutMs = 25000; // 25s budget for Kubernetes (30s grace)

  /**
   * Register a component's shutdown logic.
   * Handlers are executed in REVERSE order of registration.
   */
  public static registerHandler(name: string, handler: ShutdownHandler, timeoutMs = 10000): void {
    this.handlers.push({ name, fn: handler, timeoutMs });
    logger.debug(`[Shutdown] Registered handler: ${name}`);
  }

  /**
   * Initialize signal listeners
   */
  public static init(): void {
    process.on('SIGTERM', () => this.handleSignal('SIGTERM'));
    process.on('SIGINT', () => this.handleSignal('SIGINT'));
    
    logger.info('[Shutdown] Initialized signal listeners (SIGTERM, SIGINT)');
  }

  private static async handleSignal(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn(`[Shutdown] Received ${signal} while already shutting down. Ignoring.`);
      return;
    }

    this.isShuttingDown = true;
    logger.info(`[Shutdown] Received ${signal}. Starting graceful termination...`);

    const startTime = Date.now();
    
    // Execute handlers in reverse order
    const reversedHandlers = [...this.handlers].reverse();

    for (const handler of reversedHandlers) {
      logger.info(`[Shutdown] Executing handler: ${handler.name}...`);
      
      try {
        await Promise.race([
          handler.fn(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout exceeding ${handler.timeoutMs}ms`)), handler.timeoutMs)
          )
        ]);
        logger.info(`[Shutdown] Handler completed: ${handler.name}`);
      } catch (err) {
        logger.error({ error: err }, `[Shutdown] Handler failed or timed out: ${handler.name}`);
      }

      if (Date.now() - startTime > this.totalTimeoutMs) {
        logger.error('[Shutdown] Total shutdown budget exceeded! Forcing exit.');
        process.exit(1);
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[Shutdown] All handlers completed cleanly in ${duration}ms. Goodbye.`);
    process.exit(0);
  }
}
