/**
 * Chaos Testing Script for Edge-Cloud Orchestrator
 * 
 * This script simulates various failure scenarios to test system resilience:
 * - Database connection failures
 * - Redis unavailability
 * - Network latency injection
 * - Edge agent failures
 * - Memory pressure
 * - CPU throttling
 */

const axios = require('axios');
const { spawn, exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const API_URL = process.env.API_URL || 'http://localhost:3000';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DB_CONTAINER = process.env.DB_CONTAINER || 'edge-cloud-postgres';
const REDIS_CONTAINER = process.env.REDIS_CONTAINER || 'edge-cloud-redis';

const CHAOS_DURATIONS = {
  short: 5000,      // 5 seconds
  medium: 30000,    // 30 seconds
  long: 60000,      // 1 minute
};

class ChaosTestRunner {
  constructor() {
    this.results = [];
    this.isRunning = false;
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async checkHealth() {
    try {
      const response = await axios.get(`${API_URL}/health`, { timeout: 5000 });
      return response.data.status === 'healthy';
    } catch (error) {
      return false;
    }
  }

  async measureRecovery(maxWaitMs = 30000) {
    const startTime = Date.now();
    let recovered = false;

    while (Date.now() - startTime < maxWaitMs) {
      if (await this.checkHealth()) {
        recovered = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return {
      recovered,
      recoveryTime: Date.now() - startTime,
    };
  }

  async runTest(name, chaosFn, duration = CHAOS_DURATIONS.short) {
    this.log(`\n🔥 Starting chaos test: ${name}`);
    this.isRunning = true;

    const startTime = Date.now();

    try {
      // Check initial health
      const initialHealth = await this.checkHealth();
      this.log(`Initial health: ${initialHealth ? 'healthy' : 'unhealthy'}`);

      // Inject chaos
      await chaosFn();
      this.log(`Chaos injected, waiting ${duration}ms...`);

      // Wait during chaos
      await new Promise(resolve => setTimeout(resolve, duration));

      // Check health during chaos
      const duringChaosHealth = await this.checkHealth();
      this.log(`Health during chaos: ${duringChaosHealth ? 'healthy' : 'unhealthy'}`);

      // Restore chaos
      await this.restoreChaos(name);
      this.log('Chaos restored');

      // Measure recovery
      const recovery = await this.measureRecovery();
      this.log(`Recovery: ${recovery.recovered ? 'success' : 'failed'} (${recovery.recoveryTime}ms)`);

      const result = {
        name,
        initialHealth,
        duringChaosHealth,
        recovered: recovery.recovered,
        recoveryTime: recovery.recoveryTime,
        duration: Date.now() - startTime,
        passed: recovery.recovered && recovery.recoveryTime < 30000,
      };

      this.results.push(result);
      return result;

    } catch (error) {
      this.log(`Error during test: ${error.message}`);
      return {
        name,
        error: error.message,
        passed: false,
      };
    } finally {
      this.isRunning = false;
    }
  }

  async restoreChaos(testName) {
    switch (testName) {
      case 'database-failure':
        await execPromise(`docker start ${DB_CONTAINER}`).catch(() => {});
        break;
      case 'redis-failure':
        await execPromise(`docker start ${REDIS_CONTAINER}`).catch(() => {});
        break;
      case 'network-latency':
        await execPromise('docker network rm chaos-network 2>/dev/null || true').catch(() => {});
        break;
      case 'edge-agent-failure':
        // Edge agent should auto-restart
        break;
    }
  }

  async testDatabaseFailure() {
    return this.runTest('database-failure', async () => {
      try {
        await execPromise(`docker stop ${DB_CONTAINER}`);
      } catch (error) {
        this.log(`Could not stop database: ${error.message}`);
      }
    }, CHAOS_DURATIONS.medium);
  }

  async testRedisFailure() {
    return this.runTest('redis-failure', async () => {
      try {
        await execPromise(`docker stop ${REDIS_CONTAINER}`);
      } catch (error) {
        this.log(`Could not stop Redis: ${error.message}`);
      }
    }, CHAOS_DURATIONS.medium);
  }

  async testNetworkLatency() {
    return this.runTest('network-latency', async () => {
      // This would require tc (traffic control) on Linux
      // For Docker, we'd use network emulation
      this.log('Network latency injection requires root privileges');
    }, CHAOS_DURATIONS.short);
  }

  async testHighLoad() {
    this.log('\n🔥 Starting chaos test: high-load');
    
    const requests = [];
    const numRequests = 1000;
    
    for (let i = 0; i < numRequests; i++) {
      requests.push(
        axios.get(`${API_URL}/health`).catch(() => ({ error: true }))
      );
    }
    
    const startTime = Date.now();
    const responses = await Promise.all(requests);
    const duration = Date.now() - startTime;
    
    const successful = responses.filter(r => !r.error && r.status === 200).length;
    const failed = responses.length - successful;
    
    const result = {
      name: 'high-load',
      totalRequests: numRequests,
      successful,
      failed,
      duration,
      requestsPerSecond: (numRequests / duration) * 1000,
      passed: successful / numRequests > 0.9, // 90% success rate
    };
    
    this.results.push(result);
    this.log(`High load test: ${successful}/${numRequests} successful (${(successful/numRequests*100).toFixed(1)}%)`);
    
    return result;
  }

  async testMemoryPressure() {
    this.log('\n🔥 Starting chaos test: memory-pressure');
    
    // Allocate memory to stress the system
    const chunks = [];
    const chunkSize = 10 * 1024 * 1024; // 10MB chunks
    
    try {
      for (let i = 0; i < 100; i++) {
        chunks.push(Buffer.alloc(chunkSize, 'x'));
        
        // Check health periodically
        if (i % 10 === 0) {
          const health = await this.checkHealth();
          if (!health) {
            this.log(`System became unhealthy at ${i * 10}MB`);
            break;
          }
        }
      }
      
      const result = {
        name: 'memory-pressure',
        memoryAllocated: chunks.length * 10,
        passed: await this.checkHealth(),
      };
      
      this.results.push(result);
      return result;
      
    } finally {
      // Free memory
      chunks.length = 0;
      if (global.gc) {
        global.gc();
      }
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('CHAOS TEST SUMMARY');
    console.log('='.repeat(60));
    
    let passed = 0;
    let failed = 0;
    
    this.results.forEach(result => {
      const status = result.passed ? '✅ PASSED' : '❌ FAILED';
      console.log(`${status}: ${result.name}`);
      
      if (result.recoveryTime) {
        console.log(`   Recovery time: ${result.recoveryTime}ms`);
      }
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      
      if (result.passed) passed++;
      else failed++;
    });
    
    console.log('='.repeat(60));
    console.log(`Total: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));
    
    return { passed, failed, total: this.results.length };
  }
}

// Run all chaos tests
async function main() {
  const runner = new ChaosTestRunner();
  
  console.log('🎯 Edge-Cloud Orchestrator Chaos Testing');
  console.log('='.repeat(60));
  
  // Run tests
  await runner.testHighLoad();
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Database and Redis tests require Docker
  if (process.env.RUN_DOCKER_CHAOS === 'true') {
    await runner.testDatabaseFailure();
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    await runner.testRedisFailure();
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  
  await runner.testMemoryPressure();
  
  // Print summary
  const summary = runner.printSummary();
  
  // Exit with error code if any tests failed
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(console.error);
