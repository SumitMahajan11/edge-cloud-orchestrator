import { createLogger } from "@edgecloud/shared-kernel";
import fs from "fs";
import path from "path";

const logger = createLogger("ml-bandit");

let tf: any = null;
try {
  tf = require("@tensorflow/tfjs-node");
} catch (_e) {
  if ((globalThis as any).tf) {
    tf = (globalThis as any).tf;
  } else {
    logger.warn("TensorFlow native addon not available, using mock bandit weights");
  }
}

export class SchedulingBandit {
  private model: any | null = null;
  private useMock: boolean;
  private mockWeights: number[] = new Array(12).fill(0.1);
  private readonly learningRate = 0.05;

  constructor() {
    this.useMock = tf === null;
    if (!this.useMock) {
      this.initializeModel();
    } else {
      logger.info("Initializing mock bandit with linear weights");
    }
  }

  private initializeModel() {
    try {
      this.model = tf.sequential({
        layers: [
          tf.layers.dense({
            inputShape: [12],
            units: 16,
            activation: "relu",
          }),
          tf.layers.dense({
            units: 8,
            activation: "relu",
          }),
          tf.layers.dense({
            units: 1,
            activation: "tanh", // Range: [-1.0, 1.0] to match rewards
          }),
        ],
      });

      this.model.compile({
        optimizer: tf.train.adam(0.01),
        loss: "meanSquaredError",
      });
      logger.info("TensorFlow.js Contextual Bandit model initialized successfully");
    } catch (error) {
      logger.error({ error }, "Failed to initialize TF.js model, falling back to mock mode");
      this.useMock = true;
    }
  }

  /**
   * Scores a node using the bandit network.
   * Returns a predicted reward in the range [-1.0, 1.0].
   */
  async scoreNode(nodeId: string, context: number[]): Promise<number> {
    if (context.length !== 12) {
      throw new Error(`Context vector must have length 12. Got: ${context.length}`);
    }

    if (this.useMock) {
      // Calculate dot product and scale to [-1.0, 1.0] using hyperbolic tangent (tanh) mock approximation
      let dotProduct = 0;
      for (let i = 0; i < 12; i++) {
        const contextVal = context[i] || 0.0;
        const weightVal = this.mockWeights[i] || 0.0;
        dotProduct += contextVal * weightVal;
      }
      // Math.tanh mock
      const mockScore = Math.tanh(dotProduct);
      return mockScore;
    }

    const input = tf.tensor2d([context]);
    try {
      const prediction = this.model.predict(input);
      const data = await prediction.data();
      const score = data[0];

      input.dispose();
      prediction.dispose();
      
      return score;
    } catch (error) {
      input.dispose();
      logger.error({ error, nodeId }, "Failed to predict score using bandit model");
      // Fallback
      return 0.0;
    }
  }

  /**
   * Performs an online training step on a feedback tuple (context, reward).
   */
  async updateFromOutcome(nodeId: string, context: number[], reward: number): Promise<void> {
    if (context.length !== 12) {
      throw new Error(`Context vector must have length 12. Got: ${context.length}`);
    }

    // Clamp reward to [-1.0, 1.0]
    const clampedReward = Math.max(-1.0, Math.min(1.0, reward));

    if (this.useMock) {
      // Mock SGD update to satisfy learning tests
      let dotProduct = 0;
      for (let i = 0; i < 12; i++) {
        const contextVal = context[i] || 0.0;
        const weightVal = this.mockWeights[i] || 0.0;
        dotProduct += contextVal * weightVal;
      }
      const prediction = Math.tanh(dotProduct);
      const error = clampedReward - prediction;

      for (let i = 0; i < 12; i++) {
        const currentWeight = this.mockWeights[i] || 0.0;
        const contextVal = context[i] || 0.0;
        this.mockWeights[i] = currentWeight + this.learningRate * error * contextVal;
      }
      logger.debug({ nodeId, reward: clampedReward, prediction, error }, "Mock bandit weights updated online");
      return;
    }

    const xs = tf.tensor2d([context]);
    const ys = tf.tensor2d([[clampedReward]]);

    try {
      await this.model.fit(xs, ys, {
        epochs: 1,
        verbose: 0,
      });
    } catch (error) {
      logger.error({ error, nodeId }, "Failed to fit bandit model online");
    } finally {
      xs.dispose();
      ys.dispose();
    }
  }

  /**
   * Saves the bandit model weights to the specified directory.
   */
  async saveModel(modelDir: string): Promise<void> {
    try {
      if (!fs.existsSync(modelDir)) {
        fs.mkdirSync(modelDir, { recursive: true });
      }

      if (this.useMock) {
        fs.writeFileSync(
          path.join(modelDir, "mock_bandit.json"),
          JSON.stringify({ weights: this.mockWeights }, null, 2)
        );
        logger.info(`Mock bandit weights saved to ${modelDir}`);
        return;
      }

      if (this.model) {
        await this.model.save(`file://${modelDir}`);
        logger.info(`TF.js bandit model saved to ${modelDir}`);
      }
    } catch (error) {
      logger.error({ error, modelDir }, "Failed to save bandit model");
    }
  }

  /**
   * Loads bandit model weights from the specified directory.
   */
  async loadModel(modelDir: string): Promise<void> {
    try {
      if (this.useMock) {
        const filePath = path.join(modelDir, "mock_bandit.json");
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (Array.isArray(data.weights) && data.weights.length === 12) {
            this.mockWeights = data.weights;
            logger.info(`Mock bandit weights loaded from ${filePath}`);
          }
        }
        return;
      }

      const modelJsonPath = path.join(modelDir, "model.json");
      if (fs.existsSync(modelJsonPath)) {
        this.model = await tf.loadLayersModel(`file://${modelDir}`);
        this.model.compile({
          optimizer: tf.train.adam(0.01),
          loss: "meanSquaredError",
        });
        logger.info(`TF.js bandit model loaded from ${modelJsonPath}`);
      }
    } catch (error) {
      logger.error({ error, modelDir }, "Failed to load bandit model, keeping current weights");
    }
  }

  isMockMode(): boolean {
    return this.useMock;
  }

  getMockWeights(): number[] {
    return [...this.mockWeights];
  }
}
