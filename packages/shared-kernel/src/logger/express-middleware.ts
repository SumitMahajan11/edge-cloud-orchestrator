import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runWithContext } from './context';
import type { Logger } from 'pino';

/**
 * Standardized logging middleware for Express (used by edge-agent).
 */
export function createExpressLoggingMiddleware(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();
    res.setHeader('x-request-id', requestId);

    runWithContext({ requestId }, () => {
      const startTime = Date.now();

      logger.info({
        type: 'request_start',
        method: req.method,
        url: req.url,
        remoteAddress: req.ip,
        requestId,
      }, `Incoming ${req.method} ${req.url}`);

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        logger.info({
          type: 'request_end',
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
        }, `Finished ${req.method} ${req.url} with ${res.statusCode}`);
      });

      next();
    });
  };
}
