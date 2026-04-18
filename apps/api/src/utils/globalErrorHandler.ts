// ============================================================================
// Global Error Handler
// ============================================================================
//
// Catches all unhandled errors in the application
// Prevents silent failures and enables graceful degradation
// ============================================================================

import { createLogger } from '../lib/logger';

const logger = createLogger('global-error-handler');

let hasUnhandledErrors = false;
let unhandledErrorCount = 0;

/**
 * Register global error handlers
 * Should be called once at application startup
 */
export function registerGlobalErrorHandlers(): void {
  // Unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    unhandledErrorCount++;
    hasUnhandledErrors = true;

    logger.error(
      {
        reason,
        promise: promise.toString(),
        count: unhandledErrorCount,
      },
      'UNHANDLED REJECTION',
    );

    // Don't exit - allow application to continue
    // But log severity for monitoring
  });

  // Uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'UNCAUGHT EXCEPTION');

    // Log but don't exit immediately
    // Allow cleanup and graceful shutdown
    setTimeout(() => {
      logger.warn('Process continuing after uncaught exception');
    }, 1000);
  });

  // Warning before exit (for cleanup)
  process.on('exit', (code) => {
    if (hasUnhandledErrors) {
      logger.warn(
        { code, unhandledErrorCount },
        'Process exiting with unhandled errors',
      );
    } else {
      logger.info({ code }, 'Process exiting normally');
    }
  });

  logger.info('✅ Global error handlers registered');
}

/**
 * Get unhandled error statistics
 */
export function getUnhandledErrorStats(): {
  hasErrors: boolean;
  count: number;
} {
  return {
    hasErrors: hasUnhandledErrors,
    count: unhandledErrorCount,
  };
}

/**
 * Reset error state (for testing only)
 */
export function resetErrorState(): void {
  hasUnhandledErrors = false;
  unhandledErrorCount = 0;
}
