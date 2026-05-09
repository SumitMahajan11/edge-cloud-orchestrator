import type { Redis } from 'ioredis';
import { logger } from '../lib/logger';
import { env } from '../config/env';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: number;
  isLocked: boolean;
}

export class RateLimitService {
  private redis: Redis;
  private readonly windowMs: number;
  private readonly maxAttempts: number;
  private readonly lockoutMs: number;

  constructor(redis: Redis) {
    this.redis = redis;
    this.maxAttempts = env.MAX_LOGIN_ATTEMPTS;
    this.windowMs = 15 * 60 * 1000; // 15 minutes
    this.lockoutMs = env.LOCKOUT_DURATION_MINUTES * 60 * 1000;
  }

  /**
   * Checks if a login attempt is allowed for the given IP and email.
   * Implements a sliding window using Redis ZSET and a lockout key.
   */
  async checkLimit(ip: string, email: string): Promise<RateLimitResult> {
    const now = Date.now();
    const lockoutKey = `lockout:${ip}:${email}`;
    const windowKey = `attempts:${ip}`;

    // 1. Check if explicitly locked out
    const lockoutExpiry = await this.redis.get(lockoutKey);
    if (lockoutExpiry && parseInt(lockoutExpiry, 10) > now) {
      return {
        allowed: false,
        remaining: 0,
        reset: parseInt(lockoutExpiry, 10),
        isLocked: true,
      };
    }

    // 2. Clean up old attempts and count current window
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(windowKey, 0, now - this.windowMs);
    pipeline.zcard(windowKey);
    const results = await pipeline.exec();

    const count = (results && results[1] && results[1][1] ? (results[1][1] as number) : 0);

    if (count >= this.maxAttempts) {
      // Trigger lockout if not already set (this happens on the attempt that exceeds the limit)
      await this.lockout(ip, email);
      return {
        allowed: false,
        remaining: 0,
        reset: now + this.lockoutMs,
        isLocked: true,
      };
    }

    return {
      allowed: true,
      remaining: this.maxAttempts - count,
      reset: now + this.windowMs,
      isLocked: false,
    };
  }

  /**
   * Records a failed login attempt.
   */
  async recordAttempt(ip: string): Promise<void> {
    const now = Date.now();
    const windowKey = `attempts:${ip}`;

    await this.redis.zadd(windowKey, now, `${now}-${Math.random()}`);
    await this.redis.expire(windowKey, Math.ceil(this.windowMs / 1000));
  }

  /**
   * Explicitly locks out an IP/Email combination.
   */
  async lockout(ip: string, email: string): Promise<void> {
    const now = Date.now();
    const lockoutKey = `lockout:${ip}:${email}`;
    await this.redis.set(
      lockoutKey,
      (now + this.lockoutMs).toString(),
      'PX',
      this.lockoutMs,
    );

    logger.warn(
      { ip, email, lockoutDuration: this.lockoutMs },
      'User account locked out due to multiple failed login attempts',
    );
  }

  /**
   * Resets attempts (called after successful login).
   */
  async reset(ip: string, email: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.del(`attempts:${ip}`);
    pipeline.del(`lockout:${ip}:${email}`);
    await pipeline.exec();
  }
}
