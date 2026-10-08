export interface HealthStatus {
  status: "ok" | "error" | "starting";
  version: string;
  timestamp: string;
  details?: Record<string, any>;
}

export class HealthCheck {
  private static isReady = false;
  private static isStarting = true;

  public static setReady(ready: boolean): void {
    this.isReady = ready;
    if (ready) {this.isStarting = false;}
  }

  public static getLiveness(): HealthStatus {
    return {
      status: "ok",
      version: process.env.APP_VERSION || "unknown",
      timestamp: new Date().toISOString(),
    };
  }

  public static async getReadiness(
    checks: Record<string, () => Promise<boolean>> = {},
  ): Promise<HealthStatus> {
    if (!this.isReady) {
      return {
        status: "starting",
        version: process.env.APP_VERSION || "unknown",
        timestamp: new Date().toISOString(),
      };
    }

    const results: Record<string, boolean> = {};
    let overallOk = true;

    for (const [name, check] of Object.entries(checks)) {
      try {
        results[name] = await check();
        if (!results[name]) {
          overallOk = false;
        }
      } catch (_err) {
        results[name] = false;
        overallOk = false;
      }
    }

    return {
      status: overallOk ? "ok" : "error",
      version: process.env.APP_VERSION || "unknown",
      timestamp: new Date().toISOString(),
      details: results,
    };
  }

  public static getStartup(): HealthStatus {
    return {
      status: this.isStarting ? "starting" : "ok",
      version: process.env.APP_VERSION || "unknown",
      timestamp: new Date().toISOString(),
    };
  }
}
