import Redis, { type RedisOptions } from "ioredis";
import type { SecretManager } from "../secrets/SecretManager.js";
import { createLogger } from "../logger/index.js";

const logger = createLogger("redis-factory");

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
  static async createClient(
    secretManager: SecretManager,
    options: Partial<RedisOptions> = {},
  ): Promise<Redis> {
    if (process.env.FORCE_MOCK_REDIS === "true") {
      logger.info("Initializing Redis Mock (FORCE_MOCK_REDIS=true)");
      // @ts-ignore
      const MockRedis = (await import("ioredis-mock")).default;
      return new MockRedis(options) as unknown as Redis;
    }

    const redisUrl = await secretManager.getSecret("REDIS_URL");
    const sentinelHosts = await secretManager.getSecret("REDIS_SENTINELS");
    const masterName =
      (await secretManager.getSecret("REDIS_MASTER_NAME")) ||
      (await secretManager.getSecret("REDIS_SENTINEL_NAME")) ||
      "mymaster";
    const password = await secretManager.getSecret("REDIS_PASSWORD");

    const config: RedisOptions = {
      ...options,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError(err) {
        const targetError = "READONLY";
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
      const sentinels = sentinelHosts.split(",").map((s) => {
        const [host, port] = s.trim().split(":");
        return { host: host, port: parseInt(port || "26379", 10) };
      });

      logger.info(
        { masterName, sentinelCount: sentinels.length },
        "Initializing Redis with Sentinel mode",
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
      let cleanUrl = redisUrl.trim().replace(/^["']|["']$/g, '');
      const match = cleanUrl.match(/(rediss?:\/\/[^\s]+)/i);
      if (match && match[1]) {
        cleanUrl = match[1];
      }
      if (cleanUrl.includes('upstash.io') && cleanUrl.startsWith('redis://')) {
        cleanUrl = cleanUrl.replace('redis://', 'rediss://');
      }

      logger.info(
        { url: cleanUrl.replace(/:[^:@]+@/, ":***@") },
        "Initializing Redis with standard URL",
      );
      const client = new Redis(cleanUrl, config);
      client.on("error", (err) => {
        logger.error({ err: err.message }, "Redis connection error");
      });
      return client;
    }

    // Fallback to localhost
    logger.warn("No Redis configuration found, falling back to localhost:6379");
    return new Redis({
      ...config,
      host: "localhost",
      port: 6379,
    });
  }
}
