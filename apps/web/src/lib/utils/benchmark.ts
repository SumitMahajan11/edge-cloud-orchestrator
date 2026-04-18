interface BenchmarkResult {
  name: string
  duration: number
  memoryUsed: number
  iterations: number
  opsPerSecond: number
  avgLatency: number
  minLatency: number
  maxLatency: number
}

class Benchmark {
  private results: BenchmarkResult[] = []

  async run(
    name: string,
    fn: () => Promise<void> | void,
    iterations = 100
  ): Promise<BenchmarkResult> {
    const latencies: number[] = []
    
    // Warmup
    for (let i = 0; i < 10; i++) {
      await fn()
    }

    const startMemory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0
    const startTime = performance.now()

    for (let i = 0; i < iterations; i++) {
      const iterStart = performance.now()
      await fn()
      const iterEnd = performance.now()
      latencies.push(iterEnd - iterStart)
    }

    const endTime = performance.now()
    const endMemory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0

    const result: BenchmarkResult = {
      name,
      duration: endTime - startTime,
      memoryUsed: endMemory - startMemory,
      iterations,
      opsPerSecond: (iterations / (endTime - startTime)) * 1000,
      avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      minLatency: Math.min(...latencies),
      maxLatency: Math.max(...latencies)
    }

    this.results.push(result)
    return result
  }

  compare(baseline: BenchmarkResult, current: BenchmarkResult): string {
    const durationImprovement = ((baseline.duration - current.duration) / baseline.duration * 100).toFixed(2)
    const latencyImprovement = ((baseline.avgLatency - current.avgLatency) / baseline.avgLatency * 100).toFixed(2)
    const opsImprovement = ((current.opsPerSecond - baseline.opsPerSecond) / baseline.opsPerSecond * 100).toFixed(2)

    return `
Performance Comparison: ${baseline.name} vs ${current.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Duration:     ${baseline.duration.toFixed(2)}ms → ${current.duration.toFixed(2)}ms (${durationImprovement}%)
Avg Latency:  ${baseline.avgLatency.toFixed(2)}ms → ${current.avgLatency.toFixed(2)}ms (${latencyImprovement}%)
Throughput:   ${baseline.opsPerSecond.toFixed(0)} → ${current.opsPerSecond.toFixed(0)} ops/sec (${opsImprovement}%)
Memory:       ${(baseline.memoryUsed / 1024 / 1024).toFixed(2)}MB → ${(current.memoryUsed / 1024 / 1024).toFixed(2)}MB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim()
  }

  getResults(): BenchmarkResult[] {
    return this.results
  }

  reset(): void {
    this.results = []
  }
}

export const benchmark = new Benchmark()
export type { BenchmarkResult }
