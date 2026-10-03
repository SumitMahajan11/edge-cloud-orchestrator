import Redis from "ioredis";
import Redlock, { Lock } from "redlock";
import type { Logger } from "pino";
import { EventEmitter } from "eventemitter3";
import { Gauge, Registry, register } from "prom-client";

export interface LeaderElectionConfig {
  lockKey: string;
  ttl: number; // milliseconds
  unlockOnStop?: boolean;
  registry?: Registry;
}

export interface LeaderEvents {
  "leadership-acquired": () => void;
  "leadership-lost": () => void;
}

export class LeaderElection extends EventEmitter {
  private redlock: Redlock;
  private lock: Lock | null = null;
  private isLeader = false;
  private renewalInterval: ReturnType<typeof setInterval> | null = null;
  private leaderGauge: Gauge | null = null;
  private serviceId: string = "unknown";
  private logger: Logger;
  private config: LeaderElectionConfig;

  constructor(redis: Redis, logger: Logger, config: LeaderElectionConfig) {
    super();
    this.logger = logger;
    this.config = config;
    this.redlock = new Redlock([redis as any], {
      driftFactor: 0.01,
      retryCount: 0,
      retryDelay: 200,
      retryJitter: 200,
    });

    this.redlock.on("clientError", (error: any) => {
      this.logger.error({ error }, "Redlock error");
    });

    const metricsRegistry = config.registry || register;

    // Initialize Prometheus gauge
    const metricName = "edgecloud_scheduler_leader";
    try {
      const existingMetric = metricsRegistry.getSingleMetric(metricName);
      if (existingMetric instanceof Gauge) {
        this.leaderGauge = existingMetric;
      } else {
        this.leaderGauge = new Gauge({
          name: metricName,
          help: "Whether this instance is the leader (1) or not (0)",
          labelNames: ["service_id"],
          registers: [metricsRegistry],
        });
      }
    } catch (e) {
      this.logger.debug(
        "Failed to initialize leader gauge, metrics may be disabled",
      );
    }
  }

  /**
   * Acquire leadership lease manually
   */
  public async acquireLease(
    serviceId: string,
    ttlMs: number,
  ): Promise<boolean> {
    this.serviceId = serviceId;
    this.config.ttl = ttlMs;

    try {
      this.lock = await this.redlock.acquire(
        [this.config.lockKey],
        this.config.ttl,
      );
      this.onLeadershipAcquired();
      return true;
    } catch (error) {
      if (this.isLeader) {
        this.onLeadershipLost();
      }
      return false;
    }
  }

  private onLeadershipAcquired() {
    if (this.isLeader) {return;}
    this.isLeader = true;
    this.logger.info(
      { lockKey: this.config.lockKey, serviceId: this.serviceId },
      "Leadership acquired",
    );
    this.emit("leadership-acquired");
    this.updateMetric(1);
    this.startRenewalTimer();
  }

  private onLeadershipLost() {
    if (!this.isLeader) {return;}
    this.isLeader = false;
    this.lock = null;
    this.logger.warn(
      { lockKey: this.config.lockKey, serviceId: this.serviceId },
      "Leadership lost",
    );
    this.emit("leadership-lost");
    this.updateMetric(0);
    this.stopRenewalTimer();
  }

  private updateMetric(value: number) {
    if (this.leaderGauge) {
      this.leaderGauge.set({ service_id: this.serviceId }, value);
    }
  }

  private startRenewalTimer() {
    this.stopRenewalTimer();
    // Renew at 1/3 of TTL as requested
    const interval = Math.max(this.config.ttl / 3, 100);
    this.renewalInterval = setInterval(async () => {
      if (!this.lock) {
        this.onLeadershipLost();
        return;
      }
      try {
        this.lock = await (this.lock as any).extend(this.config.ttl);
        this.logger.debug(
          { lockKey: this.config.lockKey },
          "Leadership lease renewed",
        );
      } catch (e) {
        this.logger.warn(
          { error: e, lockKey: this.config.lockKey },
          "Failed to renew leadership lease",
        );
        this.onLeadershipLost();
      }
    }, interval);
  }

  private stopRenewalTimer() {
    if (this.renewalInterval) {
      clearInterval(this.renewalInterval);
      this.renewalInterval = null;
    }
  }

  /**
   * Startup helper with exponential backoff
   */
  public async start(
    serviceId: string,
    ttlMs: number,
    maxAttempts = 5,
  ): Promise<boolean> {
    this.serviceId = serviceId;
    this.config.ttl = ttlMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const acquired = await this.acquireLease(serviceId, ttlMs);
      if (acquired) {return true;}

      if (attempt < maxAttempts) {
        const delay = Math.min(
          200 * Math.pow(2, attempt - 1) + Math.random() * 100,
          5000,
        );
        this.logger.debug(
          { attempt, nextRetry: delay, serviceId },
          "Leadership acquisition failed, retrying...",
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.logger.error(
      { attempts: maxAttempts, serviceId },
      "Failed to acquire leadership after maximum attempts",
    );
    return false;
  }

  /**
   * Legacy start method for backward compatibility
   */
  public async startLegacy(): Promise<void> {
    await this.start(this.serviceId, this.config.ttl);
  }

  public async stop(): Promise<void> {
    this.stopRenewalTimer();
    if (this.lock && this.config.unlockOnStop) {
      try {
        await (this.lock as any).release();
      } catch (e) {
        this.logger.error({ error: e }, "Failed to release lock on stop");
      }
    }
    this.onLeadershipLost();
  }

  public isCurrentlyLeader(): boolean {
    return this.isLeader;
  }
}
