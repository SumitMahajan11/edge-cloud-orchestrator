import { PrismaClient } from "@prisma/client";
import { createLogger, IMetricsCollector } from "@edgecloud/shared-kernel";
import { ModelRegistry } from "../registry";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const logger = createLogger("ml-incremental-updater");

export class IncrementalUpdater {
  private outcomeCount = 0;
  private lastUpdateTime = Date.now();
  private readonly UPDATE_THRESHOLD = 500;
  private readonly TIME_THRESHOLD = 3600000; // 1 hour

  constructor(
    private prisma: PrismaClient,
    private registry: ModelRegistry,
    private metrics: IMetricsCollector,
  ) {}

  async onOutcomeRecorded() {
    this.outcomeCount++;
    const now = Date.now();

    if (
      this.outcomeCount >= this.UPDATE_THRESHOLD ||
      now - this.lastUpdateTime >= this.TIME_THRESHOLD
    ) {
      await this.runUpdate();
      this.outcomeCount = 0;
      this.lastUpdateTime = now;
    }
  }

  private async runUpdate() {
    logger.info("Starting incremental model update...");

    try {
      // 1. Retrieve latest outcomes (last 5000)
      const outcomes = await this.prisma.outcomeLog.findMany({
        take: 5000,
        orderBy: { timestamp: "desc" },
      });

      if (outcomes.length < 500) {
        logger.warn(
          "Insufficient data for incremental update. Need at least 500 outcomes.",
        );
        return;
      }

      // 2. Split into training and holdout (last 500 for validation)
      const trainingData = outcomes.slice(500);

      // 3. Prepare data for Python script
      const tempDir = path.join(process.cwd(), "temp_ml");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

      const dataPath = path.join(tempDir, `incr_data_${Date.now()}.json`);
      fs.writeFileSync(dataPath, JSON.stringify(trainingData));

      // 4. Get current model path
      const activeVersion = await this.registry.getActiveModel();
      if (!activeVersion) {
        logger.error("No active model found for incremental update");
        return;
      }

      // 5. Run incremental update script
      const scriptPath = path.join(__dirname, "update_model.py");
      const outputDir = path.join(process.cwd(), "models");

      const success = await this.executePythonUpdate(
        scriptPath,
        dataPath,
        outputDir,
        activeVersion.version,
      );

      if (success) {
        // 6. Validate updated model (conceptually done in script, but we handle hot-swap here)
        logger.info(
          "Incremental update successful, hot-swap should happen via ModelRegistry",
        );
        this.metrics.recordMetric(
          "ml_model_last_updated_timestamp",
          Date.now(),
        );
      } else {
        logger.warn("Incremental update validation failed or script errored");
      }

      // Cleanup
      if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
    } catch (error) {
      logger.error({ error }, "Incremental update failed");
    }
  }

  private executePythonUpdate(
    scriptPath: string,
    dataPath: string,
    outputDir: string,
    currentVersion: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const py = spawn("python", [
        scriptPath,
        dataPath,
        outputDir,
        currentVersion,
      ]);

      py.stdout.on("data", (data) => logger.debug(`Python: ${data}`));
      py.stderr.on("data", (data) => logger.error(`Python Error: ${data}`));

      py.on("close", (code) => {
        resolve(code === 0);
      });
    });
  }

  getStats() {
    return {
      outcomeCount: this.outcomeCount,
      updateThreshold: this.UPDATE_THRESHOLD,
      lastUpdateTime: this.lastUpdateTime,
      nextUpdateAt: this.UPDATE_THRESHOLD - this.outcomeCount,
    };
  }
}
