import Redis, { RedisOptions } from 'ioredis';
import { SecretManager } from '../secrets/SecretManager.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('redis-factory');

export interface RedisConfig {
  url?: string;
  sentinels?: Array<{ host: string; port: number }>;
  masterName?: string;
  password?: string;
  db?: number;
}

export class RedisFactory {
  /**
   * Create a Redis client from environment/secrets
   */
  static async createClient(secretManager: SecretManager, options: Partial<RedisOptions> = {}): Promise<Redis> {
    const redisUrl = await secretManager.getSecret('REDIS_URL');
    const sentinelHosts = await secretManager.getSecret('REDIS_SENTINELS');
    const masterName = await secretManager.getSecret('REDIS_MASTER_NAME') || 
                      await secretManager.getSecret('REDIS_SENTINEL_NAME') || 
                      'mymaster';
    const password = await secretManager.getSecret('REDIS_PASSWORD');

    const config: RedisOptions = {
      ...options,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError(err) {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
    };

    if (password) {
      config.password = password;
    }

    if (sentinelHosts) {
      const sentinels = sentinelHosts.split(',').map((s) => {
        const [host, port] = s.trim().split(':');
        return { host: host!, port: parseInt(port || '26379', 10) };
      });

      logger.info(
        { masterName, sentinelCount: sentinels.length },
        'Initializing Redis with Sentinel mode',
      );

      return new Redis({
        ...config,
        sentinels,
        name: masterName,
        password: password || undefined,
        sentinelPassword: password || undefined,
      });
    }

    if (redisUrl) {
      logger.info(
        { url: redisUrl.replace(/:[^:@]+@/, ':***@') },
        'Initializing Redis with standard URL',
      );
      return new Redis(redisUrl, config);
    }

    // Fallback to localhost
    logger.warn('No Redis configuration found, falling back to localhost:6379');
    return new Redis({
      ...config,
      host: 'localhost',
      port: 6379,
    });
  }
}
