/**
 * CostOptimizer - Realistic Cost-Aware Scheduling
 * 
 * RESPONSIBILITY: Calculate total cost of task execution across multiple dimensions
 * 
 * Cost Model Components:
 * 1. Compute Cost: Base hourly rate × estimated duration
 * 2. Data Transfer: Ingress (free) + Egress ($0.09/GB typical)
 * 3. Storage: Temporary container storage during execution
 * 4. Network: Cross-region/AZ transfer premiums
 * 5. Spot vs On-Demand: Discount factors for preemptible instances
 */

export interface CostFactors {
  // Compute pricing
  computeHourlyRate: number // USD/hour
  spotDiscount: number // 0.0-1.0 (e.g., 0.7 = 70% discount)
  
  // Data transfer pricing
  dataIngressCostPerGB: number // Usually $0
  dataEgressCostPerGB: number // $0.05-$0.12 typical
  
  // Storage pricing
  storageCostPerGBHour: number // $0.0002/GB/hour typical
  
  // Network premiums
  crossRegionMultiplier: number // 2x-10x for cross-region
  crossAzMultiplier: number // 1x-2x for cross-AZ
}

export interface TaskResourceEstimate {
  estimatedDurationMinutes: number
  cpuCores: number
  memoryGB: number
  storageGB: number
  inputDataGB: number
  outputDataGB: number
  requiresGPU: boolean
}

export interface NodeCostProfile {
  nodeId: string
  region: string
  availabilityZone: string
  costFactors: CostFactors
  currentUtilization: {
    cpuPercent: number
    memoryPercent: number
  }
}

export interface CostEstimate {
  totalCostUSD: number
  breakdown: {
    compute: number
    dataTransfer: number
    storage: number
    networkPremium: number
  }
  confidence: number // 0.0-1.0 based on estimate reliability
  factors: string[] // Explanation of cost drivers
}

// Default cost factors based on major cloud providers (AWS/GCP/Azure)
const DEFAULT_COST_FACTORS: CostFactors = {
  computeHourlyRate: 0.05, // $0.05/hour for small instance
  spotDiscount: 0.0, // No spot discount by default
  dataIngressCostPerGB: 0.0, // Usually free
  dataEgressCostPerGB: 0.09, // $0.09/GB standard
  storageCostPerGBHour: 0.0002, // ~$0.10/GB/month
  crossRegionMultiplier: 2.0,
  crossAzMultiplier: 1.0, // Usually free within region
}

export class CostOptimizer {
  private readonly defaultFactors: CostFactors

  constructor(defaultFactors: CostFactors = DEFAULT_COST_FACTORS) {
    this.defaultFactors = defaultFactors
  }

  /**
   * Calculate total cost for executing a task on a specific node
   */
  calculateCost(
    task: TaskResourceEstimate,
    node: NodeCostProfile,
    controlPlaneRegion: string
  ): CostEstimate {
    const factors = node.costFactors
    const durationHours = task.estimatedDurationMinutes / 60

    // 1. Compute Cost
    const baseComputeCost = factors.computeHourlyRate * durationHours
    const spotSavings = baseComputeCost * factors.spotDiscount
    const computeCost = baseComputeCost - spotSavings

    // 2. Data Transfer Cost
    // Ingress is usually free
    const ingressCost = task.inputDataGB * factors.dataIngressCostPerGB
    // Egress is charged
    const egressCost = task.outputDataGB * factors.dataEgressCostPerGB
    const dataTransferCost = ingressCost + egressCost

    // 3. Storage Cost (temporary during execution)
    const storageCost = task.storageGB * factors.storageCostPerGBHour * durationHours

    // 4. Network Premium (cross-region/AZ)
    let networkPremium = 0
    const isCrossRegion = node.region !== controlPlaneRegion
    
    if (isCrossRegion) {
      // Cross-region data transfer premium
      const dataTransferred = task.inputDataGB + task.outputDataGB
      networkPremium = dataTransferred * factors.dataEgressCostPerGB * (factors.crossRegionMultiplier - 1)
    }

    // 5. Utilization penalty (prefer underutilized nodes)
    // This encourages bin-packing without explicit cluster autoscaler
    const utilizationPenalty = this.calculateUtilizationPenalty(
      node.currentUtilization,
      task
    )

    const totalCost = computeCost + dataTransferCost + storageCost + networkPremium + utilizationPenalty

    // Calculate confidence based on estimate quality
    const confidence = this.calculateConfidence(task)

    return {
      totalCostUSD: Math.round(totalCost * 10000) / 10000, // Round to 4 decimal places
      breakdown: {
        compute: Math.round(computeCost * 10000) / 10000,
        dataTransfer: Math.round(dataTransferCost * 10000) / 10000,
        storage: Math.round(storageCost * 10000) / 10000,
        networkPremium: Math.round(networkPremium * 10000) / 10000,
      },
      confidence,
      factors: this.generateCostFactorsExplanation(
        task,
        node,
        isCrossRegion,
        factors.spotDiscount > 0
      ),
    }
  }

  /**
   * Select the most cost-effective node for a task
   */
  selectMostCostEffective(
    task: TaskResourceEstimate,
    nodes: NodeCostProfile[],
    controlPlaneRegion: string,
    maxAcceptableCost?: number
  ): { node: NodeCostProfile; estimate: CostEstimate } | null {
    if (nodes.length === 0) return null

    const estimates = nodes.map(node => ({
      node,
      estimate: this.calculateCost(task, node, controlPlaneRegion),
    }))

    // Filter by max acceptable cost if specified
    const validEstimates = maxAcceptableCost
      ? estimates.filter(e => e.estimate.totalCostUSD <= maxAcceptableCost)
      : estimates

    if (validEstimates.length === 0) return null

    // Sort by total cost (ascending)
    validEstimates.sort((a, b) => a.estimate.totalCostUSD - b.estimate.totalCostUSD)

    return validEstimates[0]
  }

  /**
   * Calculate cost for a batch of tasks (for workflow optimization)
   */
  calculateBatchCost(
    tasks: TaskResourceEstimate[],
    node: NodeCostProfile,
    controlPlaneRegion: string
  ): {
    totalCost: number
    individualEstimates: CostEstimate[]
    savingsFromBatching: number
  } {
    const individualEstimates = tasks.map(task =>
      this.calculateCost(task, node, controlPlaneRegion)
    )

    const individualTotal = individualEstimates.reduce(
      (sum, est) => sum + est.totalCostUSD,
      0
    )

    // Batching savings: reduced overhead per task
    const batchOverheadReduction = Math.min(tasks.length * 0.01, 0.1) // Up to 10% savings
    const savingsFromBatching = individualTotal * batchOverheadReduction

    return {
      totalCost: individualTotal - savingsFromBatching,
      individualEstimates,
      savingsFromBatching,
    }
  }

  private calculateUtilizationPenalty(
    utilization: { cpuPercent: number; memoryPercent: number },
    task: TaskResourceEstimate
  ): number {
    // Prefer nodes with moderate utilization (40-70%)
    // Very low utilization = wasted capacity
    // Very high utilization = risk of contention
    
    const avgUtilization = (utilization.cpuPercent + utilization.memoryPercent) / 2
    
    if (avgUtilization < 20) {
      // Penalize very underutilized nodes (waste)
      return 0.001 // Small penalty
    } else if (avgUtilization > 85) {
      // Penalize very overloaded nodes (risk)
      return 0.005 // Larger penalty
    }
    
    return 0 // Optimal range
  }

  private calculateConfidence(task: TaskResourceEstimate): number {
    // Confidence decreases with larger resource estimates
    // (larger estimates have more variance)
    const sizeFactor = Math.min(
      (task.estimatedDurationMinutes / 60) * 0.1 +
      (task.inputDataGB + task.outputDataGB) * 0.05,
      0.3
    )
    
    return Math.max(0.7, 1.0 - sizeFactor)
  }

  private generateCostFactorsExplanation(
    task: TaskResourceEstimate,
    node: NodeCostProfile,
    isCrossRegion: boolean,
    isSpot: boolean
  ): string[] {
    const factors: string[] = []

    factors.push(`Base compute: ${task.estimatedDurationMinutes}min @ $${node.costFactors.computeHourlyRate}/hr`)

    if (task.inputDataGB > 0 || task.outputDataGB > 0) {
      factors.push(`Data: ${task.inputDataGB}GB in, ${task.outputDataGB}GB out`)
    }

    if (isCrossRegion) {
      factors.push(`Cross-region premium: ${node.region} → control plane`)
    }

    if (isSpot) {
      factors.push(`Spot discount: ${(node.costFactors.spotDiscount * 100).toFixed(0)}%`)
    }

    if (task.requiresGPU) {
      factors.push('GPU acceleration premium')
    }

    return factors
  }
}

// Factory functions for common cloud provider profiles
export function createAWSCostProfile(region: string): CostFactors {
  return {
    ...DEFAULT_COST_FACTORS,
    computeHourlyRate: 0.0464, // t3.small on-demand
    dataEgressCostPerGB: 0.09,
    crossRegionMultiplier: 2.0,
  }
}

export function createGCPCostProfile(region: string): CostFactors {
  return {
    ...DEFAULT_COST_FACTORS,
    computeHourlyRate: 0.0408, // e2-small
    dataEgressCostPerGB: 0.12,
    crossRegionMultiplier: 2.0,
  }
}

export function createAzureCostProfile(region: string): CostFactors {
  return {
    ...DEFAULT_COST_FACTORS,
    computeHourlyRate: 0.0432, // B2s
    dataEgressCostPerGB: 0.087,
    crossRegionMultiplier: 2.0,
  }
}
