import { Redis } from "ioredis";
import fs from "fs";
import path from "path";
import { createLogger } from "@edgecloud/shared-kernel";

const logger = createLogger("ml-model-registry");

export interface ModelMetadata {
  version: string;
  algorithm: string;
  mae: number;
  features: string[];
  created_at: string;
  artifact_path: string;
}

export class ModelRegistry {
  private readonly REDIS_KEY = "ml:active_model_version";
  private readonly HISTORY_KEY = "ml:model_version_history";
  public readonly MODEL_DIR: string;

  constructor(
    public redis: Redis,
    modelDir?: string,
  ) {
    this.MODEL_DIR = modelDir || path.join(process.cwd(), "models");
    if (!fs.existsSync(this.MODEL_DIR)) {
      fs.mkdirSync(this.MODEL_DIR, { recursive: true });
    }
  }

  async listModels(): Promise<ModelMetadata[]> {
    const files = fs.readdirSync(this.MODEL_DIR);
    const metaFiles = files.filter(
      (f) => f.startsWith("model_") && f.endsWith(".json"),
    );

    const versions: ModelMetadata[] = [];
    for (const file of metaFiles) {
      try {
        const content = fs.readFileSync(
          path.join(this.MODEL_DIR, file),
          "utf-8",
        );
        versions.push(JSON.parse(content));
      } catch (e) {
        logger.warn({ file }, "Failed to parse model metadata");
      }
    }

    return versions.sort((a, b) => {
      const dateA = a.created_at || (a as any).timestamp || "";
      const dateB = b.created_at || (b as any).timestamp || "";
      return dateB.localeCompare(dateA);
    });
  }

  async getActiveModel(): Promise<ModelMetadata | null> {
    const version = await this.redis.get(this.REDIS_KEY);
    if (!version) return null;
    return this.getModelMetadata(version);
  }

  async promoteModel(version: string): Promise<void> {
    const metaPath = path.join(this.MODEL_DIR, `model_${version}.json`);
    if (!fs.existsSync(metaPath)) {
      throw new Error(`Model version ${version} not found`);
    }

    const currentActive = await this.redis.get(this.REDIS_KEY);
    if (currentActive && currentActive !== version) {
      // Add to history for rollback
      await this.redis.lpush(this.HISTORY_KEY, currentActive);
      await this.redis.ltrim(this.HISTORY_KEY, 0, 9); // Keep last 10 in history
    }

    await this.redis.set(this.REDIS_KEY, version);
    await this.redis.publish("ml:model_updated", version);

    logger.info({ version }, "Model promoted to active");

    // Prune old models from disk (keep last 5)
    await this.pruneOldModels();
  }

  async rollbackModel(): Promise<string | null> {
    const previousVersion = await this.redis.lpop(this.HISTORY_KEY);
    if (!previousVersion) {
      logger.warn("No version history available for rollback");
      return null;
    }

    await this.redis.set(this.REDIS_KEY, previousVersion);
    await this.redis.publish("ml:model_updated", previousVersion);

    logger.info(
      { version: previousVersion },
      "Model rolled back to previous version",
    );
    return previousVersion;
  }

  async getModelMetadata(version: string): Promise<ModelMetadata | null> {
    const metaPath = path.join(this.MODEL_DIR, `model_${version}.json`);
    if (!fs.existsSync(metaPath)) return null;

    try {
      const content = fs.readFileSync(metaPath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      logger.error({ error, version }, "Failed to read model metadata");
      return null;
    }
  }

  private async pruneOldModels(): Promise<void> {
    const models = await this.listModels();
    if (models.length <= 3) return;

    const toDelete = models.slice(3);
    const activeVersion = await this.redis.get(this.REDIS_KEY);

    for (const model of toDelete) {
      if (model.version === activeVersion) continue;

      try {
        const metaPath = path.join(
          this.MODEL_DIR,
          `model_${model.version}.json`,
        );
        const artifactPath = path.join(
          this.MODEL_DIR,
          `model_${model.version}.bin`,
        ); // Assuming XGBoost binary name

        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
        if (fs.existsSync(artifactPath)) fs.unlinkSync(artifactPath);

        logger.info({ version: model.version }, "Pruned old model artifact");
      } catch (e) {
        logger.error(
          { error: e, version: model.version },
          "Failed to prune model",
        );
      }
    }
  }
}
