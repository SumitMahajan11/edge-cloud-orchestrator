/**
 * Calculate the reward for a scheduling decision.
 * The reward is a float in the range [-1.0, 1.0] representing the multi-objective utility
 * of the scheduling assignment. It penalizes failure, SLA violations, carbon intensity, and node CPU overload.
 *
 * @param actualLatencyMs Actual task latency in milliseconds
 * @param predictedLatencyMs Predicted task latency in milliseconds (fallback if actual is missing)
 * @param carbonIntensity Carbon intensity in gCO2/kWh (typically 0 - 1000)
 * @param nodeCpuUsage Node CPU usage percentage (0 - 100)
 * @param status Status of the execution ('COMPLETED' | 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'OOM')
 */
export function calculateReward(
  actualLatencyMs: number | null,
  predictedLatencyMs: number,
  carbonIntensity: number,
  nodeCpuUsage: number,
  status: string
): number {
  const isFailure =
    status === "FAILED" ||
    status === "TIMEOUT" ||
    status === "OOM";

  if (isFailure) {
    return -1.0;
  }

  const latency = actualLatencyMs ?? predictedLatencyMs;

  // 1. Latency Utility (target/SLA = 5000ms)
  let latencyScore = 1.0 - (latency / 5000.0);
  latencyScore = Math.max(-1.0, Math.min(1.0, latencyScore));

  let slaPenalty = 0.0;
  if (latency > 5000) {
    slaPenalty = -0.5;
  }

  // 2. Carbon Utility (typically 0 - 1000 gCO2/kWh)
  let carbonScore = 1.0 - (carbonIntensity / 1000.0);
  carbonScore = Math.max(-1.0, Math.min(1.0, carbonScore));

  // 3. Node Resource Load Utility (0 - 100%)
  let cpuScore = 1.0 - (nodeCpuUsage / 100.0);
  cpuScore = Math.max(-1.0, Math.min(1.0, cpuScore));

  let loadPenalty = 0.0;
  if (nodeCpuUsage > 85) {
    loadPenalty = -0.3;
  }

  // Weights (40% latency, 30% carbon, 30% cpu usage)
  const latencyWeight = 0.4;
  const carbonWeight = 0.3;
  const cpuWeight = 0.3;

  const rawReward =
    latencyWeight * latencyScore +
    carbonWeight * carbonScore +
    cpuWeight * cpuScore +
    slaPenalty +
    loadPenalty;

  // Clamp reward to [-1.0, 1.0]
  return Math.max(-1.0, Math.min(1.0, rawReward));
}
