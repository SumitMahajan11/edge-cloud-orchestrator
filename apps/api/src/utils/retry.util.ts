import { createLogger } from '../lib/logger';

const logger = createLogger('retry');

export async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 500,
): Promise<T> {
  let lastError;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const backoff = delay * Math.pow(2, i);
      logger.warn({ attempt: i + 1, retries, backoff }, 'Retry attempt');

      await new Promise((res) => setTimeout(res, backoff));
    }
  }

  throw lastError;
}
